import { collectUtxosForWallet, selectOptimalUtxos, watchWalletAddresses } from './utxo-collector.js';
import { buildAndSignPsbt } from './psbt-enhanced.js';
import { sendRawTransaction, rpc } from './rpc.js';
import { deriveAddressesFromPrivateKey } from './wallet.js';

/**
 * Complete Bitcoin transaction flow following the detailed specifications
 * This implements the entire flow from step 1 to step 8
 */
export class BitcoinTransactionBuilder {
    constructor(privateKeyHex, network = 'regtest', deps = {}) {
        this.privateKey = privateKeyHex;
        this.network = network;
        // dependency injection for testability
        this.deps = {
            collectUtxosForWallet,
            selectOptimalUtxos,
            watchWalletAddresses,
            buildAndSignPsbt,
            sendRawTransaction,
            rpc,
            deriveAddressesFromPrivateKey,
            ...deps
        };
        this.wallet = this.deps.deriveAddressesFromPrivateKey(privateKeyHex, network);
        console.log('Initialized BitcoinTransactionBuilder with wallet:', this.wallet.addresses);
    }

    /**
     * Step 1-2: Derive addresses and collect UTXOs
     */
    async collectUtxos() {
        console.log('\n=== Step 1-2: Collecting UTXOs ===');
        const result = await this.deps.collectUtxosForWallet(this.privateKey, this.network);
        this.utxoData = result;
        console.log(`Collected ${result.totalUtxos.length} UTXOs, total balance: ${result.totalBalance} sats`);
        return result;
    }

    /**
     * Step 3: Select optimal UTXOs for the transaction
     */
    selectUtxos(targetSats, feeRate = 2) {
        console.log('\n=== Step 3: UTXO Selection ===');
        if (!this.utxoData) {
            throw new Error('Must collect UTXOs first using collectUtxos()');
        }
        const selection = this.deps.selectOptimalUtxos(this.utxoData.totalUtxos, targetSats, feeRate);
        if (selection.selected.length === 0) {
            throw new Error(selection.error || 'No suitable UTXOs found');
        }
        this.selectedUtxos = selection;
        console.log(`Selected ${selection.selected.length} UTXOs for ${targetSats} sats`);
        return selection;
    }

    /**
     * Steps 4-7: Build and sign the complete transaction
     */
    async buildTransaction(recipientAddress, amountSats, feeRate = 2, changeAddress = null) {
        console.log('\n=== Steps 4-7: Building and Signing Transaction ===');
        const finalChangeAddress = changeAddress || this.wallet.addresses.p2wpkh;
        if (!this.selectedUtxos) {
            this.selectUtxos(amountSats, feeRate);
        }
        const inputs = this.selectedUtxos.selected.map(utxo => ({
            txid: utxo.txid,
            vout: utxo.vout,
            address: utxo.address,
            amount: utxo.amount,
            scriptType: utxo.scriptType
        }));
        const outputs = [ { address: recipientAddress, value: amountSats } ];
        if (this.selectedUtxos.change > 0) {
            outputs.push({ address: finalChangeAddress, value: this.selectedUtxos.change });
        }
        console.log('Building PSBT with:');
        console.log(`- ${inputs.length} inputs`);
        console.log(`- ${outputs.length} outputs`);
        console.log(`- Fee: ${this.selectedUtxos.fee} sats`);
        console.log(`- Change: ${this.selectedUtxos.change} sats`);
        const transaction = await this.deps.buildAndSignPsbt({
            network: this.network,
            inputs,
            outputs,
            keyPair: this.wallet.keyPair,
            wallet: this.wallet
        });
        this.signedTransaction = transaction;
        console.log(`Transaction built successfully: ${transaction.txid}`);
        console.log(`Size: ${transaction.size} bytes, vSize: ${transaction.vsize} vbytes`);
        return transaction;
    }

    /**
     * Step 8: Broadcast transaction to the Bitcoin blockchain
     */
    async broadcastTransaction() {
        console.log('\n=== Step 8: Broadcasting Transaction ===');
        if (!this.signedTransaction) {
            throw new Error('No signed transaction to broadcast. Build transaction first.');
        }
        try {
            const txid = await this.deps.sendRawTransaction(this.signedTransaction.hex);
            console.log(`Transaction broadcasted successfully: ${txid}`);
            if (this.network === 'regtest') {
                console.log('\n⚠️  REGTEST REMINDER: Mine a block to confirm the transaction:');
                console.log(`bitcoin-cli -regtest generatetoaddress 1 <miner_address>`);
            }
            return txid;
        } catch (error) {
            console.error('Broadcast failed:', error.message);
            throw new Error(`Failed to broadcast transaction: ${error.message}`);
        }
    }

    /**
     * Complete end-to-end transaction (all steps)
     */
    async sendBitcoin(recipientAddress, amountSats, feeRate = 2, changeAddress = null) {
        console.log('\n🚀 Starting complete Bitcoin transaction flow...');
        console.log(`Sending ${amountSats} sats to ${recipientAddress}`);
        try {
            await this.collectUtxos();
            this.selectUtxos(amountSats, feeRate);
            await this.buildTransaction(recipientAddress, amountSats, feeRate, changeAddress);
            const txid = await this.broadcastTransaction();
            console.log('\n✅ Transaction completed successfully!');
            console.log(`Transaction ID: ${txid}`);
            console.log(`Amount sent: ${amountSats} sats`);
            console.log(`Fee paid: ${this.selectedUtxos.fee} sats`);
            console.log(`Change: ${this.selectedUtxos.change} sats`);
            return { txid, amountSats, fee: this.selectedUtxos.fee, change: this.selectedUtxos.change, transaction: this.signedTransaction };
        } catch (error) {
            console.error('\n❌ Transaction failed:', error.message);
            throw error;
        }
    }

    /**
     * Watch wallet addresses in Bitcoin Core
     */
    async watchAddresses(rescan = false) {
        console.log('\n=== Watching wallet addresses ===');
        return await this.deps.watchWalletAddresses(this.wallet, rescan);
    }

    /**
     * Get wallet balance across all address types
     */
    async getBalance() {
        if (!this.utxoData) {
            await this.collectUtxos();
        }
        return {
            totalBalance: this.utxoData.totalBalance,
            balanceByType: Object.entries(this.utxoData.utxosByType).reduce((acc, [type, utxos]) => {
                acc[type] = utxos.reduce((sum, utxo) => sum + utxo.amount_sats, 0);
                return acc;
            }, {}),
            utxoCount: this.utxoData.totalUtxos.length,
            addresses: this.wallet.addresses
        };
    }

    /**
     * Generate a new block (regtest only)
     */
    async mineBlock(address = null) {
        if (this.network !== 'regtest') {
            throw new Error('Mining is only available in regtest mode');
        }
        const minerAddress = address || this.wallet.addresses.p2wpkh;
        try {
            const blockHashes = await this.deps.rpc('generatetoaddress', [1, minerAddress]);
            console.log(`Mined block: ${blockHashes[0]}`);
            return blockHashes[0];
        } catch (error) {
            console.error('Mining failed:', error.message);
            throw error;
        }
    }
}

/**
 * Convenience function to create a transaction builder
 */
export function createTransactionBuilder(privateKeyHex, network = 'regtest', deps) {
    return new BitcoinTransactionBuilder(privateKeyHex, network, deps);
}

/**
 * Quick send function for simple transactions
 */
export async function quickSend(privateKeyHex, recipientAddress, amountSats, options = {}) {
    const { network = 'regtest', feeRate = 2, changeAddress = null, deps = {} } = options;
    const builder = new BitcoinTransactionBuilder(privateKeyHex, network, deps);
    return await builder.sendBitcoin(recipientAddress, amountSats, feeRate, changeAddress);
}
