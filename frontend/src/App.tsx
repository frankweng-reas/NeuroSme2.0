/** 根元件：定義路由 (/, /agent/:id, /admin) 與 Layout 包裝 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import AdminRoute from './components/AdminRoute'
import SuperAdminRoute from './components/SuperAdminRoute'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import HomePage from './pages/HomePage'
import AgentPage from './pages/AgentPage'
import AdminPage from './pages/AdminPage'
import AdminAgentPermissions from './pages/admin/AdminAgentPermissions'
import AdminTenantSettings from './pages/admin/AdminTenantSettings'
import AdminUsers from './pages/admin/AdminUsers'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import TestLLMChat from './pages/TestLLMChat'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={<Layout />}>
              <Route
                index
                element={
                  <ProtectedRoute>
                    <HomePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="agent/:id"
                element={
                  <ProtectedRoute>
                    <AgentPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin"
              element={
                  <ProtectedRoute>
                    <AdminRoute>
                      <AdminPage />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="agent-permissions" replace />} />
                <Route path="agent-permissions" element={<AdminAgentPermissions />} />
                <Route path="tenant-settings" element={<SuperAdminRoute><AdminTenantSettings /></SuperAdminRoute>} />
                <Route path="users" element={<AdminUsers />} />
              </Route>
              <Route
                path="dev-test-chat"
                element={
                  <ProtectedRoute>
                    <TestLLMChat />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
