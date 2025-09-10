// src/coinselect.js (BACKEND) – prefer fewer inputs
export function estimateInputVbytes(t='p2wpkh'){ if(t==='p2tr') return 58; if(t==='p2wpkh') return 68; return 148; }
export function estimateOutputVbytes(t='p2wpkh'){ if(t==='p2tr') return 43; if(t==='p2wpkh') return 31; return 34; }
export const calcFee = (vb, fr) => Math.ceil(vb*fr);

function needFee(nIn, changeType, destType) {
  const overhead = 10;
  const vb = overhead + nIn*estimateInputVbytes(destType) + estimateOutputVbytes(destType) + estimateOutputVbytes(changeType);
  return vb;
}

export function selectUtxos(utxos, target, feerate, changeType='p2wpkh', inType='p2wpkh'){
  const sats = utxos.map(u => ({...u, sats: Math.round((u.amount_btc ?? u.amount)*1e8)})).filter(u=>u.sats>0);
  // 1) Try 1-input exact/cover
  for (const u of sats){
    const fee = calcFee(needFee(1, changeType, inType), feerate);
    if (u.sats >= target + fee) return { selected: [u], total: u.sats, fee, change: u.sats - target - fee };
  }
  // 2) Try 2-input combos
  for (let i=0;i<sats.length;i++){
    for (let j=i+1;j<sats.length;j++){
      const tot = sats[i].sats + sats[j].sats;
      const fee = calcFee(needFee(2, changeType, inType), feerate);
      if (tot >= target + fee) return { selected: [sats[i], sats[j]], total: tot, fee, change: tot - target - fee };
    }
  }
  // 3) Try 3-input combos (bounded)
  const N = Math.min(12, sats.length);
  for (let i=0;i<N;i++) for (let j=i+1;j<N;j++) for (let k=j+1;k<N;k++){
    const tot = sats[i].sats + sats[j].sats + sats[k].sats;
    const fee = calcFee(needFee(3, changeType, inType), feerate);
    if (tot >= target + fee) return { selected: [sats[i],sats[j],sats[k]], total: tot, fee, change: tot - target - fee };
  }
  // 4) Fallback greedy (desc)
  const sorted = [...sats].sort((a,b)=>b.sats - a.sats);
  let sel=[], sum=0, n=0;
  for (const u of sorted){
    sel.push(u); sum+=u.sats; n++;
    const fee = calcFee(needFee(n, changeType, inType), feerate);
    if (sum >= target + fee) return { selected: sel, total: sum, fee, change: sum - target - fee };
  }
  return { selected:[], total:0, fee:0, change:0 };
}
