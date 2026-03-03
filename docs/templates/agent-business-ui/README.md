# Agent Business UI Template

三欄可拖曳調整大小的商務型 UI 版面，供其他開發者複製使用。

## 依賴

```bash
npm install react-resizable-panels lucide-react
```

- `react`、`react-router-dom`、`tailwindcss` 為專案既有依賴

## 使用方式

1. 複製 `ThreePanelLayout.tsx` 到專案（例如 `src/pages/` 或 `src/components/`）
2. 依專案路徑調整 import
3. 在路由或父元件中使用：

```tsx
import ThreePanelLayout from './ThreePanelLayout'

// 基本用法
<ThreePanelLayout title="我的 Agent" />

// 自訂返回連結
<ThreePanelLayout title="商務助手" backHref="/home" />

// 自訂 header 圖示
<ThreePanelLayout
  title="商務助手"
  headerIcon={<YourIconComponent className="h-6 w-6 text-white" />}
/>
```

## Props

| Prop | 型別 | 必填 | 說明 |
|------|------|------|------|
| `title` | `string` | ✓ | 標題 |
| `backHref` | `string` | | 返回按鈕連結，預設 `"/"` |
| `headerIcon` | `ReactNode` | | 自訂 header 圖示 |

## 可自訂項目

- **容器最小寬度**：修改各 `Panel` 的 `minSize`（如 `"200px"`、`"300px"`）
- **預設比例**：修改各 `Panel` 的 `defaultSize`（百分比，如 25、50、25）
- **間距**：修改 `Group` 的 `gap-1`（如 `gap-2`、`gap-4`）
- **圓角**：修改 `rounded-2xl`（如 `rounded-xl`、`rounded-3xl`）
