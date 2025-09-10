import * as btc from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { getRawTransaction } from './rpc.js';
import { getNetwork, getPaymentForAddress, getScriptTypeFromAddress } from './wallet.js';

// Initialize ECPair and ECC library
const ECPair = ECPairFactory(ecc);
btc.initEccLib(ecc);

/**
 * Enhanced PSBT builder following the detailed flow
 * Steps 4-7: Construct unsigned messages, hash and sign, build signed transaction for each UTXO
 */
export async function buildAndSignPsbt({ 
    network = 'regtest', 
    inputs, 
    outputs, 
    keyPair, 
    wallet,
    getRawTransactionFn = getRawTransaction
}) {
    const net = getNetwork(network);
    const psbt = new btc.Psbt({ network: net });
    
    console.log('Building PSBT with inputs:', inputs.length, 'outputs:', outputs.length);
    
    // Step 4: Construct unsigned messages corresponding to each UTXO
    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        console.log(`Processing input ${i + 1}/${inputs.length}:`, input.txid, input.vout);
        
        try {
            // Get raw transaction data
            const prevTx = await getRawTransactionFn(input.txid);
            const prevOutput = prevTx.vout[input.vout];
            
            if (!prevOutput) {
                throw new Error(`Output ${input.vout} not found in transaction ${input.txid}`);
            }
            
            const value = Math.round(prevOutput.value * 1e8);
            const scriptPubKey = Buffer.from(prevOutput.scriptPubKey.hex, 'hex');
            
            // Determine script type from address
            const scriptType = getScriptTypeFromAddress(input.address);
            const payment = getPaymentForAddress(input.address, keyPair, network);
            
            console.log(`Input ${i}: ${scriptType}, value: ${value} sats`);
            
            // Add input based on script type
            const inputData = {
                hash: input.txid,
                index: input.vout,
                sequence: 0xfffffffd // Enable RBF
            };
            
            if (scriptType === 'p2wpkh') {
                // Native SegWit
                inputData.witnessUtxo = {
                    script: scriptPubKey,
                    value: value
                };
            } else if (scriptType === 'p2sh-p2wpkh') {
                // Nested SegWit
                inputData.witnessUtxo = {
                    script: scriptPubKey,
                    value: value
                };
                inputData.redeemScript = payment.redeem.output;
            } else {
                // Legacy P2PKH
                inputData.nonWitnessUtxo = Buffer.from(prevTx.hex, 'hex');
            }
            
            psbt.addInput(inputData);
            
        } catch (error) {
            console.error(`Error processing input ${i}:`, error.message);
            throw new Error(`Failed to process input ${i}: ${error.message}`);
        }
    }
    
    // Add outputs
    for (const output of outputs) {
        if (output.address) {
            psbt.addOutput({
                address: output.address,
                value: output.value
            });
        } else if (output.script) {
            psbt.addOutput({
                script: Buffer.from(output.script, 'hex'),
                value: output.value
            });
        }
    }
    
    console.log('PSBT created, now signing...');
    
    // Step 5: Hash and sign those unsigned messages (check canonical form)
    // Step 6: Build the signed transaction for each UTXO
    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const scriptType = getScriptTypeFromAddress(input.address);
        
        try {
            console.log(`Signing input ${i} (${scriptType})`);
            
            if (scriptType === 'p2wpkh' || scriptType === 'p2sh-p2wpkh') {
                // SegWit signing
                psbt.signInput(i, keyPair);
            } else {
                // Legacy signing
                psbt.signInput(i, keyPair);
            }
            
            // Validate signature
            const validated = psbt.validateSignaturesOfInput(i, (pubkey, msghash, signature) => {
                return ECPair.fromPublicKey(pubkey).verify(msghash, signature);
            });
            
            if (!validated) {
                throw new Error(`Signature validation failed for input ${i}`);
            }
            
            console.log(`Input ${i} signed and validated successfully`);
            
        } catch (error) {
            console.error(`Error signing input ${i}:`, error.message);
            throw new Error(`Failed to sign input ${i}: ${error.message}`);
        }
    }
    
    // Finalize all inputs
    psbt.finalizeAllInputs();
    
    // Step 7: Construct the whole messages (gather all signed transaction for each UTXO)
    const transaction = psbt.extractTransaction();
    const hex = transaction.toHex();
    
    console.log('Transaction built successfully, hex length:', hex.length);
    
    return {
        psbt: psbt.toBase64(),
        hex: hex,
        txid: transaction.getId(),
        size: transaction.byteLength(),
        vsize: transaction.virtualSize(),
        weight: transaction.weight()
    };
}

/**
 * Build unsigned PSBT (for external signing)
 */
export async function buildUnsignedPsbt({ network = 'regtest', inputs, outputs, getRawTransactionFn = getRawTransaction }) {
    const net = getNetwork(network);
    const psbt = new btc.Psbt({ network: net });
    
    // Add inputs
    for (const input of inputs) {
        const prevTx = await getRawTransactionFn(input.txid);
        const prevOutput = prevTx.vout[input.vout];
        
        if (!prevOutput) {
            throw new Error(`Output ${input.vout} not found in transaction ${input.txid}`);
        }
        
        const value = Math.round(prevOutput.value * 1e8);
        const scriptPubKey = Buffer.from(prevOutput.scriptPubKey.hex, 'hex');
        const scriptType = getScriptTypeFromAddress(input.address);
        
        const inputData = {
            hash: input.txid,
            index: input.vout,
            sequence: 0xfffffffd
        };
        
        if (scriptType === 'p2wpkh' || scriptType === 'p2sh-p2wpkh') {
            inputData.witnessUtxo = {
                script: scriptPubKey,
                value: value
            };
            
            if (scriptType === 'p2sh-p2wpkh') {
                // For nested SegWit, we need the redeem script
                // This would need to be provided or derived
                const dummyKeyPair = ECPair.makeRandom({ network: net });
                const payment = btc.payments.p2sh({
                    redeem: btc.payments.p2wpkh({ pubkey: dummyKeyPair.publicKey, network: net }),
                    network: net
                });
                inputData.redeemScript = payment.redeem.output;
            }
        } else {
            inputData.nonWitnessUtxo = Buffer.from(prevTx.hex, 'hex');
        }
        
        psbt.addInput(inputData);
    }
    
    // Add outputs
    for (const output of outputs) {
        if (output.address) {
            psbt.addOutput({
                address: output.address,
                value: output.value
            });
        } else if (output.script) {
            psbt.addOutput({
                script: Buffer.from(output.script, 'hex'),
                value: output.value
            });
        }
    }
    
    return psbt.toBase64();
}

/**
 * Legacy buildPsbt function (kept for backward compatibility)
 */
export async function buildPsbt({ network = 'regtest', inputs, outputs, getRawTransactionFn }) {
    return buildUnsignedPsbt({ network, inputs, outputs, getRawTransactionFn });
}
