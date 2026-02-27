import { Link } from 'react-router-dom'

export default function AssistantPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/"
          className="mb-4 inline-flex items-center text-sm text-blue-600 hover:text-blue-700"
        >
          ← 返回首頁
        </Link>
        <div className="rounded-2xl border-2 border-gray-200 bg-white p-8 shadow-lg">
          <h1 className="mb-4 text-2xl font-bold text-gray-900">智能助理</h1>
          <p className="text-gray-600">
            歡迎使用智能助理，此頁面為佔位頁面。
          </p>
        </div>
      </div>
    </div>
  )
}
