import { getUtxosForAddresses, rpc, pingRpc } from './rpc.js';
import { selectUtxos } from './coinselect.js';
import { deriveAddressesFromPrivateKey } from './wallet.js';

/**
 * Enhanced UTXO collection following the detailed flow
 * Step 2: Derive all UTXOs of each address type
 * Step 3: Collect enough UTXOs to send (the less selected UTXOs the better)
 */
export async function collectUtxosForWallet(privateKeyHex, network = 'regtest', deps = {}) {
    const { pingRpcFn = pingRpc, deriveAddressesFn = deriveAddressesFromPrivateKey, getUtxosForAddressesFn = getUtxosForAddresses, rpcFn = rpc } = deps;
    console.log('Collecting UTXOs for wallet...');

    // Early connectivity check to avoid noisy repeated connection errors
    const rpcAvailable = await pingRpcFn();
    if (!rpcAvailable) {
        console.warn('RPC not reachable - returning empty UTXO set (degraded mode)');
        const wallet = deriveAddressesFn(privateKeyHex, network);
        return { wallet, utxosByType: { p2wpkh:[], p2sh_p2wpkh:[], p2pkh:[] }, totalUtxos: [], totalBalance: 0, degraded: true };
    }

    // Step 1: From private key, derive all possible address types
    const wallet = deriveAddressesFn(privateKeyHex, network);
    console.log('Derived addresses:', wallet.addresses);

    // Step 2: Derive all UTXOs of each address type
    const utxosByType = {};
    let totalUtxos = [];

    for (const [type, address] of Object.entries(wallet.addresses)) {
        try {
            console.log(`Checking UTXOs for ${type} address: ${address}`);
            let utxos;
            try {
                utxos = await getUtxosForAddressesFn([address], 0);
            } catch (error) {
                console.log(`listunspent failed for ${address}, trying scantxoutset...`);
                try {
                    const scanResult = await rpcFn('scantxoutset', ['start', [`addr(${address})`]]);
                    utxos = scanResult.unspents || [];
                    const currentBlockCount = await rpcFn('getblockcount');
                    utxos = utxos.map(utxo => ({
                        txid: utxo.txid,
                        vout: utxo.vout,
                        address: address,
                        amount: utxo.amount,
                        confirmations: utxo.height ? currentBlockCount - utxo.height + 1 : 0,
                        spendable: true,
                        scriptType: type
                    }));
                } catch (scanError) {
                    console.error(`Error scanning UTXOs for ${address}:`, scanError.message);
                    utxos = [];
                }
            }
            utxos = utxos.map(utxo => ({
                ...utxo,
                scriptType: type,
                amount_sats: Math.round(utxo.amount * 1e8)
            }));
            utxosByType[type] = utxos;
            totalUtxos.push(...utxos);
            console.log(`Found ${utxos.length} UTXOs for ${type}: ${utxos.reduce((sum, u) => sum + u.amount_sats, 0)} sats`);
        } catch (error) {
            console.error(`Error collecting UTXOs for ${type} (${address}):`, error.message);
            utxosByType[type] = [];
        }
    }

    const totalBalance = totalUtxos.reduce((sum, utxo) => sum + utxo.amount_sats, 0);
    console.log(`Total UTXOs found: ${totalUtxos.length}, Total balance: ${totalBalance} sats`);
    return { wallet, utxosByType, totalUtxos, totalBalance };
}

/**
 * Smart UTXO selection following the detailed flow
 * Step 3: Collect enough UTXOs to send (the less selected UTXOs the better)
 */
export function selectOptimalUtxos(utxos, targetSats, feerate = 2, preferredTypes = ['p2wpkh', 'p2sh-p2wpkh', 'p2pkh']) {
    console.log(`Selecting UTXOs for ${targetSats} sats with ${feerate} sat/vB fee rate`);
    const utxosByType = {};
    for (const utxo of utxos) {
        const type = utxo.scriptType || 'p2wpkh';
        if (!utxosByType[type]) utxosByType[type] = [];
        utxosByType[type].push(utxo);
    }
    for (const scriptType of preferredTypes) {
        if (!utxosByType[scriptType] || utxosByType[scriptType].length === 0) continue;
        const result = selectUtxos(utxosByType[scriptType], targetSats, feerate, 'p2wpkh', scriptType);
        if (result.selected.length > 0) {
            return { ...result, scriptType, utxosByType };
        }
    }
    const allUtxosWithEfficiency = utxos.map(utxo => {
        const scriptType = utxo.scriptType || 'p2wpkh';
        const inputVbytes = getInputVbytes(scriptType);
        const efficiency = (utxo.amount_sats || Math.round(utxo.amount * 1e8)) / inputVbytes;
        return { ...utxo, efficiency, inputVbytes };
    }).sort((a, b) => b.efficiency - a.efficiency);
    let selected = []; let totalInput = 0; let totalVbytes = 10;
    for (const utxo of allUtxosWithEfficiency) {
        selected.push(utxo); totalInput += utxo.amount_sats || Math.round(utxo.amount * 1e8); totalVbytes += utxo.inputVbytes;
        const outputVbytes = 31 + 31; // 2 P2WPKH outputs
        const fee = Math.ceil((totalVbytes + outputVbytes) * feerate);
        if (totalInput >= targetSats + fee) {
            const change = totalInput - targetSats - fee;
            return { selected, total: totalInput, fee, change, scriptType: 'mixed', utxosByType };
        }
    }
    return { selected: [], total: 0, fee: 0, change: 0, scriptType: null, utxosByType, error: 'Insufficient funds' };
}

function getInputVbytes(scriptType) {
    switch (scriptType) {
        case 'p2wpkh': return 68;
        case 'p2sh-p2wpkh': return 91;
        case 'p2pkh': return 148;
        default: return 68;
    }
}

/**
 * Watch addresses in Bitcoin Core for UTXO tracking
 */
export async function watchWalletAddresses(wallet, rescan = false, deps = {}) {
    const { rpcFn = rpc } = deps;
    const addresses = Object.values(wallet.addresses);
    console.log('Watching addresses:', addresses);
    try {
        const now = Math.floor(Date.now() / 1000);
        const requests = addresses.map(address => ({
            scriptPubKey: { address },
            timestamp: rescan ? 0 : now,
            watchonly: true,
            label: `wallet_${wallet.addresses.p2wpkh.slice(-8)}`
        }));
        const result = await rpcFn('importmulti', [requests, { rescan }]);
        return result;
    } catch (error) {
        console.error('Error watching addresses:', error.message);
        throw error;
    }
}
