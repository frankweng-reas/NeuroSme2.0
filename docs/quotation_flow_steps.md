# 報價流程 Step 1–4 資料流整理

## 狀態對應

| status | currentStep | 說明                         |
|--------|-------------|------------------------------|
| STEP1  | 1           | 需求解析中                   |
| STEP2  | 2           | 品項精修中                   |
| STEP3  | 3           | 格式封裝中                   |
| STEP4  | 4           | 發送跟進（已完成）           |

---

## 各步驟資料來源

| Step | 預覽資料來源 (getPreviewData) | 其他資料 |
|------|-------------------------------|----------|
| 1    | chatPreviewData（AI 解析結果） | parseResult、rawContent → localStorage |
| 2    | qtn_draft ?? chatPreviewData  | — |
| 3    | qtn_final ?? qtn_draft ?? chatPreviewData | — |
| 4    | 同上                          | shareSuggestions → localStorage |

---

## 各步驟「完成」按鈕行為

### Step 1 完成
- **觸發**：點擊右側預覽區的「完成」
- **動作**：
  - `updateQtnDraft(chatPreviewData)` → 寫入 **qtn_draft**
  - Backend：若 qtn_draft 有值，自動設 `status = "STEP2"`
  - `setCurrentStep(2)`
- **注意**：會覆蓋既有 qtn_draft。若 status 已是 STEP2 或之後，再點會覆蓋 step 2 的編輯。

### Step 2 完成
- **觸發**：點擊「完成」
- **動作**：
  - `updateQtnStatus('STEP3')` → 更新 **status**
  - 若尚無 qtn_final：`updateQtnFinal(draft)` → 初始化 **qtn_final**（複製 draft）
  - `setCurrentStep(3)`
- **注意**：qtn_draft 在 step 2 編輯時已透過 updatePreviewItems / updateDraftHeader 即時更新。

### Step 3 完成
- **觸發**：點擊「完成」
- **動作**：
  - `updateQtnStatus('STEP4')` → 更新 **status**
  - `setCurrentStep(4)`
- **注意**：qtn_final 在 step 3 編輯時已透過 updateDraftHeader / updatePreviewItems 即時更新。

### Step 4
- **無「完成」按鈕**，僅有「生成」發送建議（存 localStorage）

---

## 各步驟編輯時的即時更新

| Step | 編輯內容         | 更新 API              | 更新欄位    |
|------|------------------|------------------------|-------------|
| 2    | 品項（新增/刪除/編輯） | updateQtnDraft         | qtn_draft   |
| 2    | header（若可編輯）   | updateQtnDraft         | qtn_draft   |
| 3    | 品項             | updateQtnFinal         | qtn_final   |
| 3    | header（賣方/買方/條款） | updateQtnFinal     | qtn_final   |

---

## Backend API 行為

| API              | 更新欄位   | 對 status 的影響                    |
|------------------|------------|-------------------------------------|
| updateQtnDraft   | qtn_draft  | 若 body 有值 → status = "STEP2"    |
| updateQtnFinal   | qtn_final  | 無（不改變 status）                 |
| updateQtnStatus | —          | 直接設為 body.status                |

---

## 清空專案

- `updateQtnDraft(null)` → qtn_draft = null
- `updateQtnFinal(null)` → qtn_final = null
- `updateQtnStatus('STEP1')` → status = STEP1
- localStorage：移除 share 建議

---

## 完成按鈕 disable 建議

| Step | 建議 disable 條件 | 理由 |
|------|-------------------|------|
| 1    | status ≥ STEP2    | 會覆蓋 qtn_draft，影響 step 2 產出；重來請先「清空專案」 |
| 2    | 不 disable        | 回到 step 2 修改品項後再完成，為正常流程 |
| 3    | 不 disable        | 回到 step 3 修改 header 後再完成，為正常流程 |
