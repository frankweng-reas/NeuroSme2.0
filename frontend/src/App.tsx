/** 根元件：定義路由 (/, /agent/:id, /admin) 與 Layout 包裝 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import AgentPage from './pages/AgentPage'
import AdminPage from './pages/AdminPage'
import AdminAgentPermissions from './pages/admin/AdminAgentPermissions'
import AdminUsers from './pages/admin/AdminUsers'
import TestLLMChat from './pages/TestLLMChat'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="agent/:id" element={<AgentPage />} />
          <Route path="admin" element={<AdminPage />}>
            <Route index element={<Navigate to="agent-permissions" replace />} />
            <Route path="agent-permissions" element={<AdminAgentPermissions />} />
            <Route path="users" element={<AdminUsers />} />
          </Route>
          <Route path="dev-test-chat" element={<TestLLMChat />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
