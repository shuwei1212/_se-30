# DockerBoard：多容器服務觀測站

第 6 週 Docker 作業。這個專案用一個可以實際操作的小型系統，示範如何把網站拆成多個容器，並用 Docker Compose 串起建置、網路、資料持久化、健康檢查與反向代理。

DockerBoard 不是單純的靜態首頁，而是一個會即時讀取容器狀態的 SSR 儀表板：

- nginx 是唯一對外入口，負責反向代理。
- Node.js web 產生 HTML、處理表單，並查詢 PostgreSQL。
- Python stats 提供另一個獨立服務，回報 Python 版本、hostname、uptime 與請求次數。
- PostgreSQL 保存部署筆記與瀏覽次數，資料放在 named volume，重啟容器後仍會保留。

## 作業需求對照

| 作業需求 | 本專案實作 |
| --- | --- |
| 使用 nginx 作為 web server 或反向代理 | `nginx` 服務監聽容器內 `80`，對外只開放 `${APP_PORT:-8080}`，將 `/` 轉給 web、`/api/stats` 轉給 stats |
| 使用 PostgreSQL | `postgres:16-alpine`，搭配 `pgdata` volume 與 `db/init.sql` 初始化 |
| 提供 Node.js／Rust／Python 執行環境（可選） | 同時使用 Node.js 22（web）與 Python 3.12（stats） |
| 設計簡易 web 介面展示 Docker 系統 | DockerBoard 儀表板：服務狀態、架構圖、資料庫指標、筆記 CRUD、API 與指令速查 |

## 系統架構

```text
                         Windows / macOS / Linux
                         http://localhost:8080
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │  nginx:1.27-alpine      │
                    │  reverse proxy :80      │
                    │  X-Gateway: nginx       │
                    └───────────┬─────────────┘
                                │ frontend network
                 ┌──────────────┴───────────────┐
                 │                              │
                 ▼                              ▼
      ┌─────────────────────┐        ┌─────────────────────┐
      │ web (Node.js 22)    │        │ stats (Python 3.12) │
      │ :3000               │───────▶│ :8000               │
      │ SSR + API + 表單     │ stats  │ /health /stats      │
      └──────────┬──────────┘        └─────────────────────┘
                 │ backend network
                 ▼
      ┌─────────────────────┐
      │ db (PostgreSQL 16)  │
      │ :5432               │
      │ volume: pgdata      │
      └─────────────────────┘
```

### 服務清單

| 服務 | 映像／建置 | 容器連接埠 | 對外連接埠 | 網路 | 責任 |
| --- | --- | --- | --- | --- | --- |
| `nginx` | `nginx:1.27-alpine` + 自訂設定 | `80` | `${APP_PORT:-8080}` | `frontend` | 反向代理、gzip、`X-Gateway`、健康檢查 |
| `web` | `node:22-alpine` 多階段建置 | `3000` | 無 | `frontend`、`backend` | SSR 儀表板、表單、JSON API、查詢 DB |
| `stats` | `python:3.12-alpine` | `8000` | 無 | `frontend` | 系統資訊微服務，無第三方套件 |
| `db` | `postgres:16-alpine` | `5432` | 無 | `backend` | 保存筆記與瀏覽次數 |

只有 nginx 會發布到主機。web、stats、db 都沒有 `ports:`，必須透過 Compose 網路或 `docker compose exec` 存取。這是刻意的設計：資料庫不需要暴露到主機，降低攻擊面。

### 請求流程

1. 瀏覽器連到 `http://localhost:8080/`。
2. nginx 加上 `X-Gateway: nginx` 與 `X-Forwarded-For`，轉給 `web:3000`。
3. web 同時查詢 PostgreSQL 與 `http://stats:8000/stats`。
4. web 產生 HTML，回傳給 nginx，再回傳給瀏覽器。
5. 首頁每次載入會把 `counters.dashboard_views` 加 1。
6. 新增或刪除筆記時，瀏覽器以 POST 表單送到 web，寫入 PostgreSQL 後以 `303` 重新導向首頁。

`/api/stats` 則由 nginx 直接代理到 Python stats，不經過 web。這樣可以比較「nginx 直接轉發」與「web 伺服器端呼叫」兩種服務間通訊方式。

## 功能亮點

### DockerBoard 儀表板

開啟首頁後可以看到：

- 四個服務卡：nginx、web、stats、db，包含版本、hostname、uptime、請求數等資訊。
- 架構圖與請求路徑說明。
- PostgreSQL 指標：資料庫名稱、使用者、版本、大小、啟動時間、筆記數、瀏覽次數。
- Python stats：Python 版本、平台、CPU 數、記憶體、磁碟、Python 服務自己的請求次數。
- 部署筆記列表與新增／刪除表單。
- API 範例與常用 Docker 指令速查。
- 若沒有經過 nginx（例如直接連 web），頁面會顯示「未收到 X-Gateway」提醒。

### 不需要前端框架

整個介面是伺服器端渲染（SSR），沒有 React、Vue、打包器或瀏覽器 JavaScript。這樣可以專注在 Docker 與服務拆分，也讓容器映像更小、啟動更快。

頁面使用：

- `Content-Security-Policy: default-src 'none'; script-src 'none'`。
- 表單 `application/x-www-form-urlencoded`。
- POST／Redirect／GET，避免重新整理時重複送出表單。
- 所有資料庫內容與 stats 內容都經過 HTML escaping。
- 表單內容上限 64 KB，筆記本文 1–280 字，作者最多 40 字。

### 兩個 runtime

| Runtime | 用途 | 為什麼選它 |
| --- | --- | --- |
| Node.js 22 | web 服務、SSR、PostgreSQL 查詢 | 與前端生態一致，`pg` 套件成熟，適合處理 HTTP 與表單 |
| Python 3.12 | stats 微服務 | 標準庫就能讀 `/proc`、磁碟、load average，不需要額外依賴 |

這個作業沒有使用 Rust。選擇 Node.js 與 Python 是為了在有限時間內完成兩個獨立服務，並展示不同語言的容器可以透過 Compose 網路互相呼叫。

## 快速開始

### 先決條件

- Docker Desktop（Windows／macOS）或 Docker Engine + Compose v2（Linux）。
- 支援 `docker compose` 指令，而不是舊版 `docker-compose`。
- 連接埠 `8080` 沒有被占用；若被占用，修改 `.env` 的 `APP_PORT`。

### 啟動

```powershell
cd 06
Copy-Item .env.example .env
docker compose up --build -d
docker compose ps
```

macOS／Linux：

```bash
cd 06
cp .env.example .env
docker compose up --build -d
docker compose ps
```

開啟：

```text
http://localhost:8080
```

第一次啟動會：

1. 建置 nginx、web、stats 三個映像。
2. 建立 `dockerboard_frontend` 與 `dockerboard_backend` 網路。
3. 建立 `dockerboard_pgdata` volume。
4. 啟動 PostgreSQL，執行 `db/init.sql`，建立資料表與 3 筆範例筆記。
5. 等 db、stats、web 健康後才啟動 nginx。

### 停止

```powershell
docker compose down
```

這會停止並移除容器與網路，但保留 `dockerboard_pgdata`，下次啟動資料還在。

### 重置資料

```powershell
docker compose down -v
```

`-v` 會刪除 named volume。下次 `up` 時 PostgreSQL 會重新執行 `db/init.sql`，回到 3 筆種子資料、瀏覽次數 0。

### 查看狀態與日誌

```powershell
docker compose ps
docker compose logs -f nginx
docker compose logs -f web
docker compose logs -f stats
docker compose logs -f db
```

只想看最近 100 行：

```powershell
docker compose logs --tail=100 web
```

### 進入容器

```powershell
docker compose exec web node -e "console.log(process.version)"
docker compose exec stats python -V
docker compose exec db psql -U dockerboard -d dockerboard -c "SELECT * FROM deploy_notes ORDER BY id;"
```

### 修改連接埠

編輯 `.env`：

```dotenv
APP_PORT=9090
```

重新啟動：

```powershell
docker compose up -d
```

nginx 容器仍然監聽 `80`，只是主機連接埠改成 `9090`。

### 修改資料庫密碼

`.env.example` 的密碼只是範例，請改成自己的密碼：

```dotenv
POSTGRES_PASSWORD=your_strong_password
```

注意：

- 密碼會直接組成 `DATABASE_URL`，請使用 URL-safe 字元（英數字、`_`、`-`）。若密碼包含 `@`、`:`、`/` 等字元，需要另外做 URL encoding，或調整 Compose 中的 `DATABASE_URL`。
- PostgreSQL 只會在 volume 第一次初始化時使用 `POSTGRES_PASSWORD`。如果 volume 已經存在，改 `.env` 不會自動改資料庫密碼；需要 `docker compose down -v` 重建，或進 DB 執行 `ALTER ROLE`。
- `.env` 已被 `.gitignore` 忽略，不要提交到版本控制。

## API 一覽

以下路徑除了特別註明外，都是經由 nginx 代理到 web。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/` | DockerBoard 首頁；會增加 `dashboard_views` |
| `GET` | `/api/health` | web 健康檢查；會實際執行 `SELECT 1` 確認 DB |
| `GET` | `/api/system` | 回傳 web、db、stats、notes 的完整 JSON；不增加瀏覽次數 |
| `GET` | `/api/notes` | 回傳最近 50 筆部署筆記 |
| `POST` | `/notes` | 新增筆記，表單欄位 `author`、`body` |
| `POST` | `/notes/:id/delete` | 刪除指定筆記 |
| `GET` | `/api/stats` | 經 nginx 直接代理到 Python stats 的 `/stats` |
| `GET` | `/api/stats/` | 經 nginx 代理到 Python stats 的 `/` |
| `GET` | `/nginx-health` | nginx 自己的健康檢查，回傳 `ok` |

### curl 範例

Windows PowerShell 建議用 `curl.exe`，避免 `curl` 別名指向 `Invoke-WebRequest`。

```powershell
curl.exe http://localhost:8080/api/health
curl.exe http://localhost:8080/api/system
curl.exe http://localhost:8080/api/notes
curl.exe http://localhost:8080/api/stats
```

新增筆記：

```powershell
curl.exe -L `
  -H "Content-Type: application/x-www-form-urlencoded" `
  --data-urlencode "author=demo" `
  --data-urlencode "body=從 curl 寫入 PostgreSQL" `
  http://localhost:8080/notes
```

刪除筆記（請把 `4` 換成實際 id）：

```powershell
curl.exe -L -d "confirm=1" http://localhost:8080/notes/4/delete
```

`-d "confirm=1"` 只是讓 curl 以 POST 送出請求，伺服器不會使用這個欄位。

### API 回應範例

`GET /api/health` 成功時：

```json
{
  "ok": true,
  "service": "web",
  "database": "up",
  "latency_ms": 2,
  "hostname": "8f2c1a3d4b5e",
  "node": "v22.x.x",
  "uptime_seconds": 42,
  "time": "2026-11-10T12:00:00.000Z"
}
```

`GET /api/stats` 會回傳 Python 服務的狀態，包含 `service`、`python`、`hostname`、`uptime_seconds`、`requests`、`gateway`、`client` 等欄位。

## 資料持久化實驗

這個專案把「容器可丟棄、資料要保留」做成可以直接觀察的實驗。

### 實驗一：重啟後資料還在

1. 開啟首頁，新增一筆筆記，記下瀏覽次數。
2. 執行：

```powershell
docker compose restart
```

3. 重新整理首頁。筆記與瀏覽次數都還在。

原因：資料寫在 `dockerboard_pgdata`，不是容器可寫層。容器重啟不會刪除 volume。

### 實驗二：移除容器後資料還在

```powershell
docker compose down
docker compose up -d
```

資料仍然存在。`down` 會移除容器與網路，但不會移除 named volume。

### 實驗三：刪除 volume 後回到初始狀態

```powershell
docker compose down -v
docker compose up -d
```

首頁回到 3 筆種子筆記、瀏覽次數 0。這是因為 `db/init.sql` 只會在 PostgreSQL 資料目錄為空時執行。

### init.sql 只執行一次

PostgreSQL 官方映像的 `/docker-entrypoint-initdb.d` 只會在資料目錄第一次初始化時執行。因此：

- 修改 `db/init.sql` 後，若 volume 已存在，新 SQL 不會自動套用。
- 若只是新增 seed data，可以用 `docker compose exec db psql ...` 手動執行，或 `down -v` 重建。
- 若要做正式 migration，應使用 migration 工具，而不是依賴 init script。

## Dockerfile 設計

### nginx

`nginx/Dockerfile`：

- 基底映像：`nginx:1.27-alpine`。
- 移除預設 `conf.d/default.conf`。
- 複製自訂 `nginx.conf` 與 `proxy_headers.conf`。
- 使用 `wget` 檢查 `/nginx-health`。
- `CMD ["nginx", "-g", "daemon off;"]` 讓 nginx 在前景執行，容器才不會立刻結束。

`nginx/nginx.conf` 重點：

- `web_upstream` 指向 `web:3000`，`stats_upstream` 指向 `stats:8000`。
- upstream 啟用 `keepalive`，降低反覆建立連線的成本。
- `server_tokens off` 隱藏版本資訊。
- `client_max_body_size 1m` 限制請求大小。
- 啟用 gzip，壓縮 HTML、CSS、JSON、SVG。
- `/nginx-health` 不寫 access log。
- `/api/stats` 與 `/api/stats/` 直接代理到 stats。
- 其他路徑代理到 web。

`proxy_headers.conf` 會設定：

- `Host`
- `X-Real-IP`
- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `X-Gateway: nginx`
- `Connection: ""`（搭配 upstream keepalive）

### web

`web/Dockerfile` 使用多階段建置：

```text
node:22-alpine AS deps
  └─ npm ci --omit=dev

node:22-alpine AS runtime
  ├─ 只複製 node_modules
  ├─ 只複製執行所需檔案
  ├─ USER node
  └─ HEALTHCHECK + CMD
```

重點：

- 先複製 `package.json`、`package-lock.json` 再 `npm ci`，充分利用 Docker layer cache。只要依賴沒變，重建時不必重新安裝。
- `npm ci --omit=dev` 確保安裝的是 lockfile 鎖定的版本，且不裝開發依賴。
- runtime 映像不包含測試檔與開發檔案。
- 使用非 root 使用者 `node`。
- `HEALTHCHECK` 用 Node 內建 `fetch` 呼叫 `/api/health`。
- 應用程式本身也做 graceful shutdown：收到 `SIGTERM` 時先關閉 HTTP server，再結束 pg pool。

### stats

`stats/Dockerfile`：

- 基底映像：`python:3.12-alpine`。
- 建立非 root 使用者 `app`。
- 只複製 `app.py`，因為 stats 只用 Python 標準庫，不需要 `requirements.txt`。
- `PYTHONDONTWRITEBYTECODE=1`、`PYTHONUNBUFFERED=1`。
- `HEALTHCHECK` 用 `urllib.request` 呼叫 `/health`。
- 收到 `SIGTERM`／`SIGINT` 時關閉 HTTP server。

## docker-compose.yml 設計

`docker-compose.yml` 是這個作業的核心。它負責：

- 建置三個自訂映像（nginx、web、stats）。
- 使用官方 PostgreSQL 映像。
- 建立兩個網路與一個 named volume。
- 設定環境變數、健康檢查、啟動順序、重啟策略與日誌輪替。

### 啟動順序

```text
db healthy
  └─ web healthy
       └─ nginx starts

stats healthy
  └─ web starts（web 需要 stats）
  └─ nginx starts
```

實際的 `depends_on`：

- `web` 等 `db` 與 `stats` 健康。
- `nginx` 等 `web` 與 `stats` 健康。
- `db` 沒有依賴其他服務。

`depends_on` 的 `condition: service_healthy` 只保證「啟動時」對方曾經健康，不保證之後永遠健康。執行期間仍要靠各服務的 healthcheck、`restart: unless-stopped` 與日誌來監控。

### 健康檢查

| 服務 | 檢查方式 |
| --- | --- |
| `db` | `pg_isready -U ... -d ...` |
| `web` | `fetch('http://127.0.0.1:3000/api/health')`，會實際查 DB |
| `stats` | `urllib.request.urlopen('http://127.0.0.1:8000/health')` |
| `nginx` | `wget -qO- http://127.0.0.1/nginx-health` |

web 的 healthcheck 不是只回傳「活著」，而是會執行 `SELECT 1`。因此 DB 掛掉時，web 會被標記為 unhealthy。

### 網路隔離

```text
frontend：nginx、web、stats
backend ：web、db（internal: true）
```

- nginx 只能透過 frontend 找到 web 與 stats。
- db 只在 backend，nginx 與 stats 無法直接連 db。
- web 同時在兩個網路，因為它需要接收 nginx 請求，也需要查 PostgreSQL。
- `backend` 設定 `internal: true`，不能直接對外連線。

Compose 會用服務名稱做 DNS，所以 web 可以用 `db:5432`、`stats:8000`，nginx 可以用 `web:3000`、`stats:8000`。

### Volume

```yaml
volumes:
  pgdata:
    name: dockerboard_pgdata
```

- `pgdata` 掛載到 `/var/lib/postgresql/data`。
- 使用 named volume，而不是 bind mount，避免主機路徑與權限問題。
- 明確命名 `dockerboard_pgdata`，方便用 `docker volume ls` 找到。

### 日誌輪替

三個自訂服務與 db 都使用 YAML anchor：

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

每個容器最多保留 3 個 10 MB 日誌檔，避免長期執行把磁碟塞滿。

### 重啟策略

所有服務使用：

```yaml
restart: unless-stopped
```

容器意外結束時會自動重啟，但使用者手動 `docker compose stop` 後不會被自動拉起。

## 安全設計

這是一個教學專案，不是正式生產系統，但仍刻意加入幾層防護：

- **只發布 nginx**：web、stats、db 都不對主機開 port。
- **非 root**：web 使用 `node`，stats 使用 `app`。
- **read_only**：web 與 stats 的根檔案系統唯讀，需要寫入的地方只有 tmpfs `/tmp`。
- **cap_drop: ALL**：移除 Linux capabilities。
- **no-new-privileges**：禁止透過 setuid 等方式提升權限。
- **CSP**：`script-src 'none'`，沒有瀏覽器 JavaScript。
- **HTML escaping**：資料庫與 stats 內容都先 escape 再輸出。
- **參數化 SQL**：新增與刪除筆記都使用 `$1` 參數，不拼接 SQL。
- **輸入限制**：表單 64 KB、筆記 280 字、作者 40 字。
- **POST 刪除**：刪除使用 POST，不用 GET，降低被預先觸發的機會。
- **不快取**：頁面與 API 都設定 `Cache-Control: no-store`。

尚未實作、正式環境需要的項目：

- 使用者登入與權限控管。
- CSRF token。
- HTTPS／TLS 憑證。
- Rate limiting。
- 資料庫 migration 與備份策略。
- 映像掃描與簽章。
- 秘密管理（Docker secrets 或外部 secret manager）。

## 測試與驗證紀錄

這台開發主機沒有安裝 Docker，`docker` 指令不存在；WSL 內也沒有 Docker。因此 **沒有實際執行 `docker compose up --build`，也沒有產生真正的容器映像**。README 不把未執行的步驟寫成已通過。

在沒有 Docker 的限制下，已完成以下替代驗證：

| 驗證項目 | 方法 | 結果 |
| --- | --- | --- |
| Node 單元測試 | `06/web` 執行 `node --test` | 13 tests pass、0 fail |
| JS 語法 | `node --check server.js`、`lib.js`、`views.js` | 通過 |
| HTML 結構 | 產生 SSR preview，使用 `html-validate` | 0 errors |
| Compose YAML | 用 `yaml` 套件解析 `docker-compose.yml` | 通過；services／networks／volume／anchor 可解析 |
| SQL schema 與 CRUD | 用 `pg-mem` 載入 `db/init.sql`，測試 seed、insert、delete、counter upsert | 通過 |
| Python stats | 在本機以 `PORT=8123 python app.py` 啟動，呼叫 `/health`、`/stats` | 通過 |
| HTTP E2E | 用 `pg-mem` 適配器模擬 PostgreSQL，啟動 web 與 stats，實際發送 HTTP 請求 | 通過 |
| Docker 建置與 Compose | `docker compose up --build` | **未執行，因主機無 Docker** |

### HTTP E2E 實測結果

以 `pg-mem` 模擬 PostgreSQL，並補上 `current_database()`、`current_setting()`、`pg_database_size()`、`pg_size_pretty()`、`pg_postmaster_start_time()`、`to_regclass()` 等函式後，實際啟動 web 與 Python stats，結果如下：

- `GET /`：`200`，頁面包含 DockerBoard、Python stats 與 nginx 繞過提醒。
- `GET /api/health`：`200`，`database: up`。
- `GET /api/system`：`200`，DB 正常、stats 回報本機測試環境的 Python 3.11.9（容器內為 Python 3.12）。
- `GET /styles.css`：`200`，`text/css; charset=utf-8`。
- `GET /api/notes`：3 筆種子資料。
- `POST /notes`：筆記由 3 筆增加到 4 筆。
- `POST /notes/4/delete`：回到 3 筆。
- `GET /api/nope`：`404` JSON。
- `GET /nope`：`404` HTML。
- 首頁瀏覽次數由資料庫計數器正確遞增。

`pg-mem` 不是真正的 PostgreSQL，這個 E2E 只能證明 HTTP 流程、SQL 參數化、表單與畫面邏輯可用，不能取代 `postgres:16-alpine` 的相容性測試。真正部署前仍應在 Docker 環境跑一次完整 Compose。

### 本機測試指令

```powershell
cd 06\web
npm ci
npm test
node --check server.js
node --check lib.js
node --check views.js
```

```powershell
cd 06\stats
$env:PORT = "8123"
python app.py
```

另一個終端機：

```powershell
Invoke-RestMethod http://127.0.0.1:8123/health
Invoke-RestMethod http://127.0.0.1:8123/stats
```

## 除錯與常見問題

### 1. `docker: command not found`

需要先安裝 Docker Desktop 或 Docker Engine。Windows 建議使用 Docker Desktop + WSL2 backend。安裝後確認：

```powershell
docker --version
docker compose version
```

### 2. 連接埠 8080 被占用

修改 `.env`：

```dotenv
APP_PORT=9090
```

再執行 `docker compose up -d`，改開 `http://localhost:9090`。

### 3. nginx 一直 restart

先看日誌：

```powershell
docker compose logs nginx
docker compose logs web
docker compose logs stats
```

常見原因：

- nginx 啟動時 web 或 stats 還沒 healthy。
- `nginx.conf` 語法錯誤。
- upstream 服務名稱打錯。

檢查設定：

```powershell
docker compose config
docker compose exec nginx nginx -t
```

### 4. web 顯示資料庫離線

```powershell
docker compose ps
docker compose logs db
docker compose logs web
```

確認：

- db 是 healthy。
- `.env` 的 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 與 `DATABASE_URL` 一致。
- 若曾改過密碼但 volume 已存在，需 `docker compose down -v` 重建，或進 DB 改角色密碼。

### 5. `relation "deploy_notes" does not exist`

代表資料表沒有建立。可能原因：

- volume 已存在，但 `init.sql` 沒有被執行。
- 初始化時 SQL 失敗。

查看 db 日誌：

```powershell
docker compose logs db
```

重新初始化：

```powershell
docker compose down -v
docker compose up -d
```

### 6. 修改 `init.sql` 後沒有生效

PostgreSQL 只會在資料目錄第一次初始化時執行 `/docker-entrypoint-initdb.d`。保留 volume 的情況下，請手動執行 SQL 或 `down -v` 重建。

### 7. stats 顯示離線

```powershell
docker compose logs stats
docker compose exec stats python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read())"
```

確認 stats 在 frontend 網路，且 web 的 `STATS_URL` 是 `http://stats:8000`。

### 8. 首頁顯示「未收到 X-Gateway」

代表請求沒有經過 nginx，可能直接連到 web。正常使用時應開 `http://localhost:8080`，不要開 web 的容器連接埠（web 也沒有對外發布）。

## 專案結構

```text
06/
├─ README.md
├─ docker-compose.yml
├─ .env.example
├─ .gitignore
├─ db/
│  └─ init.sql
├─ nginx/
│  ├─ Dockerfile
│  ├─ nginx.conf
│  ├─ proxy_headers.conf
│  └─ .dockerignore
├─ web/
│  ├─ Dockerfile
│  ├─ .dockerignore
│  ├─ package.json
│  ├─ package-lock.json
│  ├─ server.js
│  ├─ lib.js
│  ├─ views.js
│  ├─ public/
│  │  ├─ styles.css
│  │  └─ favicon.svg
│  └─ test/
│     ├─ lib.test.js
│     └─ views.test.js
└─ stats/
   ├─ Dockerfile
   ├─ .dockerignore
   └─ app.py
```

## 常用指令速查

| 目的 | 指令 |
| --- | --- |
| 建置並啟動 | `docker compose up --build -d` |
| 只看狀態 | `docker compose ps` |
| 看日誌 | `docker compose logs -f web` |
| 進入 web | `docker compose exec web sh` |
| 進入 db | `docker compose exec db psql -U dockerboard -d dockerboard` |
| 驗證 Compose | `docker compose config` |
| 測 nginx 設定 | `docker compose exec nginx nginx -t` |
| 重啟 | `docker compose restart` |
| 停止 | `docker compose down` |
| 停止並刪資料 | `docker compose down -v` |
| 重建單一服務 | `docker compose build --no-cache web` |
| 看資源使用 | `docker stats` |
| 看 volume | `docker volume ls` |
| 看網路 | `docker network ls` |

## 學習心得

### 1. Dockerfile 是「怎麼做一個映像」，Compose 是「怎麼跑一組服務」

一開始容易把兩者混在一起。實際拆開後比較清楚：

- Dockerfile 負責單一映像的建置步驟、基底環境、非 root 使用者、健康檢查。
- Compose 負責多容器之間的網路、volume、環境變數、啟動順序與對外連接埠。

同一個 web 映像可以在不同 Compose 專案中重複使用；反過來說，Compose 不應該承擔安裝套件的工作。

### 2. 服務名稱就是 DNS

在 Compose 網路中，`web`、`stats`、`db` 不只是服務名稱，也是 DNS 名稱。nginx 可以用 `web:3000`，web 可以用 `stats:8000`、`db:5432`。這比硬編 IP 更穩定，也讓容器重建後不需要改設定。

### 3. `ports` 與 `expose` 的差別

- `ports` 會把容器連接埠發布到主機。
- `expose` 只是文件與映像層級的宣告，不會對主機開放。
- 沒有寫 `ports` 的服務，只能透過同一個 Compose 網路或 `docker compose exec` 存取。

這個專案只發布 nginx，就是利用這個差異做網路隔離。

### 4. 容器可丟棄，資料要放在 volume

把 PostgreSQL 的資料放在 named volume 後，容器重建不會影響資料。反過來說，如果把資料寫在容器可寫層，`docker compose down` 後就消失了。這個實驗比只看文件更有感。

### 5. 健康檢查不是萬靈丹

`depends_on` 的 `condition: service_healthy` 可以改善啟動順序，但它只保證「啟動時」對方健康。服務執行期間仍可能掛掉，所以還需要：

- `restart: unless-stopped`
- 持續的 healthcheck
- 日誌與監控
- 應用程式自己的 retry 與 graceful shutdown

### 6. 反向代理是服務對外的單一入口

nginx 讓外部只需要記住一個連接埠，就能存取多個服務。它也適合集中處理：

- TLS
- gzip
- 請求標頭
- 存取日誌
- 路由規則
- 未來的 rate limiting

把 DB 藏在 backend 網路，只讓 web 連線，是很有感的隔離設計。

### 7. 沒有 Docker 也要誠實記錄限制

這次最大的限制是開發主機沒有 Docker，因此無法真正建置映像與執行 Compose。取代方案是：

- 用 Node 測試驗證畫面與工具函式。
- 用 `pg-mem` 驗證 SQL 與 HTTP 流程。
- 用本機 Python 驗證 stats 服務。
- 用 YAML parser 驗證 Compose 語法。
- 用 `html-validate` 驗證 SSR HTML。

這些測試能抓到很多問題，但不能取代真正的 Docker build 與 container runtime。若後續在安裝 Docker 的機器上執行，應優先確認：

1. `docker compose up --build -d` 能成功。
2. `docker compose ps` 四個服務都 healthy。
3. 首頁、`/api/health`、`/api/stats` 都正常。
4. 新增筆記後 `docker compose restart` 資料仍在。
5. `docker compose down -v` 後回到初始狀態。

## 作業狀態

- 程式碼、Dockerfile、Compose、資料庫初始化、stats 服務與 SSR 介面已完成。
- Node 測試 13 項全部通過。
- HTML 驗證 0 errors。
- Compose YAML 與 SQL 已做靜態／模擬驗證。
- **Docker 映像建置與 Compose 全鏈路尚未實跑，原因是本機沒有 Docker。**
- 若要在課堂或另一台機器展示，請先安裝 Docker Desktop，再依照「快速開始」執行。
