# Tổng Hợp Lỗi - Bitcoin Wallet Backend Project

## 📋 Mục Lục
1. [Lỗi CORS](#lỗi-cors)
2. [Lỗi Kết Nối Server](#lỗi-kết-nối-server)
3. [Lỗi Bitcoin RPC](#lỗi-bitcoin-rpc)
4. [Lỗi Port Conflicts](#lỗi-port-conflicts)
5. [Lỗi Docker](#lỗi-docker)
6. [Lỗi Wallet & UTXOs](#lỗi-wallet--utxos)
7. [Lỗi Transaction](#lỗi-transaction)
8. [Trạng Thái Hiện Tại](#trạng-thái-hiện-tại)

---

## 🔴 Lỗi CORS

### Mô tả
```
Access to XMLHttpRequest at 'http://localhost:8080/utxos' from origin 'http://localhost:5173' 
has been blocked by CORS policy: Response to preflight request doesn't pass access control check: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

### Nguyên nhân
- Backend chưa cấu hình CORS middleware
- Frontend (localhost:5173) không thể gọi API từ backend (localhost:8080)

### Trạng thái
✅ **ĐÃ SỬA** - Đã thêm CORS middleware vào Express server

### Giải pháp đã áp dụng
```javascript
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

---

## 🔴 Lỗi Kết Nối Server

### Mô tả
```
Failed to load resource: net::ERR_CONNECTION_REFUSED
POST http://localhost:8080/utxos net::ERR_CONNECTION_REFUSED
```

### Nguyên nhân
- Server không chạy trên port 8080
- Process khác đang chiếm port 8080
- Server bị tắt hoặc crash

### Trạng thái
⚠️ **THƯỜNG XUYÊN** - Xuất hiện nhiều lần trong quá trình debug

### Giải pháp đã áp dụng
- Kiểm tra và kill process chiếm port: `taskkill /PID <PID> /F`
- Khởi động lại server: `npm start`
- Thêm port fallback logic trong code

---

## 🔴 Lỗi Bitcoin RPC

### Mô tả
```
AxiosError: Request failed with status code 500
POST http://localhost:18443/ - Internal Server Error
```

### Chi tiết lỗi RPC
```
POST / HTTP/1.1
Host: localhost:18443
Authorization: Basic ZGV2dXNlcjpkZXZwYXNz
```

### Nguyên nhân
1. **Bitcoin node chưa chạy hoặc chưa ready**
2. **Gọi `listunspent` với addresses chưa được import vào wallet**
3. **Không có default wallet trong regtest mode**
4. **Addresses format không đúng cho regtest network**

### Trạng thái
❌ **CHƯA SỬA HOÀN TOÀN** - Vẫn có lỗi 500 khi query UTXOs

### Lỗi cụ thể gặp phải
```javascript
// Lỗi khi gọi
rpc('listunspent', [0, 9999999, addresses])

// Response: {"result": null, "error": {...}, "id": XX}
```

---

## 🔴 Lỗi Port Conflicts

### Mô tả
```
Port 8080 in use, trying 8081...
API listening on :8081
(Original requested port 8080 was busy)
```

### Nguyên nhân
- Process khác (PID 3288, 3360) đang sử dụng port 8080
- Frontend vẫn cố gắng kết nối tới port 8080 thay vì 8081

### Trạng thái
⚠️ **TẠAM THỜI SỬA** - Server chạy port khác, frontend chưa update

### Processes đã kill
```bash
taskkill /PID 3360 /F  # SUCCESS
taskkill /PID 3288 /F  # SUCCESS
```

---

## 🔴 Lỗi Docker

### Mô tả ban đầu
```
unable to get image 'bitcoin/bitcoin:27.0': error during connect: 
Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.51/images/...": 
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

### Nguyên nhân
- Docker Desktop chưa chạy

### Trạng thái
✅ **ĐÃ SỬA** - Docker Desktop đã khởi động, Bitcoin node chạy thành công

### Container hiện tại
```
CONTAINER ID   IMAGE                 STATUS    PORTS
<id>          bitcoin/bitcoin:27.0   Up        0.0.0.0:18443->18443/tcp
```

---

## 🔴 Lỗi Wallet & UTXOs

### Mô tả
```
POST /utxos 400 (Bad Request)
Error: RPC Error from Bitcoin node
```

### Nguyên nhân sâu xa
1. **Addresses được generate nhưng chưa có Bitcoin (UTXOs)**
2. **Regtest network bắt đầu với 0 Bitcoin**
3. **Cần mine blocks để tạo coinbase rewards**
4. **Addresses chưa được import vào Bitcoin wallet**

### Addresses được test
```
- bcrt1qtk8f0drwjlzxmn0u3hqvgfyynmf8yvkh7nz87s
- tb1qdk59tczktj7zadcncemwh43qt8zg8fx5ak9m2j  (testnet format)
- bcrt1pdw9t0hpcn2tp9vnx4dfuv8yx5xxj47yul7dv72hq0ckpshvlf5rqdngtft (taproot)
```

### Trạng thái
❌ **CHƯA SỬA** - Cần implement wallet creation và fund generation

---

## 🔴 Lỗi Transaction

### Mô tả dự kiến
- Không thể build transaction vì không có UTXOs
- Fee estimation fails
- Broadcast transaction fails

### Trạng thái
❌ **CHƯA TEST** - Chưa đến được bước này vì stuck ở UTXOs

---

## 📊 Trạng Thái Hiện Tại

### ✅ Hoạt động tốt
- [x] Docker Bitcoin node running
- [x] CORS configured
- [x] Server code structure
- [x] Basic endpoints defined
- [x] Wallet generation functions

### ❌ Chưa hoạt động
- [ ] UTXOs endpoint returns 200 OK
- [ ] Fee estimation endpoint
- [ ] Transaction building
- [ ] Transaction broadcasting
- [ ] Frontend-Backend integration

### 🔧 Cần sửa ngay

#### 1. Bitcoin RPC Integration
```javascript
// Problem: listunspent fails
const utxos = await getUtxosForAddresses(addresses, minconf);
// Solution: Need proper wallet setup + fund generation
```

#### 2. Wallet Setup Process
```javascript
// Need to implement:
1. Create default wallet in Bitcoin node
2. Generate coinbase transactions (mine blocks)
3. Import/watch addresses properly
4. Fund addresses with regtest Bitcoin
```

#### 3. Frontend URL Update
```javascript
// Frontend still calls:
http://localhost:8080/utxos
// But server runs on:
http://localhost:8081/utxos
```

---

## 🎯 Kế Hoạch Sửa Lỗi

### Phase 1: Core Functionality (Ưu tiên cao)
1. **Fix Bitcoin RPC wallet integration**
   - Create default wallet
   - Implement proper address import
   - Add error handling for empty UTXOs

2. **Fund Generation System**
   - Mine initial blocks to coinbase address
   - Transfer funds to test addresses
   - Implement `/regtest/fund` endpoint

3. **Port Consistency**
   - Ensure server always runs on 8080
   - Update frontend config if needed

### Phase 2: Transaction Flow (Ưu tiên trung)
1. **Complete UTXO workflow**
2. **Fee estimation fixes**
3. **Transaction building & broadcasting**
4. **Frontend integration testing**

### Phase 3: Error Handling (Ưu tiên thấp)
1. **Better error messages**
2. **Logging system**
3. **Health check improvements**

---

## 📝 Ghi Chú Kỹ Thuật

### Lệnh Debug Hữu Ích
```bash
# Check port usage
netstat -ano | findstr :8080

# Check Docker containers
docker ps
docker logs bitcoind-regtest

# Test Bitcoin RPC directly
curl -u devuser:devpass -d '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' http://localhost:18443

# Kill process by PID
taskkill /PID <PID> /F
```

### Config quan trọng
```javascript
// Bitcoin RPC
BTC_RPC_URL=http://localhost:18443
BTC_RPC_USER=devuser  
BTC_RPC_PASS=devpass

// Server
PORT=8080
```

---

## 🏁 Kết Luận

Project hiện tại **KHÔNG HOẠT động end-to-end** do:
1. **Lỗi chính**: Bitcoin RPC trả về 500 khi query UTXOs  
2. **Nguyên nhân gốc**: Chưa có Bitcoin funds trong regtest network
3. **Cần làm**: Implement fund generation workflow

**Estimate thời gian sửa**: 2-4 giờ để có working Bitcoin transfer functionality.
