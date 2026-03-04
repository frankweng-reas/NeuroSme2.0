# AISettingsPanel 共用元件設計

## 設計原則

1. **完整版元件**：一律渲染 model、role、language、detailLevel、範本區、userPrompt，無選填邏輯
2. **常數集中**：選項常數抽到 `constants/aiOptions.ts`，元件只負責 UI
3. **受控元件**：父層持有 state，元件透過 props 接收並回傳 onChange
4. **範本區內建**：範本管理納入元件內，傳入 `agentId` 即可（API 支援所有 agent）

---

## API 設計

```tsx
interface AISettingsPanelProps {
  agentId: string
  model: string
  onModelChange: (v: string) => void
  role: string
  onRoleChange: (v: string) => void
  language: string
  onLanguageChange: (v: string) => void
  detailLevel: string
  onDetailLevelChange: (v: string) => void
  userPrompt: string
  onUserPromptChange: (v: string) => void
  selectedTemplateId: number | null
  onSelectedTemplateIdChange: (id: number | null) => void
  onToast: (msg: string) => void
  headerActions?: ReactNode
}
```

### 使用範例

**AgentBusinessUI**：

```tsx
<Panel panelRef={aiPanelRef} collapsible ...>
  <AISettingsPanel
    agentId={agent.id}
    model={model}
    onModelChange={setModel}
    role={role}
    onRoleChange={setRole}
    language={language}
    onLanguageChange={setLanguage}
    detailLevel={detailLevel}
    onDetailLevelChange={setDetailLevel}
    userPrompt={userPrompt}
    onUserPromptChange={setUserPrompt}
    selectedTemplateId={selectedTemplateId}
    onSelectedTemplateIdChange={setSelectedTemplateId}
    onToast={setToastMessage}
    headerActions={<CollapseButton />}
  />
</Panel>
```

---

## 檔案結構

```
frontend/src/
├── constants/
│   └── aiOptions.ts       # MODEL_OPTIONS, ROLE_OPTIONS, LANGUAGE_OPTIONS, DETAIL_OPTIONS
└── components/
    └── AISettingsPanel.tsx  # 共用設定區 UI（含範本區與 modal）
```

---

## 選項覆寫（進階，暫不實作）

若未來某 agent 需要不同選項（如自訂角色列表），可加：

```tsx
roleOptions?: Array<{ value: string; label: string }>  // 未傳則用預設 ROLE_OPTIONS
```
