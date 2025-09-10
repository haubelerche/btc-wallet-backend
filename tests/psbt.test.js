import test from 'node:test';
import assert from 'node:assert/strict';
import * as btc from 'bitcoinjs-lib';
import { buildPsbt } from '../src/psbt.js';
import { buildAndSignPsbt } from '../src/psbt-enhanced.js';
import { deriveAddressesFromPrivateKey } from '../src/wallet.js';

const PRIV = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const wallet = deriveAddressesFromPrivateKey(PRIV, 'regtest');
const address = wallet.addresses.p2wpkh; // bech32 regtest address

function fakePrevTx(scriptHex, valueBtc){
  return {
    hex: '00',
    vout: [ { value: valueBtc, scriptPubKey: { hex: scriptHex } } ]
  };
}

function scriptForAddress(addr){
  // replicate bitcoinjs payment to get script
  const net = btc.networks.regtest;
  const payment = btc.payments.p2wpkh({ address: addr, network: net });
  return payment.output.toString('hex');
}

const scriptHex = scriptForAddress(address);

const INPUT_TXID = '1'.repeat(64);

const mockGetRaw = async (txid) => {
  assert.equal(txid, INPUT_TXID);
  return fakePrevTx(scriptHex, 0.0002); // 20_000 sats
};

test('buildPsbt unsigned base64 output', async () => {
  const psbtB64 = await buildPsbt({ network:'regtest', inputs:[{ txid: INPUT_TXID, vout:0 }], outputs:[{ address, value: 5_000 }], getRawTransactionFn: mockGetRaw });
  assert.ok(psbtB64.startsWith('cHNidP')); // base64 magic
});

test('buildAndSignPsbt returns signed tx data', async () => {
  const signed = await buildAndSignPsbt({ network:'regtest', inputs:[{ txid: INPUT_TXID, vout:0, address }], outputs:[{ address, value: 6_000 }], keyPair: wallet.keyPair, wallet, getRawTransactionFn: mockGetRaw });
  assert.ok(signed.psbt.startsWith('cHNidP'));
  assert.match(signed.hex, /^[0-9a-f]+$/);
  assert.equal(typeof signed.txid, 'string');
  assert.ok(signed.vsize > 0);
});

