import axios from 'axios';
import { BTC_RPC_URL, BTC_RPC_USER, BTC_RPC_PASS } from './config.js';

let idCounter = 0;
export async function rpc(method, params=[]) {
  const payload = { jsonrpc: "1.0", id: idCounter++, method, params };
  const auth = { username: BTC_RPC_USER, password: BTC_RPC_PASS };
  const { data } = await axios.post(BTC_RPC_URL, payload, { auth });
  if (data.error) throw new Error(data.error.message || String(data.error));
  return data.result;
}

export const getNetworkInfo = () => rpc('getblockchaininfo');
export async function estimateSmartFee(confTarget=6){
  try{
    const r = await rpc('estimatesmartfee',[confTarget,'CONSERVATIVE']);
    if (r.feerate && r.feerate>0) return Math.max(1, Math.round(r.feerate*1e8/1000));
  }catch{}
  return null;
}
export const getUtxosForAddresses = (addrs, minconf=0) => rpc('listunspent',[minconf,9999999,addrs]);
export const getRawTransaction = (txid) => rpc('getrawtransaction',[txid,true]);
export const sendRawTransaction = (hex) => rpc('sendrawtransaction',[hex]);

// watch + history
export async function importWatchOnly(addresses, rescan=false){
  const now = Math.floor(Date.now()/1000);
  const reqs = addresses.map(a => ({ scriptPubKey:{ address:a }, timestamp: now, watchonly: true }));
  return rpc('importmulti', [reqs, { rescan }]);
}
export const listTransactions = (label="*", count=200, skip=0, includeWatchOnly=true) =>
  rpc('listtransactions',[label,count,skip,includeWatchOnly]);

// Lightweight connectivity check
export async function pingRpc(){
  try{ await getNetworkInfo(); return true; }catch{ return false; }
}
