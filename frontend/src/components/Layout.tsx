import { Link, Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header - ReadyQA 風格 */}
      <header
        className="flex-shrink-0 border-b border-gray-200 shadow-sm"
        style={{ backgroundColor: '#4b5563' }}
      >
        <div className="container mx-auto px-4">
          <div className="flex h-32 items-center justify-between">
            {/* 應用名稱 - 點擊回到首頁 */}
            <Link to="/" className="flex flex-col items-center hover:opacity-90">
              <h1
                className="text-4xl font-bold text-white"
                style={{
                  letterSpacing: '-1px',
                  fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
                  fontStyle: 'italic',
                }}
              >
                <span style={{ fontWeight: 700 }}>Neuro</span>
                <span style={{ fontWeight: 700 }}>Sme</span>
              </h1>
              <p
                className="mt-0.5 text-center text-sm text-white"
                style={{
                  fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
                  fontStyle: 'italic',
                }}
              >
                Just ready. GO.
              </p>
            </Link>

            {/* 右側：用戶資訊佔位 */}
            <div className="flex items-center gap-3 rounded-3xl border border-white/30 bg-white/10 px-6 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                <span className="text-sm font-semibold text-white">U</span>
              </div>
              <span className="text-sm font-medium text-white">user@example.com</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
