import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUtxosForWallet, selectOptimalUtxos } from '../src/utxo-collector.js';
import { deriveAddressesFromPrivateKey } from '../src/wallet.js';

const PRIV = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeUtxo(address, sats, scriptType='p2wpkh'){ return { txid: 'f'.repeat(64), vout: 0, address, amount: sats/1e8, amount_sats: sats, confirmations: 1, spendable: true, scriptType }; }

test('collectUtxosForWallet degraded mode when rpc unreachable', async () => {
  const res = await collectUtxosForWallet(PRIV, 'regtest', { pingRpcFn: async ()=>false, deriveAddressesFn: deriveAddressesFromPrivateKey });
  assert.equal(res.degraded, true);
  assert.equal(res.totalBalance, 0);
});

test('selectOptimalUtxos prefers segwit types first', () => {
  const wallet = deriveAddressesFromPrivateKey(PRIV, 'regtest');
  const utxos = [
    makeUtxo(wallet.addresses.p2pkh, 8000, 'p2pkh'),
    makeUtxo(wallet.addresses.p2wpkh, 5000, 'p2wpkh'),
    makeUtxo(wallet.addresses.p2sh_p2wpkh, 7000, 'p2sh-p2wpkh')
  ];
  const res = selectOptimalUtxos(utxos, 4000, 1);
  assert.equal(res.scriptType, 'p2wpkh');
  assert.equal(res.selected.length, 1);
});

test('selectOptimalUtxos mixed fallback when single types insufficient', () => {
  const wallet = deriveAddressesFromPrivateKey(PRIV, 'regtest');
  const utxos = [
    makeUtxo(wallet.addresses.p2wpkh, 2000, 'p2wpkh'),
    makeUtxo(wallet.addresses.p2pkh, 1500, 'p2pkh'),
    makeUtxo(wallet.addresses.p2sh_p2wpkh, 1200, 'p2sh-p2wpkh')
  ];
  const target = 4000; // requires combining
  const res = selectOptimalUtxos(utxos, target, 1);
  assert.ok(res.selected.length >= 2);
  assert.ok(['p2wpkh','p2sh-p2wpkh','p2pkh','mixed'].includes(res.scriptType));
});

