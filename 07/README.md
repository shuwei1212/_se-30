# TaskLane · 07 網站測試

TaskLane 是一個小型任務看板，用來示範同一個網站應用如何被三層測試守住：

1. **單元測試（Unit）**：直接測 server 的輸入驗證與 JSON store。
2. **系統測試（System）**：啟動真正的 HTTP server，用 `fetch` 測 web API。
3. **E2E 測試（End-to-End）**：用 Playwright 操作無頭 Chrome，從使用者角度測完整流程。

專案刻意保持小而完整：沒有前端框架、沒有資料庫伺服器、沒有外部 runtime 套件。伺服器使用 Node.js 內建模組，資料寫入本機 JSON 檔，讓測試能聚焦在行為，而不是環境安裝。

---

## 功能

- 新增任務：標題（1–80 字）與優先順序（低／中／高）。
- 任務列表：顯示標題、優先順序與建立時間。
- 完成切換：勾選後標記完成，再勾一次可改回進行中。
- 篩選：全部、進行中、已完成。
- 統計：全部、進行中、已完成數量即時更新。
- 刪除任務。
- 重新整理後資料仍存在，因為每次異動都會寫入 JSON 檔。
- API 錯誤與表單驗證錯誤會顯示在畫面上。
- 基本安全標頭：CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 等。
- 請求 body 上限 64 KiB，JSON 寫入以 promise chain 串行化，避免同時寫檔互相覆蓋。

---

## 技術棧

| 層級 | 技術 |
| --- | --- |
| Server | Node.js ESM、`node:http`、`node:fs/promises`、`node:crypto` |
| Client | 原生 HTML、CSS、JavaScript（ES modules） |
| 單元／系統測試 | Node.js 內建 `node:test`、`node:assert/strict` |
| E2E | `@playwright/test` + 本機 Google Chrome（`channel: 'chrome'`） |
| 資料 | 本機 JSON 檔（預設 `data/tasks.json`） |

需求版本：

- Node.js `>= 20`（本專案以 Node.js 24 驗證）
- npm
- 執行 E2E 需要 Google Chrome；Playwright 設定使用已安裝的 Chrome，不額外下載 Chromium。

---

## 專案結構

```text
07/
├─ package.json
├─ package-lock.json
├─ playwright.config.js
├─ README.md
├─ .gitignore
├─ public/
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  └─ favicon.svg
├─ src/
│  ├─ server.js
│  ├─ store.js
│  └─ validation.js
├─ tests/
│  ├─ unit/
│  │  ├─ validation.test.js
│  │  └─ store.test.js
│  ├─ system/
│  │  └─ api.test.js
│  └─ e2e/
│     └─ tasklane.spec.js
└─ data/                 # 執行時自動建立，已加入 .gitignore
   ├─ tasks.json         # 一般啟動使用
   └─ e2e-tasks.json     # Playwright 測試使用
```

---

## 快速開始

```powershell
cd 07
npm install
npm start
```

開啟 <http://127.0.0.1:3000>。

開發時可使用 watch mode：

```powershell
npm run dev
```

停止伺服器：在終端機按 `Ctrl+C`。伺服器會處理 `SIGINT`／`SIGTERM` 並關閉 HTTP server。

### 環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 連接埠 |
| `HOST` | `127.0.0.1` | 綁定位址 |
| `DATA_FILE` | `data/tasks.json` | JSON 資料檔路徑 |

PowerShell 範例：

```powershell
$env:PORT = "8080"
$env:DATA_FILE = "data/demo.json"
npm start
```

---

## 指令

| 指令 | 內容 |
| --- | --- |
| `npm start` | 啟動正式 server（`src/server.js`） |
| `npm run dev` | 啟動 server 並監看檔案變更 |
| `npm test` | 跑單元測試 + 系統測試（Node.js test runner） |
| `npm run test:unit` | 只跑單元測試 |
| `npm run test:system` | 只跑系統測試 |
| `npm run test:e2e` | 只跑 Playwright E2E |
| `npm run test:all` | 依序跑 `npm test` 與 `npm run test:e2e` |

目前驗證結果：

```text
單元測試        18 passed
系統測試         4 passed
E2E 測試         6 passed
合計            28 passed
```

`npm test` 不包含 E2E，讓日常回饋保持快速；需要完整驗證時使用 `npm run test:all`。

---

## 三層測試

### 1. 單元測試 · Unit

指令：

```powershell
npm run test:unit
```

檔案：

- `tests/unit/validation.test.js`
- `tests/unit/store.test.js`

`validation.test.js` 直接測 server 的驗證邏輯：

- 標題 trim、空白壓縮。
- priority 大小寫正規化與預設值。
- Unicode code point 長度計算，避免把 emoji 算成多個字。
- 空標題、超過 80 字、非法 priority。
- 非物件 payload。
- `done` 必須是 boolean。
- 篩選條件 `all`／`active`／`done` 的正規化與拒絕未知值。

`store.test.js` 測 JSON store：

- `create()` 正規化輸入、寫入資料、回傳任務。
- 驗證錯誤會帶有 `VALIDATION_ERROR` 與欄位細節。
- 任務依建立時間／id 由新到舊排序。
- `active`／`done` 篩選與統計。
- `setDone()`、`remove()`、未知 id 的回傳值。
- 回傳的是 clone，外部改動不會污染 store 內部狀態。
- 新 store 實例能從磁碟重新載入資料。
- 損壞的 JSON 檔會被拒絕。

單元測試不啟動 HTTP server，速度最快，失敗時也最容易定位。

### 2. 系統測試 · System

指令：

```powershell
npm run test:system
```

檔案：`tests/system/api.test.js`

每個測試都會：

1. 建立暫存目錄。
2. 用 `startServer({ port: 0 })` 啟動真正的 HTTP server。
3. 用 `fetch` 發送 request。
4. 測試結束後關閉 server 並刪除暫存資料。

涵蓋範圍：

- `GET /api/health` 回傳 `ok`、service、version、task 統計。
- `/`、`/app.js`、`/styles.css` 靜態檔與 Content-Type。
- CSP 等安全標頭。
- `POST /api/tasks` 建立任務。
- `GET /api/tasks?status=active|done` 篩選。
- `PATCH /api/tasks/:id` 切換完成狀態。
- `GET /api/stats` 統計。
- `DELETE /api/tasks/:id` 刪除，成功時回傳 `204`。
- 空標題、非法 priority、缺少 `done`、非法 JSON、錯誤 Content-Type。
- 不存在的任務與 API 的 `404`。
- 非法 `status` 的 `400`。
- 重新啟動 server 後仍能讀到先前寫入的資料。

這一層測的是「HTTP 契約」：status code、JSON 結構、錯誤碼、headers 與持久化，而不是瀏覽器畫面。

### 3. E2E 測試 · Playwright

指令：

```powershell
npm run test:e2e
```

檔案：

- `tests/e2e/tasklane.spec.js`
- `playwright.config.js`

Playwright 設定：

- 測試目錄：`tests/e2e`
- 使用 `channel: 'chrome'`，直接啟動本機 Google Chrome。
- 預設 headless。
- 固定單一 worker，避免多個測試同時改同一份 JSON。
- 測試 server 使用 `data/e2e-tasks.json`，與一般開發資料分開。
- 失敗才保留 trace 與 screenshot。

E2E 涵蓋：

1. 新增任務後三個統計數字更新，表單清空並重新聚焦。
2. 勾選完成後統計更新，切到「已完成」看得到、切到「進行中」看不到，重新整理後狀態仍存在。
3. 同時有進行中與已完成任務時，兩種篩選各自只顯示正確的任務，「全部」能看到兩筆。
4. 刪除任務後列表清空、空狀態出現，重新整理後仍為空。
5. 空標題在前端被攔下，顯示表單錯誤且不送出 request。
6. 模擬 server 500 錯誤時，畫面顯示錯誤訊息，表單仍可繼續使用。

測試隔離方式：每個 E2E 測試開始與結束都會透過 API 清空 `e2e-tasks.json` 中的任務，讓測試不受上一次執行或失敗殘留影響。E2E 的商業流程仍然全部透過瀏覽器 UI 操作。

---

## API

| Method | Path | 說明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康檢查、版本、uptime、任務統計 |
| `GET` | `/api/tasks?status=all\|active\|done` | 取得任務列表 |
| `POST` | `/api/tasks` | 新增任務 |
| `PATCH` | `/api/tasks/:id` | 更新完成狀態 |
| `DELETE` | `/api/tasks/:id` | 刪除任務 |
| `GET` | `/api/stats` | 取得任務統計 |
| `GET` | `/` | TaskLane 頁面 |
| `GET` | `/app.js` | 前端程式 |
| `GET` | `/styles.css` | 樣式 |
| `GET` | `/favicon.svg` | 圖示 |

### 建立任務

```http
POST /api/tasks
Content-Type: application/json

{
  "title": "跑三層測試",
  "priority": "high"
}
```

成功：`201 Created`

```json
{
  "ok": true,
  "task": {
    "id": "c0a8012e-...",
    "title": "跑三層測試",
    "priority": "high",
    "done": false,
    "createdAt": "2026-11-11T00:00:00.000Z",
    "updatedAt": "2026-11-11T00:00:00.000Z"
  }
}
```

### 切換完成狀態

```http
PATCH /api/tasks/:id
Content-Type: application/json

{
  "done": true
}
```

### 錯誤格式

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "輸入資料不正確。",
    "fields": {
      "title": "請輸入任務標題。"
    }
  }
}
```

常見錯誤碼：

| Status | Code | 情境 |
| --- | --- | --- |
| `400` | `VALIDATION_ERROR` | 欄位驗證失敗 |
| `400` | `INVALID_JSON` | body 不是有效 JSON |
| `400` | `INVALID_FILTER` | status 不是 all／active／done |
| `404` | `TASK_NOT_FOUND` | 任務不存在 |
| `404` | `NOT_FOUND` | API 不存在 |
| `413` | `PAYLOAD_TOO_LARGE` | body 超過 64 KiB |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | 不是 `application/json` |
| `500` | `INTERNAL_ERROR` | 未預期錯誤 |

### PowerShell 範例

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health

$body = @{
  title = "用 PowerShell 新增任務"
  priority = "medium"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/tasks `
  -ContentType "application/json" `
  -Body $body
```

---

## 資料格式

預設檔案：`data/tasks.json`。第一次啟動時會自動建立；`data/` 已加入 `.gitignore`。

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "c0a8012e-...",
      "title": "跑三層測試",
      "priority": "high",
      "done": false,
      "createdAt": "2026-11-11T00:00:00.000Z",
      "updatedAt": "2026-11-11T00:00:00.000Z"
    }
  ]
}
```

設計重點：

- 寫入前先排序，讓檔案內容穩定、容易比對。
- `TaskStore` 用 `Map` 保存任務，回傳 clone，避免呼叫端直接改到內部物件。
- 寫檔透過 promise chain 串行化；同一時間只有一個寫入排隊執行。
- 讀檔時會檢查 id、title、priority、done 與 createdAt，拒絕格式錯誤的資料。
- 檔案不存在時建立空資料檔；JSON 損壞時拒絕啟動，避免默默覆蓋。

若要重置本機資料，停止 server 後刪除 `data/tasks.json`，再重新啟動即可。

---

## 設計取捨

### 為什麼 server 用 Node.js，而不是 Rust？

需求允許 server 使用 Rust 或 Node.js，且本機目前沒有 Rust toolchain。這個題目重點是三層測試，因此選擇 Node.js，讓單元測試、系統測試與 server 共用同一套執行環境，減少安裝成本。

### 為什麼資料用 JSON 檔？

這是單機示範專案，JSON 檔足以展示持久化與系統測試的重啟情境，也不需要資料庫服務。若要多實例部署，應改用資料庫與交易機制。

### 為什麼 client 不另外做單元測試？

需求明確表示 client 可以不測，且 client 邏輯已由 E2E 從使用者角度覆蓋。server 的 validation 與 store 則有完整單元測試。

### 為什麼 E2E 使用本機 Chrome？

`@playwright/test` 已安裝，但沒有另外下載 Chromium。`playwright.config.js` 使用 `channel: 'chrome'`，直接使用機器上已安裝的 Google Chrome，減少下載時間與磁碟占用。

若要在沒有 Chrome 的環境執行，可改裝 Playwright 瀏覽器：

```powershell
npx playwright install chromium
```

並把 `playwright.config.js` 的 `channel: 'chrome'` 移除，讓 Playwright 使用自己的 Chromium。

---

## 安全性與限制

已實作：

- 所有回應加上 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、CSP、`Referrer-Policy` 等標頭。
- API 只接受 `application/json`，並限制 body 大小。
- 任務 id 經 `encodeURIComponent` 處理；server 解碼失敗會回 `400`。
- 前端以 `textContent` 建立任務標題節點，不把使用者輸入當 HTML 插入。
- 靜態檔路徑使用固定白名單，不接受任意檔案路徑。

目前限制：

- 沒有帳號、登入與權限管理。
- 沒有多使用者即時同步；多人同時寫入同一個 JSON 檔仍可能互相覆蓋。
- 沒有 CSRF token；目前沒有 cookie-based session，僅適合作為本機示範。
- 沒有 rate limiting。
- JSON 檔方案不適合多實例或高併發正式環境。
- E2E 依賴本機 Chrome，CI 環境需另外安裝瀏覽器或調整 Playwright 設定。
- `npm audit` 顯示目前依賴無已知漏洞，但仍應在實際部署前重新檢查。

---

## 驗收清單

- [x] Node.js server 與靜態前端可啟動。
- [x] 任務可新增、完成、取消完成、篩選、刪除。
- [x] 任務資料會寫入 JSON 檔，重新啟動後仍存在。
- [x] server 單元測試涵蓋 validation 與 store。
- [x] 系統測試啟動真實 HTTP server 並測 web API。
- [x] Playwright E2E 使用無頭 Chrome 測使用者流程。
- [x] 測試使用暫存資料，不污染一般開發資料。
- [x] 錯誤輸入、404、415、非法 JSON 有明確錯誤回應。
- [x] README 記錄啟動方式、API、測試策略與限制。

完整驗證指令：

```powershell
npm run test:all
```
