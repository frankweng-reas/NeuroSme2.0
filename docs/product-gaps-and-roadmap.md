# NeuroSme | Private Hub — 缺口分析與後續強化方向

> 文件建立：2026-05-10
> 搭配閱讀：`product-strategy-kb-mainline.md`

---

## 一、現階段相對較弱的地方

| 項目 | 現況 | 影響 |
|------|------|------|
| 使用紀錄的聚合分析 | 有原始紀錄但無視覺化 Dashboard | 管理者無法快速看到整體使用概況 |
| BI Agent 使用門檻 | 需先上傳 Schema，非技術用戶不熟悉 | 影響此 agent 滲透率 |
| Email / 行事曆整合 | Writing 生成後需手動複製貼上 | 增加操作步驟 |
| KB 資料來源 | 目前僅支援 PDF / TXT | 無法直接從網址或 Google Doc 建庫 |
| KB 版本管理 | 文件更新後無版本記錄 | 難以追蹤知識庫演進 |

---

## 二、後續強化方向（圍繞 KB 主線）

以下依建議優先順序排列：

### 短期（補強現有功能）
- [ ] **Admin 使用量 Dashboard**：各 Agent 使用次數、Token 用量、活躍用戶，視覺化呈現 AI 導入成效
- [ ] **Bot 使用統計**：常見問題、查詢次數、無解率（讓老闆看到 KB Bot 的 ROI）
- [ ] **BI Agent 引導優化**：提供範例 Schema 與範例資料集，降低上手門檻

### 中期（擴大 KB 建庫來源）
- [ ] **URL 抓取建庫**：輸入網址，自動爬取頁面內容加入知識庫
- [ ] **Google Doc / Notion 連接器**：讓企業現有文件直接進入 KB

### 長期（生態系整合）
- [ ] **Email 整合**：Writing 生成後可直接寄出（Gmail / Outlook）
- [ ] **Webhook / Zapier 連接**：Bot 回答後可觸發外部流程（如建立工單）
