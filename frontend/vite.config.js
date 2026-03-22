import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    var apiPort = env.VITE_API_PORT || '8000';
    var localAuthPort = env.VITE_LOCALAUTH_PORT || '4000';
    return {
        plugins: [react()],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: {
            port: 5173,
            headers: {
                "Cache-Control": "no-cache",
            },
            proxy: {
                '/api': {
                    target: "http://localhost:".concat(apiPort),
                    changeOrigin: true,
                },
                '/auth': {
                    target: "http://localhost:".concat(localAuthPort),
                    changeOrigin: true,
                    bypass: function (req) {
                        var _a, _b;
                        // 重設密碼頁面由 NeuroSme SPA 提供，僅對 page load (Accept: text/html) 不 proxy
                        var isPageLoad = (_a = req.headers.accept) === null || _a === void 0 ? void 0 : _a.includes('text/html');
                        if (isPageLoad && ((_b = req.url) === null || _b === void 0 ? void 0 : _b.startsWith('/auth/reset-password'))) {
                            return '/index.html';
                        }
                    },
                },
            },
        },
    };
});
