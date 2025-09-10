import test from 'node:test';
import assert from 'node:assert/strict';
import { selectUtxos, DUST_THRESHOLD } from '../src/coinselect.js';

function satsToAmount(s){ return s/1e8; }

const baseUtxos = [
  { txid:'a'.repeat(64), vout:0, amount: satsToAmount(10_000) },
  { txid:'b'.repeat(64), vout:1, amount: satsToAmount(6_000) },
  { txid:'c'.repeat(64), vout:2, amount: satsToAmount(3_000) },
];

test('selectUtxos single utxo exact (with change)', ()=>{
  const target = 5_000; // sats
  const res = selectUtxos(baseUtxos, target, 1); // 1 sat/vB
  assert.equal(res.error, null);
  assert.ok(res.total >= target + res.fee);
  assert.ok(res.change >= 0);
});

test('selectUtxos multiple utxos aggregation', ()=>{
  const target = 17_000; // requires at least two utxos
  const res = selectUtxos(baseUtxos, target, 1);
  assert.equal(res.error, null);
  assert.ok(res.selected.length >= 2);
  assert.ok(res.total >= target + res.fee);
});

test('selectUtxos insufficient funds', ()=>{
  const target = 50_000; // too high
  const res = selectUtxos(baseUtxos, target, 1);
  assert.equal(res.error, 'INSUFFICIENT_FUNDS');
  assert.equal(res.selected.length, 0);
});

test('selectUtxos dust change is converted to fee', ()=>{
  // pick parameters to produce dust change (<546)
  const utxos = [ { txid:'d'.repeat(64), vout:0, amount: satsToAmount(10_000) } ];
  const target = 9_500; // sats
  const res = selectUtxos(utxos, target, 1);
  assert.equal(res.error, null);
  assert.equal(res.change, 0);
  assert.ok(res.droppedDust > 0 && res.droppedDust < DUST_THRESHOLD);
  // fee should consume leftover
  assert.equal(res.total - target - res.fee, 0);
});

test('selectUtxos prefers larger utxos first (descending sort)', ()=>{
  const target = 2_500; // will pick largest (10k) first not smallest (3k)
  const res = selectUtxos(baseUtxos, target, 1);
  assert.equal(res.error, null);
  assert.equal(res.selected[0].amount, satsToAmount(10_000));
});

