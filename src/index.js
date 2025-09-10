import express from 'express';
import morgan from 'morgan';
import validator from 'validator';
import invariant from 'tiny-invariant';
import { PORT, FEE_FALLBACK } from './config.js';
import { getNetworkInfo, estimateSmartFee, getUtxosForAddresses, sendRawTransaction, importWatchOnly, listTransactions, pingRpc } from './rpc.js';
import { selectUtxos } from './coinselect.js';
import { buildPsbt } from './psbt.js';
import { generateWallet, restoreWalletFromMnemonic, deriveAddressesFromPrivateKey } from './wallet.js';
import { createTransactionBuilder, quickSend } from './transaction-builder.js';
import { collectUtxosForWallet } from './utxo-collector.js';

const app = express();
app.use(express.json({ limit:'1mb' }));
app.use(morgan('dev'));

// Simple async retry for RPC connectivity on startup
async function waitForRpc(maxAttempts=10, delayMs=1000){
  for(let i=1;i<=maxAttempts;i++){
    const ok = await pingRpc();
    if(ok){ console.log(`RPC connectivity established (attempt ${i})`); return true; }
    console.log(`RPC not ready yet (attempt ${i}/${maxAttempts})`);
    await new Promise(r=>setTimeout(r, delayMs));
  }
  console.warn('Proceeding without RPC connectivity (will return degraded health)');
  return false;
}

app.get('/health', async (req,res)=>{
  const rpc_ok = await pingRpc();
  res.json({ ok: true, rpc_ok });
});
app.get('/network', async (req,res,next)=>{ try{ res.json(await getNetworkInfo()); }catch(e){ next(e); } });

app.get('/fees/estimate', async (req,res,next)=>{
  try{ const satvb = await estimateSmartFee(parseInt(req.query.conf||'6')); res.json({ sat_per_vbyte: satvb ?? FEE_FALLBACK }); }
  catch(e){ next(e); }
});

app.post('/utxos', async (req,res,next)=>{
  try{
    const { addresses, minconf=0 } = req.body||{};
    invariant(Array.isArray(addresses) && addresses.length, 'addresses[] required');
    const utxos = await getUtxosForAddresses(addresses, minconf);
    res.json({ utxos: utxos.map(u=>({
      txid: u.txid, vout: u.vout, address: u.address,
      amount_btc: u.amount, amount_sats: Math.round(u.amount*1e8),
      confirmations: u.confirmations, spendable: u.spendable
    })) });
  }catch(e){ next(e); }
});

app.post('/optimize/inputs', async (req,res,next)=>{
  try{
    const { utxos, target_sats, feerate = FEE_FALLBACK, change_type='p2wpkh', input_type='p2wpkh' } = req.body||{};
    invariant(Array.isArray(utxos) && utxos.length, 'utxos[] required');
    invariant(Number.isFinite(target_sats) && target_sats>0, 'target_sats required');
    const mapped = utxos.map(u=>({ amount: u.amount_btc ?? (u.amount_sats/1e8), ...u }));
    const sel = selectUtxos(mapped, target_sats, feerate, change_type, input_type);
    if (sel.error){ throw new Error('INSUFFICIENT_FUNDS'); }
    res.json({
      selected: sel.selected.map(u=>({ txid:u.txid, vout:u.vout, address:u.address, amount_sats: Math.round(u.amount*1e8) })),
      total_in: sel.total, fee: sel.fee, change: sel.change
    });
  }catch(e){ next(e); }
});

app.post('/tx/build', async (req,res,next)=>{
  try{
    const { inputs, outputs, network='regtest' } = req.body||{};
    invariant(Array.isArray(inputs) && inputs.length, 'inputs[] required');
    invariant(Array.isArray(outputs) && outputs.length, 'outputs[] required');
    const psbt = await buildPsbt({ network, inputs, outputs });
    res.json({ psbt_base64: psbt });
  }catch(e){ next(e); }
});

app.post('/tx/broadcast', async (req,res,next)=>{
  try{ const { hex } = req.body||{}; invariant(typeof hex==='string' && validator.isHexadecimal(hex), 'hex required'); const txid = await sendRawTransaction(hex); res.json({ txid }); }catch(e){ next(e); }
});

// --- new features: watch + tx history
app.post('/watch', async (req,res,next)=>{
  try{ const { addresses, rescan=false } = req.body||{}; invariant(Array.isArray(addresses)&&addresses.length,'addresses[] required'); const r = await importWatchOnly(addresses, rescan); res.json({ ok:true, result:r }); }catch(e){ next(e); }
});
app.post('/address/txs', async (req,res,next)=>{
  try{
    const { addresses, count=200 } = req.body||{};
    invariant(Array.isArray(addresses)&&addresses.length,'addresses[] required');
    const set = new Set(addresses);
    const items = await listTransactions("*", count, 0, true);
    const txs = items.filter(x=>x.address && set.has(x.address)).map(x=>({
      address: x.address, category: x.category, amount_btc: x.amount, confirmations: x.confirmations, txid: x.txid, time: x.time
    }));
    res.json({ txs });
  }catch(e){ next(e); }
});

// === NEW COMPREHENSIVE BITCOIN FLOW ENDPOINTS ===

// Generate new wallet
app.post('/wallet/generate', async (req, res, next) => {
  try {
    const { network = 'regtest' } = req.body || {};
    const wallet = generateWallet(network);
    res.json({
      mnemonic: wallet.mnemonic,
      addresses: wallet.addresses,
      publicKey: wallet.publicKey,
      derivationPath: wallet.derivationPath
      // Note: privateKey is not returned for security
    });
  } catch (e) { next(e); }
});

// Restore wallet from mnemonic
app.post('/wallet/restore', async (req, res, next) => {
  try {
    const { mnemonic, network = 'regtest' } = req.body || {};
    invariant(typeof mnemonic === 'string', 'mnemonic required');
    const wallet = restoreWalletFromMnemonic(mnemonic, network);
    res.json({
      addresses: wallet.addresses,
      publicKey: wallet.publicKey,
      derivationPath: wallet.derivationPath
    });
  } catch (e) { next(e); }
});

// Derive addresses from private key
app.post('/wallet/derive', async (req, res, next) => {
  try {
    const { privateKey, network = 'regtest' } = req.body || {};
    invariant(typeof privateKey === 'string' && validator.isHexadecimal(privateKey), 'privateKey (hex) required');
    const wallet = deriveAddressesFromPrivateKey(privateKey, network);
    res.json({
      addresses: wallet.addresses,
      publicKey: wallet.publicKey
    });
  } catch (e) { next(e); }
});

// Complete UTXO collection (Steps 1-2)
app.post('/wallet/utxos', async (req, res, next) => {
  try {
    const { privateKey, network = 'regtest' } = req.body || {};
    invariant(typeof privateKey === 'string' && validator.isHexadecimal(privateKey), 'privateKey (hex) required');
    
    const result = await collectUtxosForWallet(privateKey, network);
    res.json({
      wallet: {
        addresses: result.wallet.addresses,
        publicKey: result.wallet.publicKey
      },
      utxosByType: result.utxosByType,
      totalUtxos: result.totalUtxos.length,
      totalBalance: result.totalBalance,
      utxos: result.totalUtxos.map(u => ({
        txid: u.txid,
        vout: u.vout,
        address: u.address,
        amount_btc: u.amount,
        amount_sats: u.amount_sats,
        confirmations: u.confirmations,
        scriptType: u.scriptType
      }))
    });
  } catch (e) { next(e); }
});

// Get wallet balance
app.post('/wallet/balance', async (req, res, next) => {
  try {
    const { privateKey, network = 'regtest' } = req.body || {};
    invariant(typeof privateKey === 'string' && validator.isHexadecimal(privateKey), 'privateKey (hex) required');
    
    const builder = createTransactionBuilder(privateKey, network);
    const balance = await builder.getBalance();
    res.json(balance);
  } catch (e) { next(e); }
});

// Watch wallet addresses
app.post('/wallet/watch', async (req, res, next) => {
  try {
    const { privateKey, network = 'regtest', rescan = false } = req.body || {};
    invariant(typeof privateKey === 'string' && validator.isHexadecimal(privateKey), 'privateKey (hex) required');
    
    const builder = createTransactionBuilder(privateKey, network);
    const result = await builder.watchAddresses(rescan);
    res.json({ ok: true, result });
  } catch (e) { next(e); }
});

// Complete transaction flow (Steps 1-8)
app.post('/transaction/send', async (req, res, next) => {
  try {
    const { 
      privateKey, 
      recipientAddress, 
      amountSats, 
      network = 'regtest',
      feeRate = FEE_FALLBACK,
      changeAddress = null
    } = req.body || {};
    
    invariant(typeof privateKey === 'string' && validator.isHexadecimal(privateKey), 'privateKey (hex) required');
    invariant(typeof recipientAddress === 'string', 'recipientAddress required');
    invariant(Number.isFinite(amountSats) && amountSats > 0, 'amountSats (positive number) required');
    
    const result = await quickSend(privateKey, recipientAddress, amountSats, {
      network,
      feeRate,
      changeAddress
    });
    
    res.json({
      success: true,
      txid: result.txid,
      amountSats: result.amountSats,
      fee: result.fee,
      change: result.change,
      transaction: {
        hex: result.transaction.hex,
        size: result.transaction.size,
        vsize: result.transaction.vsize,
        weight: result.transaction.weight
      }
    });
  } catch (e) { next(e); }
});

// Build transaction without broadcasting (Steps 1-7)
app.post('/transaction/build', async (req, res, next) => {
  try {
    const { 
      privateKey, 
      recipientAddress, 
      amountSats, 
      network = 'regtest',
      feeRate = FEE_FALLBACK,
      changeAddress = null
    } = req.body || {};
    
    invariant(typeof privateKey === 'string' && validator.isHexadecimal(privateKey), 'privateKey (hex) required');
    invariant(typeof recipientAddress === 'string', 'recipientAddress required');
    invariant(Number.isFinite(amountSats) && amountSats > 0, 'amountSats (positive number) required');
    
    const builder = createTransactionBuilder(privateKey, network);
    await builder.collectUtxos();
    builder.selectUtxos(amountSats, feeRate);
    const transaction = await builder.buildTransaction(recipientAddress, amountSats, feeRate, changeAddress);
    
    res.json({
      transaction: {
        hex: transaction.hex,
        psbt: transaction.psbt,
        txid: transaction.txid,
        size: transaction.size,
        vsize: transaction.vsize,
        weight: transaction.weight
      },
      selection: {
        inputCount: builder.selectedUtxos.selected.length,
        totalInput: builder.selectedUtxos.total,
        fee: builder.selectedUtxos.fee,
        change: builder.selectedUtxos.change,
        scriptType: builder.selectedUtxos.scriptType
      }
    });
  } catch (e) { next(e); }
});

// Mine block (regtest only)
app.post('/regtest/mine', async (req, res, next) => {
  try {
    const { privateKey, network = 'regtest', blocks = 1 } = req.body || {};
    invariant(network === 'regtest', 'Mining only available in regtest mode');
    
    if (privateKey) {
      const builder = createTransactionBuilder(privateKey, network);
      const blockHashes = [];
      for (let i = 0; i < blocks; i++) {
        const blockHash = await builder.mineBlock();
        blockHashes.push(blockHash);
      }
      res.json({ blocks: blockHashes });
    } else {
      // Mine to default address if no private key provided
      const { rpc } = await import('./rpc.js');
      const address = 'bcrt1qz5f6kts27vq6rer3qkwdzfr0zlptwgyetwlm6m'; // default regtest address
      const blockHashes = await rpc('generatetoaddress', [blocks, address]);
      res.json({ blocks: blockHashes });
    }
  } catch (e) { next(e); }
});

app.use((err,req,res,next)=>{ console.error(err); res.status(400).json({ error: err.message||String(err) }); });

// Graceful shutdown & unhandled rejection/exception logging
process.on('unhandledRejection', (reason)=>{ console.error('UnhandledRejection:', reason); });
process.on('uncaughtException', (err)=>{ console.error('UncaughtException:', err); });

// Automatic port fallback logic
let server; // will hold the active server instance
const MAX_PORT_ATTEMPTS = 5; // tries PORT, PORT+1, ...

function startServer(port, attemptsLeft = MAX_PORT_ATTEMPTS) {
  server = app.listen(port, async () => {
    console.log(`API listening on :${port}`);
    if (port !== Number(PORT)) {
      console.log(`(Original requested port ${PORT} was busy)`);
    }
    await waitForRpc();
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 1) {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      setTimeout(() => startServer(port + 1, attemptsLeft - 1), 300);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} in use and no fallback ports left. Set PORT env var to a free port.`);
      process.exit(1);
    } else {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  });
}

if (!process.env.SKIP_SERVER) {
  startServer(Number(PORT));
} else {
  console.log('SKIP_SERVER=1 set - server not started (test mode)');
}

function gracefulShutdown(signal){
  console.log(`\nReceived ${signal}, shutting down...`);
  if (server) {
    server.close(()=>{ console.log('HTTP server closed'); process.exit(0); });
  } else {
    process.exit(0);
  }
}
process.on('SIGINT', ()=>gracefulShutdown('SIGINT'));
process.on('SIGTERM', ()=>gracefulShutdown('SIGTERM'));

export { app, startServer };
