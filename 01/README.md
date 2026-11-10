# mycurl

一個類似 `curl` 的 HTTP 命令列工具，只使用 Node.js 內建模組實作，沒有任何第三方依賴。

## 需求

- Node.js 20 以上

## 使用方式

```sh
node src/cli.js [選項] <url> [<url> ...]
```

或透過 npm：

```sh
npm start -- [選項] <url>
```

## 功能

- 支援 `GET`、`POST`、`PUT`、`DELETE`、`PATCH`、`HEAD` 等 HTTP 方法
- 自訂請求標頭（`-H`）
- 表單資料（`-d`）、JSON（`--json`）、multipart 上傳（`-F`）
- 將資料附加到查詢字串（`-G`）
- 跟隨重新導向（`-L`），並限制最大次數
- 自動解壓縮 `gzip`、`deflate`、`br` 回應
- 輸出到檔案（`-o`）或以遠端檔名儲存（`-O`）
- 顯示回應標頭（`-i`、`-I`）
- 基本驗證（`-u`）、Cookie（`-b`）、User-Agent（`-A`）
- 逾時控制（`-m`）、忽略 TLS 憑證檢查（`-k`）
- 詳細模式（`-v`）與傳輸統計（`-w`）
- `--fail` 在 HTTP 狀態 >= 400 時回傳錯誤

## 範例

```sh
# 取得網頁
node src/cli.js https://example.com

# 跟隨重新導向並顯示狀態碼
node src/cli.js -L -w "status=%{http_code} time=%{time_total}s\n" https://example.com

# 送出 JSON
node src/cli.js --json '{"name":"wei"}' https://example.com/users

# 送出表單資料
node src/cli.js -d name=wei -d age=20 https://example.com/form

# 上傳檔案
node src/cli.js -F file=@./README.md https://example.com/upload

# 儲存到檔案
node src/cli.js -o page.html https://example.com/

# 顯示請求與回應細節
node src/cli.js -v https://example.com/
```

## 常用選項

| 選項 | 說明 |
|------|------|
| `-X, --request <method>` | 指定 HTTP 方法 |
| `-H, --header <header>` | 新增請求標頭 |
| `-d, --data <data>` | 送出資料，`@file` 讀檔、`@-` 讀 stdin |
| `--data-raw <data>` | 同 `-d`，但不解讀開頭的 `@` |
| `--data-binary <data>` | 以二進位方式讀取檔案 |
| `--json <data>` | 送出 JSON 並設定對應標頭 |
| `-F, --form <name=value>` | 送出 multipart/form-data，`name=@file` 上傳檔案 |
| `-G, --get` | 將 `-d` 資料放到 URL 查詢字串 |
| `-o, --output <file>` | 輸出到檔案，`-` 表示 stdout |
| `-O, --remote-name` | 以 URL 檔名儲存 |
| `-i, --include` | 輸出包含回應標頭 |
| `-I, --head` | 使用 HEAD 並只顯示標頭 |
| `-L, --location` | 跟隨重新導向 |
| `--max-redirs <n>` | 最大重新導向次數（預設 10） |
| `-k, --insecure` | 忽略 TLS 憑證錯誤 |
| `-s, --silent` | 不顯示錯誤訊息 |
| `-S, --show-error` | 搭配 `-s` 時仍顯示錯誤 |
| `-v, --verbose` | 顯示請求與回應細節 |
| `-f, --fail` | HTTP 狀態 >= 400 時視為失敗 |
| `--compressed` | 要求並解壓縮壓縮回應 |
| `-m, --max-time <seconds>` | 整體操作逾時秒數 |
| `-A, --user-agent <string>` | 設定 User-Agent |
| `-e, --referer <url>` | 設定 Referer |
| `-u, --user <user:password>` | Basic 驗證 |
| `-b, --cookie <data>` | 送出 Cookie |
| `-w, --write-out <format>` | 傳輸結束後輸出統計資訊 |
| `-h, --help` | 顯示說明 |
| `-V, --version` | 顯示版本 |

## 測試

```sh
npm test
```

測試會啟動本機 HTTP 伺服器，涵蓋 GET、POST、標頭、重新導向、壓縮、逾時、檔案輸出、multipart 等功能。

## 專案結構

```
01/
├── package.json
├── README.md
├── src
│   ├── cli.js       命令列參數解析與輸出
│   └── request.js   HTTP 請求核心
└── test
    ├── cli.test.js     命令列整合測試
    └── request.test.js 請求核心測試
```
