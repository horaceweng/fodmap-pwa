# 腹敏拍拍 v3 修改規格：同時檢查膽固醇

在現有程式上修改（先讀 SPEC.md、SPEC-v2.md 了解原設計）。原有限制全部仍然適用：不加套件、不用 build 工具、UI 用繁體中文、**不得修改 `data/` 底下任何檔案**、分類只能由 classify.js 查表決定（模型只回傳 food_id）。

## 1. 資料變更（已完成，你只需要讓程式支援）

- `data/fodmap.json`：新增 11 項（`fish`、`squid`、`crab`、`shellfish`、`fish_roe`、`dried_seafood`、`organ_meat`、`egg_white`、`egg_yolk`、`fatty_meat`、`coconut`），都有 `"source": "general"`。`fresh_meat` 的別名移除了「魚肉」「魚」（改到 `fish`）。`mayonnaise` 加了別名「蛋黃醬」。
- 新檔 `data/cholesterol.json`：

```json
{
 "source": "…說明文字…",
 "levels": { "high": "高膽固醇", "moderate": "中等", "low": "低", "none": "不含" },
 "thresholds": "高：≥200 mg／100g；中等：50–199；低：1–49；不含：0（植物性食物）",
 "foods": { "<food_id>": { "level": "high|moderate|low|none", "note": "可選", "satfat": true（可選） }, … }
}
```

`foods` 涵蓋 fodmap.json 的每一個 id。`satfat: true` 表示飽和脂肪高。

## 2. classify.js

- `buildIndex(db, cholDb)`：多收第二個參數（可省略）。index 增加 `chol`：`Map<food_id, {level, note, satfat}>`，以及 `cholLevels`、`cholSource`、`cholThresholds`。沒傳 cholDb 時 `chol` 是空 Map，其他功能照舊（舊測試不能壞）。
- 新增並匯出 `cholOf(foodId, index)`：回傳 `{ level, note, satfat }`；查不到時回傳 `{ level: "unknown", note: "", satfat: false }`。
- 新增並匯出 `classifyCholesterol(detections, index)`：
  - 用**同一個** `mergeDetections` 合併（不要複製一份邏輯）。
  - 輸出 `{ high: [], moderate: [], low: [], none: [], unknown: [], verdict }`。每一項：`{ food_id, name, label, level, note, satfat }`。`name` 用 fodmap.json 的 name；food_id 不在 fodmap.json 的（含 `"unknown"`）→ 放 `unknown`，name 用 label（或「未知食物」）。
  - `verdict`：`{ level, highNames, moderateNames, satfatNames, unknownCount }`。`level` 規則：有 high → `"high"`；否則有 moderate → `"moderate"`；否則 `"low"`（low 與 none 都算 low）。`satfatNames` 是所有 `satfat` 為 true 的項目名稱。
- `classify()` 本身**不改**輸出格式。

## 3. claude.js 提示詞

兩個模板的規則 1 改成：「只負責辨識，不要判斷高低腹敏或膽固醇。」

**meal 模板**在規則 7 後面插入一條新規則（後面的編號往後順延）：

```
8. 動物性食材請盡量分清楚，因為膽固醇差很多：
   - 蛋：整顆蛋用 egg；只有蛋白用 egg_white；只有蛋黃（例如鹹蛋黃、溏心蛋黃另外放）用 egg_yolk。
   - 海鮮：魚用 fish；魷魚、花枝、透抽、章魚用 squid；蝦用 shrimp；螃蟹用 crab；蛤蜊、牡蠣、干貝用 shellfish；魚卵、烏魚子、蟹黃用 fish_roe；蝦米、小魚乾用 dried_seafood。
   - 肉：瘦肉用 fresh_meat；五花肉、肥肉、帶皮雞肉、豬腳、爌肉用 fatty_meat；豬肝、大腸、雞胗等用 organ_meat；香腸、火腿、培根用 processed_meat。
   - 奶油：塗麵包的奶油用 butter，鮮奶油用 cream。
```

**label 模板**的規則 3 例子後面加上：「蛋黃粉 → egg_yolk；全蛋液、蛋粉 → egg；蛋白粉（雞蛋）→ egg_white；豬油、牛脂 → fatty_meat；奶油、無水奶油 → butter；椰子油、椰漿 → coconut。」

label 模板的規則 5 句尾加上：「來自動物的成分（例如動物油脂、肉萃取物）對應不到清單時，也要列為 unknown。」

其他參數、schema 都不變。

## 4. app.js

### 載入
init 同時抓 `./data/fodmap.json` 和 `./data/cholesterol.json`（`Promise.all`），`buildIndex(foodDb, cholDb)`。cholesterol.json 載入失敗時**不要**讓整個 App 掛掉：用 `buildIndex(foodDb)`，膽固醇功能自動隱藏（`index.chol.size === 0` 就當作關閉）。

### 設定頁
在模型選單下面加一個勾選框：「同時檢查膽固醇」，預設勾選，存在 `localStorage` 的 `fodmap.showChol`（`"1"` / `"0"`，沒有值當作 `"1"`）。用現有的 `lsGet`/`lsSet`。
`const cholOn = () => index.chol.size > 0 && lsGet("fodmap.showChol") !== "0";`

以下 UI 只在 `cholOn()` 為 true 時出現。

### 首頁
副標題改成：開啟時「拍下餐點，檢查 FODMAP 腹敏食材與膽固醇」；關閉時維持原文。

### 結果頁（有項目時）
順序：dish 文字 → **腹敏 verdict 卡（原本的）** → **膽固醇 verdict 卡（新）** → 腹敏分組清單（原本的）→ **膽固醇明細（新）** → 「＋ 手動新增食材」。

膽固醇 verdict 卡（class `card verdict chol-<level>`）：
- high：`🥚 膽固醇高：{highNames 用、連接}`
- moderate：`🥚 膽固醇中等：{moderateNames}（適量即可）`
- low：`✅ 膽固醇低`
- 下方小字（沿用 `.sub`），各自一行，有才顯示：
  - `飽和脂肪高：{satfatNames}（也會讓血中膽固醇上升）`
  - `另有 N 項無法確定`

膽固醇明細：標題 `<h2 class="group-title">🥚 膽固醇</h2>`，然後：
- high 與 moderate 的每一項各一張小卡（class `card item chol-<level>`）：badge（高 / 中等）＋ 名稱 ＋ `satfat` 時加 `<span class="tag">飽和脂肪高</span>` ＋ note（`.note`）。**不要**放「不是這個／改成…」按鈕（修改統一在上面的腹敏清單做，改了兩邊都會更新，因為都從 `state.detections` 算）。
- low 與 none 合併成一行灰字：`低或不含膽固醇：{名稱用、連接}`。
- unknown 一行灰字：`無法確定：{名稱}`。

### 腹敏清單的每張卡片
`itemHtml` 在名稱後面加一個小 tag 顯示該食物的膽固醇，只在 level 是 high 或 moderate 時顯示：`<span class="tag chol-high">膽固醇高</span>` / `<span class="tag chol-moderate">膽固醇中等</span>`。

### 查詢頁、選擇器
`foodRow(f)` 的名稱後面同樣加上第二個 badge：`🥚 高` / `🥚 中` / `🥚 低` / `🥚 無`（class `badge chol-<level>`）。查詢頁上方說明文字加一行：「🥚 為膽固醇（每 100 公克）：高 ≥200 mg、中 50–199、低 1–49、無 = 植物性食物不含膽固醇。」

### 免責聲明
開啟時，兩種模式的免責聲明後面都加一句：「膽固醇為一般營養資料的約略值，實際攝取量取決於份量；有高血脂問題請遵循醫師建議。」

## 5. styles.css

新增 class，顏色沿用現有變數：
- `chol-high` → 跟 `high` 一樣（紅）
- `chol-moderate` → 跟 `conditional` 一樣（黃）
- `chol-low`、`chol-none` → 跟 `low` 一樣（綠）

需要涵蓋 `.verdict.chol-*`、`.badge.chol-*`、`.card.item.chol-*`（看現有 `.item.high` 等怎麼寫的就照著寫）、`.tag.chol-high`、`.tag.chol-moderate`（tag 用文字色和邊框色即可）。

## 6. sw.js

`CACHE_VERSION` 改成 `"v3"`；`SHELL` 加上 `"./data/cholesterol.json"`。

## 7. README.md

第一段說明加上會同時查 `data/cholesterol.json` 判斷膽固醇高 / 中等 / 低 / 不含，可在設定關閉。

## 8. 測試（tests/classify.test.mjs）

測試檔載入 cholesterol.json，用 `buildIndex(db, cholDb)`。舊測試保持通過。新增：
- `classifyCholesterol([egg])` → verdict high，`highNames` 含「蛋」
- `egg_white` → none，verdict low
- `[fresh_meat, cabbage]` → verdict moderate
- `[butter]` → high 且 `satfatNames` 含「牛油」
- `[unknown 神秘醬, cabbage]` → `unknownCount` 1，verdict low
- 重複的 `egg` 只算一項
- `cholOf("nope", index).level === "unknown"`
- `buildIndex(db)`（不給 cholDb）仍可用，`classify` 正常
- `searchFoods("魚")` 結果包含 `fish`；`searchFoods("魷魚")` 包含 `squid`
- 資料完整性：fodmap.json 每個 id 都在 cholesterol.json；cholesterol.json 沒有多餘的 id；level 只會是 high/moderate/low/none；所有名稱＋別名不重複對應到兩個不同 id

## 驗收（完成前執行並回報實際輸出）

1. `node tests/classify.test.mjs` 全部通過
2. 每個 .js 檔 `node --check --input-type=module < file`
3. `git diff --stat`，確認 `data/` 沒有被你改動
4. **不要**啟動 http server（使用者的 8911 port 正在使用中）；**不要**執行任何 tailscale 指令；**不要** commit 或 push
