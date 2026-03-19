# 如何 Copy 登入註冊功能

本文件說明如何將 NeuroSme2.0 的登入／註冊與密碼管理功能複製並整合至其他專案。

---

## 一、架構概覽

登入註冊與密碼管理由 **LocalAuth** 外部服務負責，流程如下：

1. **前端** → 呼叫 LocalAuth `/auth/login`、`/auth/register`、`/auth/refresh`、`/auth/password`、`/auth/forgot-password`、`/auth/reset-password`、`/auth/change-password-expired`
2. **LocalAuth** → 回傳 JWT `access_token`、`refresh_token`、`user`
3. **後端** → 以 `JWT_SECRET` 驗證 token，並透過 `get_current_user` 取得使用者

---

## 二、需複製的檔案清單

### 前端（Frontend）

| 檔案路徑 | 說明 |
|---------|------|
| `frontend/src/contexts/AuthContext.tsx` | 認證 Context：登入、註冊、登出、修改密碼、忘記密碼、重設密碼、token 管理 |
| `frontend/src/pages/LoginPage.tsx` | 登入頁 |
| `frontend/src/pages/RegisterPage.tsx` | 註冊頁 |
| `frontend/src/pages/ForgotPasswordPage.tsx` | 忘記密碼頁（輸入 email 寄送重設連結） |
| `frontend/src/pages/ResetPasswordPage.tsx` | 重設密碼頁（從 Email 連結進入，以 token 設定新密碼） |
| `frontend/src/pages/ChangePasswordPage.tsx` | 修改密碼頁（已登入時使用） |
| `frontend/src/pages/ChangePasswordExpiredPage.tsx` | 密碼過期更換頁（未登入時更換密碼） |
| `frontend/src/components/ProtectedRoute.tsx` | 需登入才能存取的路由守衛 |
| `frontend/src/api/client.ts` | API 客戶端：Bearer token、401 處理、refresh token |
| `frontend/src/api/users.ts` | 取得當前使用者（`getMe`）等 API |
| `frontend/vite.config.ts` 或 `frontend/vite.config.js` | Vite proxy：`/auth` → LocalAuth（含 reset-password 頁面 bypass） |
| `frontend/.env.example` | 環境變數範例 |

**依賴檔案（若專案無對應功能需一併複製或改寫）：**

- `frontend/src/components/Layout.tsx`：使用 `useAuth`、`getMe`、登出按鈕
- `frontend/src/App.tsx`：`AuthProvider`、`/login`、`/register`、密碼相關路由
- `frontend/src/contexts/ToastContext.tsx`：`ChangePasswordPage` 成功訊息需 `useToast`
- `frontend/src/types/index.ts`：`User` 型別

### 後端（Backend）

| 檔案路徑 | 說明 |
|---------|------|
| `backend/app/core/security.py` | JWT 驗證、`get_current_user` |
| `backend/app/core/config.py` | 設定 `JWT_SECRET` |
| `backend/app/api/endpoints/users.py` | `/users/me` 等 API |
| `backend/app/models/user.py` | User ORM |
| `backend/app/models/tenant.py` | Tenant ORM（`get_current_user` 會用到） |
| `backend/app/schemas/user.py` | User Pydantic schemas |
| `backend/.env.example` | 環境變數範例 |

**依賴檔案：**

- `backend/app/core/database.py`：`get_db`
- `backend/app/api/__init__.py`：掛載 users router
- `backend/app/models/user_agent.py`：若使用 agent 權限功能

---

## 三、快速複製指令

```bash
# 假設目標專案結構與 NeuroSme2.0 類似

# 前端
cp frontend/src/contexts/AuthContext.tsx <目標>/frontend/src/contexts/
cp frontend/src/pages/LoginPage.tsx <目標>/frontend/src/pages/
cp frontend/src/pages/RegisterPage.tsx <目標>/frontend/src/pages/
cp frontend/src/pages/ForgotPasswordPage.tsx <目標>/frontend/src/pages/
cp frontend/src/pages/ResetPasswordPage.tsx <目標>/frontend/src/pages/
cp frontend/src/pages/ChangePasswordPage.tsx <目標>/frontend/src/pages/
cp frontend/src/pages/ChangePasswordExpiredPage.tsx <目標>/frontend/src/pages/
cp frontend/src/components/ProtectedRoute.tsx <目標>/frontend/src/components/
cp frontend/src/api/client.ts <目標>/frontend/src/api/
cp frontend/src/api/users.ts <目標>/frontend/src/api/
cp frontend/.env.example <目標>/frontend/

# 後端
cp backend/app/core/security.py <目標>/backend/app/core/
cp backend/app/core/config.py <目標>/backend/app/core/
cp backend/app/api/endpoints/users.py <目標>/backend/app/api/endpoints/
cp backend/app/models/user.py <目標>/backend/app/models/
cp backend/app/models/tenant.py <目標>/backend/app/models/
cp backend/app/schemas/user.py <目標>/backend/app/schemas/
cp backend/.env.example <目標>/backend/
```

---

## 四、整合步驟

### 4.1 部署 LocalAuth

登入／註冊由 [LocalAuth](https://github.com/REAS-ai-dev/localauth) 負責，需先部署：

```bash
cd localauth
docker compose up -d
# 或
npm run start:dev
```

預設 port：**4000**

### 4.2 後端設定

1. 複製 `.env.example` 為 `.env`
2. 設定 `JWT_SECRET`，**必須與 LocalAuth 一致**

```env
JWT_SECRET=your-secret-key-here
```

3. 確保資料庫有 `users`、`tenants` 表（執行 Alembic 遷移）
4. 在 API router 中掛載 users：

```python
router.include_router(users.router, prefix="/users", tags=["users"])
```

### 4.3 前端設定

1. 複製 `.env.example` 為 `.env`
2. 環境變數（可選）：
   - `VITE_AUTH_API_URL`：若 LocalAuth 在 Docker 或不同網域，設定完整 URL（如 `http://localhost:4000`）
   - `VITE_LOCALAUTH_PORT`：Vite proxy 用，預設 4000
   - `VITE_API_PORT`：後端 API port，預設 8000

3. 在 `vite.config.ts` 加入 `/auth` proxy（開發環境）。重設密碼頁面由 SPA 提供，需對 page load 做 bypass：

```ts
proxy: {
  '/api': { target: 'http://localhost:8000', changeOrigin: true },
  '/auth': {
    target: 'http://localhost:4000',
    changeOrigin: true,
    bypass(req) {
      // 重設密碼頁面由 SPA 提供，僅對 page load (Accept: text/html) 不 proxy
      const isPageLoad = req.headers.accept?.includes('text/html')
      if (isPageLoad && req.url?.startsWith('/auth/reset-password')) {
        return '/index.html'
      }
    },
  },
}
```

4. 在 App 中包一層 `AuthProvider`，並設定路由：

```tsx
<AuthProvider>
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/change-password-expired" element={<ChangePasswordExpiredPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
    <Route path="/" element={<Layout />}>
      <Route index element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="change-password" element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>} />
      {/* 其他需登入的路由用 ProtectedRoute 包起來 */}
    </Route>
  </Routes>
</AuthProvider>
```

### 4.4 依賴套件

**後端：**

- `PyJWT`：JWT 驗證

**前端：**

- `react-router-dom`：路由
- 若使用 `@/` 路徑別名，需在 `vite.config` 設定 `resolve.alias`

---

## 五、LocalAuth API 規格

若同事需自行實作認證服務，需符合以下規格：

### POST /auth/login

**Request：**
```json
{ "email": "user@example.com", "password": "123456" }
```

**Response：**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": { "id": "xxx", "email": "user@example.com", "name": "User" }
}
```

### POST /auth/register

**Request：**
```json
{ "email": "user@example.com", "password": "123456", "name": "User" }
```

**Response：** 同 login

### POST /auth/refresh

**Request：**
```json
{ "refresh_token": "eyJ..." }
```

**Response：**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

### PATCH /auth/password（已登入修改密碼）

**Request：** 需 `Authorization: Bearer <access_token>`
```json
{ "old_password": "舊密碼", "new_password": "新密碼" }
```

**Response：** 204 No Content 或成功訊息

### POST /auth/change-password-expired（密碼過期更換，未登入）

**Request：**
```json
{ "email": "user@example.com", "old_password": "舊密碼", "new_password": "新密碼" }
```

**Response：** 204 No Content 或成功訊息

### POST /auth/forgot-password（忘記密碼，寄送重設連結）

**Request：**
```json
{ "email": "user@example.com" }
```

**Response：** 204 No Content 或成功訊息。LocalAuth 會寄送含 `?token=xxx` 的連結，導向 `/auth/reset-password?token=xxx`。

### POST /auth/reset-password（以 token 重設密碼）

**Request：**
```json
{ "token": "重設連結中的 token", "new_password": "新密碼" }
```

**Response：** 204 No Content 或成功訊息

---

JWT payload 需包含 `email` 欄位，後端以此驗證並建立/查詢使用者。

---

## 六、注意事項

1. **JWT_SECRET**：後端與 LocalAuth 必須使用相同 secret
2. **CORS**：若前後端不同網域，後端需允許前端 origin
3. **Token 儲存**：前端使用 `localStorage`（`neurosme_access_token`、`neurosme_refresh_token`、`neurosme_user`）
4. **首次登入同步**：`get_current_user` 會依 JWT 的 email 在 NeuroSme2.0 建立 User（若尚不存在），並歸入第一個 tenant
5. **重設密碼流程**：忘記密碼 → LocalAuth 寄送 Email 連結（`/auth/reset-password?token=xxx`）→ 使用者點擊進入 SPA 重設密碼頁。Vite proxy 需對 `/auth/reset-password` 的 page load 做 bypass，讓 SPA 提供頁面
6. **密碼過期**：登入時若 LocalAuth 回傳密碼過期，前端可導向 `/change-password-expired`，並以 `location.state` 傳遞 `email`、`password` 供使用者更換密碼
