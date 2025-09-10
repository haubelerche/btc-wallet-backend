import 'dotenv/config';
export const PORT = process.env.PORT || 8080;
export const BTC_RPC_URL = process.env.BTC_RPC_URL || 'http://localhost:18443';
export const BTC_RPC_USER = process.env.BTC_RPC_USER || 'devuser';
export const BTC_RPC_PASS = process.env.BTC_RPC_PASS || 'devpass';
export const FEE_FALLBACK = parseFloat(process.env.FEE_FALLBACK || '2.0');
