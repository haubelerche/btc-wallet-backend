import * as btc from 'bitcoinjs-lib';
import { getRawTransaction } from './rpc.js';

export async function buildPsbt({ network='regtest', inputs, outputs, getRawTransactionFn = getRawTransaction }){
  const net = network==='regtest'? btc.networks.regtest : network==='testnet'? btc.networks.testnet : btc.networks.bitcoin;
  const psbt = new btc.Psbt({ network: net });
  for(const i of inputs){
    const prev = await getRawTransactionFn(i.txid);
    const v = prev.vout[i.vout];
    psbt.addInput({
      hash: i.txid,
      index: i.vout,
      witnessUtxo: { script: Buffer.from(v.scriptPubKey.hex,'hex'), value: Math.round(v.value*1e8) }
    });
  }
  for(const o of outputs){
    if(o.address) psbt.addOutput({ address: o.address, value: o.value });
    else if(o.script) psbt.addOutput({ script: Buffer.from(o.script,'hex'), value: o.value });
  }
  return psbt.toBase64();
}
