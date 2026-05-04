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
import AdminAgentCatalog from './pages/admin/AdminAgentCatalog'
import AdminCompanies from './pages/admin/AdminCompanies'
import AdminLLMSettings from './pages/admin/AdminLLMSettings'
import AdminUserPermissions from './pages/admin/AdminUserPermissions'
import AdminTenantSettings from './pages/admin/AdminTenantSettings'
import AdminUsers from './pages/admin/AdminUsers'
import AdminAgentInsights from './pages/admin/AdminAgentInsights'
import AdminWidgetManagement from './pages/admin/AdminWidgetManagement'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import ChangePasswordExpiredPage from './pages/ChangePasswordExpiredPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ProfilePage from './pages/ProfilePage'
import TestLLMChat from './pages/TestLLMChat'
import TestComputeEngine from './pages/TestComputeEngine'
import DevPipelineInspector from './pages/DevPipelineInspector'
import WidgetPage from './pages/WidgetPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            {/* Widget：公開頁面，不需登入，在 Layout 外 */}
            <Route path="/widget/:token" element={<WidgetPage />} />
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
                path="profile"
                element={
                  <ProtectedRoute>
                    <ProfilePage />
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
                <Route index element={<Navigate to="user-permissions" replace />} />
                <Route path="agents" element={<SuperAdminRoute><AdminAgentCatalog /></SuperAdminRoute>} />
                <Route path="user-permissions" element={<AdminUserPermissions />} />
                <Route path="companies" element={<AdminCompanies />} />
                <Route path="tenant-settings" element={<SuperAdminRoute><AdminTenantSettings /></SuperAdminRoute>} />
                <Route path="llm-settings" element={<AdminLLMSettings />} />
                <Route path="agent-insights" element={<AdminAgentInsights />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="widget-management" element={<AdminWidgetManagement />} />
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
