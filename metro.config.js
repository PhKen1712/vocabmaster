// Cấu hình Metro — chỉ để bản WEB chạy được (theo docs của expo-sqlite).
// - assetExts += 'wasm' → expo-sqlite web tải được file WebAssembly.
// - COOP/COEP           → bật crossOriginIsolated, điều kiện của SharedArrayBuffer.
// Không ảnh hưởng bản iOS: thêm đuôi file vào assetExts chỉ là nhận diện thêm,
// còn header chỉ được set khi Metro chạy dev server trên máy.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, metroServer) => {
  const enhanced = enhanceMiddleware ? enhanceMiddleware(middleware, metroServer) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return enhanced(req, res, next);
  };
};

module.exports = config;
