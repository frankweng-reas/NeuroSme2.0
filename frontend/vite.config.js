import fs from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';
function readRepoRootVersion() {
    try {
        return fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf-8').trim();
    }
    catch (_a) {
        return 'dev';
    }
}
export default defineConfig(function (_a) {
    var _b, _c;
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    var apiPort = env.VITE_API_PORT || '8000';
    var localAuthPort = env.VITE_LOCALAUTH_PORT || '4000';
    // Docker Dockerfile 會以 ARG/ENV 注入；本地開發無則自 ../../VERSION 讀（build context 僅 frontend 時此檔不存在，依賴 Dockerfile）
    var viteAppVersion = (_c = (_b = process.env.VITE_APP_VERSION) !== null && _b !== void 0 ? _b : env.VITE_APP_VERSION) !== null && _c !== void 0 ? _c : readRepoRootVersion();
    return {
        define: {
            'import.meta.env.VITE_APP_VERSION': JSON.stringify(viteAppVersion),
        },
        plugins: [
            react(),
            /** 建置輸出的 index.html 會帶 script/link crossorigin；
             * 在 Chrome 無痕 + 同源 iframe 內偶發 ES module 不執行（#root 永遠無子節點）。
             * 同源腳本不需要 crossorigin（非 credentials CORS）。
             */
            {
                name: 'strip-crossorigin-html-embed-compat',
                apply: 'build',
                enforce: 'post',
                transformIndexHtml: function (html) {
                    return html.replace(/\s+crossorigin(?:="anonymous"|="")?/gi, '');
                },
            },
            VitePWA({
                registerType: 'autoUpdate',
                // 不自動注入 registerSW.js：無痕視窗若在 iframe 內載入會觸發 SW register，
                // 易造成僅嵌入式失敗（頂層分頁仍可由 index.html 手動註冊）。
                injectRegister: null,
                // 只對 /widget/* 啟用 Service Worker
                scope: '/widget/',
                includeAssets: ['favicon.ico', 'icons/*.png'],
                manifest: {
                    name: 'NeuroSme Widget',
                    short_name: 'Widget',
                    description: 'NeuroSme 客服 Chatbot Widget',
                    theme_color: '#1A3A52',
                    background_color: '#ffffff',
                    display: 'standalone',
                    orientation: 'portrait',
                    start_url: '/widget/',
                    scope: '/widget/',
                    icons: [
                        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                    ],
                },
                workbox: {
                    // 預快取 widget 相關資源
                    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                    navigateFallback: '/index.html',
                    navigateFallbackDenylist: [/^\/api/, /^\/auth/],
                    runtimeCaching: [
                        {
                            // Widget API 不快取，每次即時請求
                            urlPattern: /^\/api\/v1\/widget\//,
                            handler: 'NetworkOnly',
                        },
                    ],
                },
            }),
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: {
            port: 5173,
            allowedHosts: ['ee.neurosme.ai'],
            headers: {
                "Cache-Control": "no-cache",
            },
            fs: {
                allow: ['..'], // 允許存取上層目錄（VERSION 檔位於此）
            },
            proxy: {
                '/api': {
                    target: "http://localhost:".concat(apiPort),
                    changeOrigin: true,
                    timeout: 300000, // 等待連線建立（ms）
                    proxyTimeout: 300000, // 等待 backend 回應（ms）
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
