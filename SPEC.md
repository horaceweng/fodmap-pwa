# 腹敏拍拍 PWA — 實作規格

給 iPhone Safari 使用的 PWA：拍食物照片 → Claude 視覺辨識食材 → 依本地 FODMAP 表分類為 低 / 高 / 有條件 / 無法確定。
**全部 UI 文字用繁體中文（台灣用語）。**

## 硬性限制

- 純靜態檔案，**不要 build 工具、不要 npm install、不要框架**。原生 HTML + CSS + ES modules。
- 唯一外部相依：Anthropic TypeScript SDK，從 CDN 以 ESM 載入，**版本鎖死**：
  `import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.1.0/+esm";`
  若該 URL 在瀏覽器實測無法載入，回報，不要自己換成 raw fetch 或其他套件。
- 不得修改 `data/fodmap.json` 的內容（只讀）。它是唯一的分類依據。
- **分類由程式查表決定，不能讓模型決定高低**。模型只回傳 food id。

## 檔案結構

```
index.html
styles.css
app.js            // UI、狀態、畫面切換
classify.js       // 查表分類（純函式，無 DOM）
claude.js         // 呼叫 Claude
image.js          // 照片壓縮
manifest.webmanifest
sw.js             // service worker，快取 app shell
icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png (180x180)
data/fodmap.json  // 已存在
tests/classify.test.mjs  // node 可執行的單元測試：node tests/classify.test.mjs
README.md         // 使用與部署說明（繁中）
```

圖示：用 Python（PIL 若有；沒有就用純 Python 寫 PNG）產生簡單圖示（綠底白色圓形 + 簡單盤子圖形即可）。

## 畫面

### 1. 首頁
- 標題「腹敏拍拍」
- 一顆大按鈕「📷 拍照辨識」：`<input type="file" accept="image/*" capture="environment">`（隱藏，由按鈕觸發）
- 次要按鈕「從相簿選擇」：同上但無 `capture`
- 「🔍 查詢食物」入口
- 右上角 ⚙️ 設定
- 若尚未設定 API Key，首頁顯示提示卡引導去設定

### 2. 辨識結果頁
- 上方顯示照片縮圖
- 載入中：顯示「辨識中…」與 spinner；可取消（AbortController）
- 整餐結論卡：
  - 有任何 high → 紅色「⚠️ 這餐含 N 項高腹敏食物：A、B」
  - 否則有 conditional → 黃色「注意份量：A、B」
  - 否則 → 綠色「✅ 未發現高腹敏食物」
  - 若有 unknown 另加一行灰字「另有 N 項無法確定」
- 四組清單，依序：🔴 高腹敏、🟡 有條件、🟢 低腹敏、⚪ 無法確定（空組不顯示）
- 每個項目顯示：
  - 表格中的食物名稱（`name`），若模型描述不同則副標顯示模型看到的描述（如「蒜末」）
  - 「推測」標籤：當 `visible === false`（看不到但料理通常會放）
  - 信心度低（< 0.5）顯示「不確定」標籤
  - 表格的 `note`（若有）
  - 模型的 `reason`（短句）
- 每項可點「✕ 不是這個」移除，或「改成…」開啟搜尋選單改成另一個 food id；移除或修改後重新計算結論
- 底部「＋ 手動新增食材」（同搜尋選單）
- 底部小字免責聲明：「結果由 AI 辨識，僅供參考，無法看出醬料與調味細節，不能取代營養師或醫師建議。」

### 3. 查詢食物
- 搜尋框，即時比對 `name` 與 `aliases`（包含比對，不分大小寫）
- 無輸入時依 `categories` 順序分組列出全部食物
- 每項顯示顏色標籤與 note

### 4. 設定
- Anthropic API Key 輸入（type=password），存 `localStorage`，key `fodmap.apiKey`
- 顯示警語：「金鑰只存在這台手機的瀏覽器裡。請到 Anthropic Console 為這個 App 建立專用金鑰並設定每月花費上限。」
- 模型選擇（存 `fodmap.model`），選項：
  - `claude-opus-5-5`「Opus 5.5（最準，預設）」
  - `claude-sonnet-5-5`「Sonnet 5.5（較便宜）」
  - `claude-haiku-5-5`「Haiku 5.5（最便宜，可能較不準）」
- 「測試連線」按鈕：送一個極小的文字請求，顯示成功或錯誤訊息
- 所有 localStorage 存取包 try/catch

## image.js

`async function prepareImage(file) -> { base64, mediaType, previewUrl }`
- 用 `createImageBitmap(file, { imageOrientation: "from-image" })`（失敗時 fallback 到 `<img>` 載入）
- 長邊縮到最多 1568px，畫到 canvas，輸出 `image/jpeg` 品質 0.85
- base64 **不可含** `data:...;base64,` 前綴
- iPhone 的 HEIC 由 Safari 在 `<input>` 時自動轉換，不需特別處理，但要確保最終一律輸出 JPEG

## classify.js（純函式，可在 node 執行）

```js
export function buildIndex(db)            // 回傳 { byId: Map, foods: [] }
export function classify(detections, index)
// detections: 模型回傳的 items 陣列
// 回傳 { high:[], conditional:[], low:[], unknown:[], verdict:{ level:"high"|"conditional"|"low", highNames:[], conditionalNames:[], unknownCount } }
export function searchFoods(query, index) // 比對 name + aliases
```

規則：
- `food_id` 存在於表 → 以表的 `level` 分組（不看模型意見），附上表的 name/note
- `food_id` 為 `"unknown"` 或不在表中 → unknown 組，顯示模型的 `label`
- 同一 food_id 出現多次 → 合併為一項（保留最高 confidence；visible 任一為 true 即 true；label 用逗號合併去重）
- verdict 僅依 high/conditional 是否非空決定；unknown 不影響 level

測試（`tests/classify.test.mjs`，用 `node:assert`，讀真實的 `data/fodmap.json`）至少涵蓋：
- 蒜（garlic）→ high；高麗菜 → low；banana → conditional
- 未知 id → unknown
- 重複 id 合併
- 全低 → verdict low；含一項 high → verdict high 且 highNames 正確
- searchFoods("蒜末") 找到 garlic；searchFoods("麵包") 找到 wheat_products

## claude.js

```js
export async function analyzeImage({ apiKey, model, base64, mediaType, foods, signal })
// 回傳 { items: [...], dish: string }
```

- `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`
- 請求（用 SDK 的 `client.beta.messages.create`）：

```js
const params = {
  model,
  max_tokens: 4000,
  output_config: {
    effort: "low",
    format: { type: "json_schema", schema: RESULT_SCHEMA },
  },
  system: SYSTEM_PROMPT,
  messages: [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "請辨識這張照片中的食物與食材。" },
    ],
  }],
};
// Opus 5.5 與 Sonnet 5.5 加上伺服器端拒答 fallback；Haiku 5.5 不支援，不可加
if (model !== "claude-haiku-5-5") {
  params.betas = ["server-side-fallback-2026-07-01"];
  params.fallbacks = "default";
}
const res = await client.beta.messages.create(params, { signal });
```

- **不要**送 `temperature` / `top_p` / `top_k` / `thinking`。
- 回應處理：
  - 先檢查 `res.stop_reason`：`"refusal"` → 丟出錯誤「模型拒絕處理這張照片，請換一張再試」；`"max_tokens"` → 丟出錯誤「回應被截斷，請再試一次」
  - 從 `res.content` 找 `type === "text"` 的 block，`JSON.parse`；解析失敗丟出可讀錯誤
- 錯誤訊息轉成中文：401「API Key 無效」、429「請求太頻繁或額度用完，稍後再試」、5xx/529「Anthropic 服務暫時忙碌，請稍後再試」、網路錯誤「無法連線，請檢查網路」。使用 SDK 的錯誤類別（`Anthropic.AuthenticationError`、`Anthropic.RateLimitError`、`Anthropic.APIConnectionError`、`Anthropic.APIError` 並看 `.status`），由具體到廣泛的順序判斷。

RESULT_SCHEMA：

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["dish", "items"],
  "properties": {
    "dish": { "type": "string" },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["food_id", "label", "visible", "confidence", "reason"],
        "properties": {
          "food_id": { "type": "string" },
          "label": { "type": "string" },
          "visible": { "type": "boolean" },
          "confidence": { "type": "number" },
          "reason": { "type": "string" }
        }
      }
    }
  }
}
```

SYSTEM_PROMPT（以程式動態把食物清單插入；清單格式每行 `id | 名稱 | 別名1、別名2`）：

```
你是協助腸躁症（IBS）患者的食物辨識助手。你會看到一張食物照片，任務是找出照片中的食材，並把每一項對應到下方食物清單的 id。

食物清單（id | 名稱 | 別名）：
{FOOD_LIST}

規則：
1. 只負責辨識，不要判斷高低腹敏。
2. food_id 必須是清單中的 id。清單裡找不到對應的，food_id 填 "unknown"，label 寫你看到的食物名稱。
3. 一道料理要拆成食材。例如「蒜炒高麗菜」→ cabbage + garlic；「火腿蛋吐司」→ wheat_products + processed_meat + egg。
4. 看不到但這類料理通常會放的食材（例如台式炒青菜的蒜、紅燒料理的洋蔥或蔥白、滷味的醬汁、勾芡）也要列出，visible 設為 false，reason 說明為什麼推測。只推測常見的，不要過度猜測。
5. 醬料、湯底、沾醬若無法判斷成分，列為 unknown，label 寫例如「醬汁（成分不明）」。
6. 香蕉請在 reason 註明看起來成熟度（偏綠／黃有斑點）；奇異果、地瓜、馬鈴薯、芋頭、玉米、燕麥、紅茶請在 reason 估計份量。
7. 青蔥若能分辨，綠色部分用 scallion_green，白色部分用 scallion_white；無法分辨時兩者都列，visible 依實際狀況。
8. confidence 為 0 到 1 的數字。
9. dish 用一句話描述這是什麼餐點。若照片中沒有食物，items 回傳空陣列，dish 寫「照片中沒有看到食物」。
10. 所有文字使用繁體中文。
```

## PWA

- `manifest.webmanifest`：name「腹敏拍拍」、short_name「腹敏拍拍」、display `standalone`、start_url `./`、theme/background color、圖示
- `index.html` head：`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`、`apple-mobile-web-app-capable`、`apple-mobile-web-app-title`、`apple-touch-icon`、theme-color
- `sw.js`：cache-first 快取 app shell（html/css/js/json/icons），**不要快取對 api.anthropic.com 的請求**；版本常數 `CACHE_VERSION`，activate 時清舊快取
- 所有路徑用相對路徑（`./`），讓 GitHub Pages 子路徑也能運作

## 樣式

- 行動優先，最大寬度 560px 置中，左右 16px 邊距，不可水平捲動
- 支援 `env(safe-area-inset-*)`
- 支援深色模式（`prefers-color-scheme`）
- 顏色：高 = 紅、有條件 = 琥珀、低 = 綠、無法確定 = 灰；顏色之外也要有 emoji/文字，不能只靠顏色
- 按鈕觸控區至少 44px

## 驗收（完成前必須自行執行並回報結果）

1. `node tests/classify.test.mjs` 全部通過
2. `python3 -m http.server 8000` 啟動後，`curl -s localhost:8000/ | head`、`curl -sI localhost:8000/manifest.webmanifest`、`curl -sI localhost:8000/sw.js` 皆 200
3. `node --check` 檢查每個 .js 檔語法（ESM 檔用 `node --check --input-type=module < file` 或改名測試）
4. 列出所有建立的檔案

不需要真的呼叫 Claude API（沒有金鑰）。
