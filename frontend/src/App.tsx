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
import AdminAgentCatalog from './pages/admin/AdminAgentCatalog'
import AdminCompanies from './pages/admin/AdminCompanies'
import AdminLLMSettings from './pages/admin/AdminLLMSettings'
import AdminTenantSettings from './pages/admin/AdminTenantSettings'
import AdminUsers from './pages/admin/AdminUsers'
import AdminChatInsights from './pages/admin/AdminChatInsights'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import ChangePasswordExpiredPage from './pages/ChangePasswordExpiredPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import TestLLMChat from './pages/TestLLMChat'
import TestComputeEngine from './pages/TestComputeEngine'
import DevPipelineInspector from './pages/DevPipelineInspector'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/change-password-expired" element={<ChangePasswordExpiredPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
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
                <Route path="agents" element={<SuperAdminRoute><AdminAgentCatalog /></SuperAdminRoute>} />
                <Route path="agent-permissions" element={<AdminAgentPermissions />} />
                <Route path="companies" element={<AdminCompanies />} />
                <Route path="tenant-settings" element={<SuperAdminRoute><AdminTenantSettings /></SuperAdminRoute>} />
                <Route path="llm-settings" element={<AdminLLMSettings />} />
                <Route path="chat-insights" element={<AdminChatInsights />} />
                <Route path="users" element={<AdminUsers />} />
              </Route>
              <Route
                path="change-password"
                element={
                  <ProtectedRoute>
                    <ChangePasswordPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="dev-test-chat"
                element={
                  <ProtectedRoute>
                    <TestLLMChat />
                  </ProtectedRoute>
                }
              />
              <Route
                path="dev-test-compute-engine"
                element={
                  <ProtectedRoute>
                    <TestComputeEngine />
                  </ProtectedRoute>
                }
              />
              <Route
                path="dev-pipeline-inspector"
                element={
                  <ProtectedRoute>
                    <DevPipelineInspector />
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
