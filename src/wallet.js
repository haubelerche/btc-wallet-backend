import * as btc from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

// Initialize factories with secp256k1
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

// Initialize ECC library for bitcoinjs-lib
btc.initEccLib(ecc);

/**
 * Derives all possible address types from a private key
 * Following the detailed flow: Step 1 - From private key, derive all possible address types
 */
export function deriveAddressesFromPrivateKey(privateKeyHex, network = 'regtest') {
    const net = getNetwork(network);
    const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKeyHex, 'hex'), { network: net });
    
    const addresses = {
        // P2PKH (Legacy) - Starts with 1 (mainnet) or m/n (testnet/regtest)
        p2pkh: btc.payments.p2pkh({ pubkey: keyPair.publicKey, network: net }).address,
        
        // P2SH-P2WPKH (Nested SegWit) - Starts with 3 (mainnet) or 2 (testnet/regtest)
        p2sh_p2wpkh: btc.payments.p2sh({
            redeem: btc.payments.p2wpkh({ pubkey: keyPair.publicKey, network: net }),
            network: net
        }).address,
        
        // P2WPKH (Native SegWit) - Starts with bc1 (mainnet) or bcrt1 (regtest)
        p2wpkh: btc.payments.p2wpkh({ pubkey: keyPair.publicKey, network: net }).address
    };
    
    return {
        privateKey: privateKeyHex,
        publicKey: keyPair.publicKey.toString('hex'),
        addresses,
        keyPair
    };
}

/**
 * Generate a new wallet with mnemonic
 */
export function generateWallet(network = 'regtest') {
    const mnemonic = bip39.generateMnemonic();
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed);
    
    // Using standard derivation path m/44'/0'/0'/0/0 for Bitcoin
    const path = "m/44'/0'/0'/0/0";
    const child = root.derivePath(path);
    
    const privateKey = child.privateKey.toString('hex');
    const wallet = deriveAddressesFromPrivateKey(privateKey, network);
    
    return {
        mnemonic,
        ...wallet,
        derivationPath: path
    };
}

/**
 * Restore wallet from mnemonic
 */
export function restoreWalletFromMnemonic(mnemonic, network = 'regtest') {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic');
    }
    
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed);
    
    const path = "m/44'/0'/0'/0/0";
    const child = root.derivePath(path);
    
    const privateKey = child.privateKey.toString('hex');
    const wallet = deriveAddressesFromPrivateKey(privateKey, network);
    
    return {
        mnemonic,
        ...wallet,
        derivationPath: path
    };
}

/**
 * Get network object from string
 */
export function getNetwork(network) {
    switch (network) {
        case 'regtest':
            return btc.networks.regtest;
        case 'testnet':
            return btc.networks.testnet;
        case 'mainnet':
        case 'bitcoin':
            return btc.networks.bitcoin;
        default:
            return btc.networks.regtest;
    }
}

/**
 * Get payment object for address type
 */
export function getPaymentForAddress(address, keyPair, network) {
    const net = getNetwork(network);
    
    // Detect address type and return appropriate payment object
    if (address.startsWith('bc1') || address.startsWith('tb1') || address.startsWith('bcrt1')) {
        // P2WPKH (Native SegWit)
        return btc.payments.p2wpkh({ pubkey: keyPair.publicKey, network: net });
    } else if (address.startsWith('3') || address.startsWith('2')) {
        // P2SH-P2WPKH (Nested SegWit)
        return btc.payments.p2sh({
            redeem: btc.payments.p2wpkh({ pubkey: keyPair.publicKey, network: net }),
            network: net
        });
    } else {
        // P2PKH (Legacy)
        return btc.payments.p2pkh({ pubkey: keyPair.publicKey, network: net });
    }
}

/**
 * Get script type from address
 */
export function getScriptTypeFromAddress(address) {
    if (address.startsWith('bc1') || address.startsWith('tb1') || address.startsWith('bcrt1')) {
        return 'p2wpkh';
    } else if (address.startsWith('3') || address.startsWith('2')) {
        return 'p2sh-p2wpkh';
    } else {
        return 'p2pkh';
    }
}
