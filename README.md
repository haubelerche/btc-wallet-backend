# Bitcoin Wallet Backend - Complete Flow Implementation

This implementation follows the detailed Bitcoin transaction flow as specified, ensuring proper handling of all address types (P2PKH, P2SH-P2WPKH, P2WPKH) and complete UTXO management.

## Quick Start ( IF your mine teammate, YOU HAVE TO DOWNLOAD DOCKER, SIGN IN BY GIT HUB OR GMAIL THEN RUN BUOC 3, and run the project npm run dev
1. Clone repository
2. Copy environment template:
   `cp .env.example .env` (Windows: `copy .env.example .env`)
3. Start full stack (API + bitcoind regtest):
   `docker compose up --build`
4. Wait until logs show: `RPC connectivity established`
5. Check health:
   `curl http://localhost:8080/health` -> `{ "ok": true, "rpc_ok": true }`
6. Generate wallet:
   `curl -X POST http://localhost:8080/wallet/generate -H "Content-Type: application/json" -d '{"network":"regtest"}'`
7. Mine initial blocks so funds mature (if you send coinbase outputs):
   `curl -X POST http://localhost:8080/regtest/mine -H "Content-Type: application/json" -d '{"blocks":101}'`

### Run Without docker compose (Plain docker run)
If you prefer using raw `docker run` commands instead of docker compose:

1. Build the API image
```
docker build -t btc-wallet-api .
```
2. Create an isolated network (so containers can resolve each other by name)
```
docker network create btcnet
```
3. Start bitcoind (regtest)
```
docker run -d --name bitcoind --network btcnet \
  -p 18443:18443 -p 18444:18444 \
  ruimarinho/bitcoin-core:27.0 \
  -regtest=1 -server=1 -rpcallowip=0.0.0.0/0 -rpcbind=0.0.0.0 \
  -rpcuser=devuser -rpcpassword=devpass -txindex=1 -fallbackfee=0.0002
```
4. Start the API container (pointing to the bitcoind container by name)
```
docker run -d --name wallet-api --network btcnet \
  -p 8080:8080 \
  -e PORT=8080 \
  -e BTC_RPC_URL=http://bitcoind:18443 \
  -e BTC_RPC_USER=devuser \
  -e BTC_RPC_PASS=devpass \
  -e FEE_FALLBACK=2.0 \
  btc-wallet-api
```
5. Health check
```
curl http://localhost:8080/health
```

#### Alternate: Use Host bitcoind
If you already run `bitcoind` directly on the host (listening on 18443) you can run only the API:
```
# Ensure .env has BTC_RPC_URL pointing to host. On Mac/Windows docker can use host.docker.internal
# Example .env overrides:
# BTC_RPC_URL=http://host.docker.internal:18443
# BTC_RPC_USER=devuser
# BTC_RPC_PASS=devpass

docker build -t btc-wallet-api .
docker run -d --name wallet-api -p 8080:8080 --env-file .env btc-wallet-api
```
Linux note: replace `host.docker.internal` with the host's LAN IP or run with `--network host` (not recommended if you also need port mapping portability).

To stop and clean up:
```
docker rm -f wallet-api bitcoind 2>/dev/null || true
docker network rm btcnet 2>/dev/null || true
```

## Degraded Mode (No RPC Yet)
If the API starts before bitcoind is ready:
- `/health` returns `{ ok: true, rpc_ok: false }`
- UTXO collection returns empty `{ degraded: true }` internally
- Once bitcoind comes online, no restart is required; endpoints will begin functioning.

## Testing (Local, Lightweight)
Run non-network tests (address derivation & structure):
```
npm install
npm test
```
If bitcoind is not running, tests still pass (UTXO collection uses degraded mode gracefully).

## Complete Flow Implementation

### General Flow (8 Steps)
1. ✅ From private key, derive all possible address types
2. ✅ Derive all UTXOs of each address type  
3. ✅ Collect enough UTXOs to send (optimized selection)
4. ✅ Sign UTXOs using SDK
5. ✅ Build the signed transaction for each UTXO type
6. ✅ Broadcast to the bitcoin blockchain

### Detailed Flow Implementation
1. ✅ **Address Derivation** - `src/wallet.js`
   - P2PKH (Legacy): Starts with 1 (mainnet) or m/n (testnet/regtest)
   - P2SH-P2WPKH (Nested SegWit): Starts with 3 (mainnet) or 2 (testnet/regtest)  
   - P2WPKH (Native SegWit): Starts with bc1 (mainnet) or bcrt1 (regtest)

2. ✅ **UTXO Collection** - `src/utxo-collector.js`
   - Uses `listunspent` for watched addresses
   - Falls back to `scantxoutset` for external wallets
   - Handles both Bitcoin Core and SDK-generated wallets

3. ✅ **Optimal UTXO Selection** - `src/coinselect.js` + `src/utxo-collector.js`
   - Prefers SegWit UTXOs (lower fees)
   - Minimizes number of inputs
   - Supports mixed UTXO types when necessary

4. ✅ **Message Construction** - `src/psbt-enhanced.js`
   - Creates unsigned messages for each UTXO
   - Handles different script types appropriately

5. ✅ **Signing & Validation** - `src/psbt-enhanced.js`
   - Signs each UTXO with proper canonical form
   - Validates signatures before finalizing

6. ✅ **Transaction Building** - `src/psbt-enhanced.js`
   - Builds signed transaction for each UTXO type
   - Handles SegWit witness data correctly

7. ✅ **Message Assembly** - `src/psbt-enhanced.js`
   - Gathers all signed transactions
   - Finalizes complete transaction

8. ✅ **Broadcasting** - `src/transaction-builder.js`
   - Broadcasts to Bitcoin blockchain
   - Provides regtest mining reminder

## API Endpoints

### Wallet Management
- `POST /wallet/generate` - Generate new wallet with mnemonic
- `POST /wallet/restore` - Restore wallet from mnemonic  
- `POST /wallet/derive` - Derive addresses from private key
- `POST /wallet/balance` - Get wallet balance across all address types
- `POST /wallet/utxos` - Collect all UTXOs for wallet (Steps 1-2)
- `POST /wallet/watch` - Watch wallet addresses in Bitcoin Core

### Transaction Flow
- `POST /transaction/send` - Complete transaction flow (Steps 1-8)
- `POST /transaction/build` - Build transaction without broadcasting (Steps 1-7)
- `POST /tx/broadcast` - Broadcast pre-built transaction (Step 8)

### Regtest Utilities
- `POST /regtest/mine` - Mine blocks for transaction confirmation

### Legacy Endpoints (Maintained for compatibility)
- `POST /utxos` - Get UTXOs for specific addresses
- `POST /optimize/inputs` - UTXO selection optimization
- `POST /tx/build` - Basic PSBT building

## Address Type Support

### P2PKH (Legacy)
- **Format**: Starts with `1` (mainnet), `m`/`n` (testnet/regtest)
- **Features**: Original Bitcoin address format
- **Fee Cost**: Highest (148 vbytes per input)
- **Use Case**: Maximum compatibility

### P2SH-P2WPKH (Nested SegWit) 
- **Format**: Starts with `3` (mainnet), `2` (testnet/regtest)
- **Features**: SegWit wrapped in P2SH for compatibility
- **Fee Cost**: Medium (91 vbytes per input)
- **Use Case**: SegWit benefits with legacy wallet support

### P2WPKH (Native SegWit)
- **Format**: Starts with `bc1` (mainnet), `bcrt1` (regtest)
- **Features**: Native SegWit, most efficient
- **Fee Cost**: Lowest (68 vbytes per input)
- **Use Case**: Modern transactions, best fee efficiency

## Regtest Setup

The implementation works with Bitcoin Core regtest mode:

```bash
# Bitcoin Core configuration (~/.bitcoin/bitcoin.conf)
regtest=1
server=1
daemon=1
rpcuser=yourusername
rpcpassword=yourpassword
rpcallowip=127.0.0.1
fallbackfee=0.0001
txindex=1

# Start Bitcoin daemon
bitcoind -regtest -txindex -daemon

# Create and load wallet
bitcoin-cli -regtest createwallet "testwallet"
bitcoin-cli -regtest loadwallet "testwallet"

# Generate initial blocks
bitcoin-cli -regtest generatetoaddress 101 <miner_address>
```

## Environment Configuration

Create `.env` file:
```
PORT=8080
BTC_RPC_URL=http://localhost:18443
BTC_RPC_USER=yourusername
BTC_RPC_PASS=yourpassword
FEE_FALLBACK=2.0
```

## Usage Examples

### Generate New Wallet
```bash
curl -X POST http://localhost:8080/wallet/generate \
  -H "Content-Type: application/json" \
  -d '{"network": "regtest"}'
```

### Send Bitcoin (Complete Flow)
```bash
curl -X POST http://localhost:8080/transaction/send \
  -H "Content-Type: application/json" \
  -d '{
    "privateKey": "your_private_key_hex",
    "recipientAddress": "bcrt1qexampleaddress",
    "amountSats": 100000,
    "network": "regtest",
    "feeRate": 2
  }'
```

### Mine Block (Regtest)
```bash
curl -X POST http://localhost:8080/regtest/mine \
  -H "Content-Type: application/json" \
  -d '{"blocks": 1}'
```

## Key Features

### UTXO Management
- ✅ Automatic detection of wallet UTXOs across all address types
- ✅ Support for both Bitcoin Core and external wallets
- ✅ Intelligent UTXO selection minimizing fees
- ✅ Mixed UTXO type handling when necessary

### Transaction Building  
- ✅ Proper PSBT construction for all address types
- ✅ Correct witness data handling for SegWit
- ✅ Signature validation and canonical form checking
- ✅ Fee estimation and optimization

### Security
- ✅ Private keys never stored or logged
- ✅ Proper key derivation using BIP32/BIP39
- ✅ Signature validation before broadcasting
- ✅ Input/output validation

### Regtest Support
- ✅ Full regtest compatibility
- ✅ Block mining utilities
- ✅ Transaction confirmation tracking
- ✅ Watch-only address import

## Files Structure

```
src/
├── wallet.js              # Address derivation, key management
├── utxo-collector.js      # UTXO collection and selection (Steps 1-3)
├── psbt-enhanced.js       # PSBT building and signing (Steps 4-7)
├── transaction-builder.js # Complete flow orchestration (Steps 1-8)
├── coinselect.js          # UTXO selection algorithms
├── rpc.js                 # Bitcoin Core RPC communication
├── config.js              # Configuration management
└── index.js               # Express API server
```

This implementation ensures complete compliance with the specified Bitcoin transaction flow while providing robust error handling, comprehensive logging, and full support for all major Bitcoin address types.
