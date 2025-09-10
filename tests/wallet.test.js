import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWallet, restoreWalletFromMnemonic, deriveAddressesFromPrivateKey, getScriptTypeFromAddress } from '../src/wallet.js';

const SAMPLE_PRIV = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('deriveAddressesFromPrivateKey deterministic addresses', () => {
  const w1 = deriveAddressesFromPrivateKey(SAMPLE_PRIV, 'regtest');
  const w2 = deriveAddressesFromPrivateKey(SAMPLE_PRIV, 'regtest');
  assert.deepEqual(w1.addresses, w2.addresses);
  assert.equal(typeof w1.publicKey, 'string');
});

test('generateWallet then restore from mnemonic yields identical addresses', () => {
  const g = generateWallet('regtest');
  const r = restoreWalletFromMnemonic(g.mnemonic, 'regtest');
  assert.deepEqual(g.addresses, r.addresses);
});

test('getScriptTypeFromAddress classification', () => {
  const w = deriveAddressesFromPrivateKey(SAMPLE_PRIV, 'regtest');
  assert.equal(getScriptTypeFromAddress(w.addresses.p2wpkh), 'p2wpkh');
  assert.equal(getScriptTypeFromAddress(w.addresses.p2sh_p2wpkh), 'p2sh-p2wpkh');
  assert.equal(getScriptTypeFromAddress(w.addresses.p2pkh), 'p2pkh');
});

