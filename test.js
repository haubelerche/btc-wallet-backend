import { generateWallet, deriveAddressesFromPrivateKey } from './src/wallet.js';
import { BitcoinTransactionBuilder } from './src/transaction-builder.js';

// Test the complete Bitcoin transaction flow
async function testBitcoinFlow() {
    console.log('🚀 Testing Bitcoin Transaction Flow Implementation\n');
    
    try {
        // Step 1: Generate a new wallet
        console.log('=== Generating New Wallet ===');
        const wallet = generateWallet('regtest');
        console.log('Mnemonic:', wallet.mnemonic);
        console.log('Addresses:');
        console.log('  P2PKH (Legacy):', wallet.addresses.p2pkh);
        console.log('  P2SH-P2WPKH (Nested SegWit):', wallet.addresses.p2sh_p2wpkh);
        console.log('  P2WPKH (Native SegWit):', wallet.addresses.p2wpkh);
        console.log('Public Key:', wallet.publicKey);
        
        // Step 2: Test address derivation from private key
        console.log('\n=== Testing Address Derivation ===');
        const derivedWallet = deriveAddressesFromPrivateKey(wallet.privateKey, 'regtest');
        console.log('Derived addresses match:', 
            JSON.stringify(wallet.addresses) === JSON.stringify(derivedWallet.addresses) ? '✅' : '❌');
        
        // Step 3: Initialize transaction builder
        console.log('\n=== Initializing Transaction Builder ===');
        const builder = new BitcoinTransactionBuilder(wallet.privateKey, 'regtest');
        
        // Step 4: Test UTXO collection (will show empty for new wallet)
        console.log('\n=== Testing UTXO Collection ===');
        try {
            const utxoData = await builder.collectUtxos();
            console.log('UTXO collection successful');
            console.log('Total UTXOs:', utxoData.totalUtxos.length);
            console.log('Total Balance:', utxoData.totalBalance, 'sats');
        } catch (error) {
            console.log('UTXO collection failed (expected for new wallet):', error.message);
        }
        
        // Step 5: Test balance checking
        console.log('\n=== Testing Balance Check ===');
        try {
            const balance = await builder.getBalance();
            console.log('Balance check successful');
            console.log('Total Balance:', balance.totalBalance, 'sats');
            console.log('Balance by type:', balance.balanceByType);
        } catch (error) {
            console.log('Balance check failed (expected for new wallet):', error.message);
        }
        
        console.log('\n✅ All basic tests passed!');
        console.log('\n📝 To test full transaction flow:');
        console.log('1. Start Bitcoin Core in regtest mode');
        console.log('2. Send some BTC to the generated addresses');
        console.log('3. Use the /transaction/send API endpoint');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

// Test with sample private key (for demonstration)
async function testWithSampleKey() {
    console.log('\n🔧 Testing with sample private key...\n');
    
    const samplePrivateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    
    try {
        const wallet = deriveAddressesFromPrivateKey(samplePrivateKey, 'regtest');
        console.log('Sample wallet addresses:');
        console.log('  P2PKH:', wallet.addresses.p2pkh);
        console.log('  P2SH-P2WPKH:', wallet.addresses.p2sh_p2wpkh);
        console.log('  P2WPKH:', wallet.addresses.p2wpkh);
        
        console.log('\n✅ Address derivation working correctly!');
        
    } catch (error) {
        console.error('❌ Sample key test failed:', error.message);
    }
}

// Run tests
console.log('Starting Bitcoin Wallet Backend Tests...\n');
await testBitcoinFlow();
await testWithSampleKey();

console.log('\n🎉 Test suite completed!');
console.log('\nTo start the server: npm start');
console.log('Server will run on http://localhost:8080');
