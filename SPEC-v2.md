# 腹敏拍拍 v2 修改規格

在現有程式上修改（先讀 SPEC.md 了解原設計）。原有限制全部仍然適用：不加套件、不用 build 工具、UI 用繁體中文、不得修改 `data/fodmap.json`、高低分類只能由 classify.js 查表決定。

## 1. 資料變更（已完成，你只需要讓程式支援）

`data/fodmap.json` 已更新：
- 食物從 101 項增加到 177 項，新增 `調味料`、`添加物` 兩個分類（`categories` 已更新）
- 新增項目有 `"source": "general"`；原表格的項目**沒有** `source` 欄位，視為 `"table"`
- 頂層新增 `sources`：`{ "table": "使用者提供的表格", "general": "補充：一般 FODMAP 常識（參考 Monash 大學資料）" }`

UI 要求：`source === "general"` 的食物，在查詢頁、選擇器、辨識結果中都顯示一個小標籤「補充」（灰色、小字）。查詢頁最上方加一行小字說明：「標『補充』的項目不在你原本的表格裡，是一般 FODMAP 常識。」
`classify()` 輸出的每一項要帶上 `source`（沒有就是 `"table"`），讓 UI 使用。

## 2. 首頁改成兩個主要按鈕

- 「🍱 拍食物」：副標「料理好的或生的食材都可以」
- 「📋 拍成分標示」：副標「包裝背面的成分表」
- 兩個按鈕同樣大小、都很醒目，上下排列
- 「從相簿選擇」改成兩個小連結，分別放在各自主按鈕下方：「或從相簿選擇」（因為模式不同，相簿選擇也要分兩種）
- 「🔍 查詢食物」保留

實作：一組隱藏的 `<input type="file">` 就好，點按鈕時先記住 `mode`（`"meal"` 或 `"label"`），再觸發相機 input 或相簿 input。`handleFile(file, mode)`。

結果頁標題依模式顯示「辨識結果」或「成分標示分析」。

## 3. claude.js：模式參數

`analyzeImage({ ..., mode })`，`mode` 是 `"meal"` 或 `"label"`。
- `"meal"`：沿用現有 system prompt，但把規則 1 前面的開頭改成提到「照片可能是料理好的食物，也可能是還沒料理的生鮮食材」。
- `"label"`：使用下面的 LABEL 提示詞。
- 兩種模式共用同一個 RESULT_SCHEMA、同一個 food list 插入方式、同一個請求參數。
- user 訊息的文字：meal 用「請辨識這張照片中的食物與食材。」；label 用「請讀出這張成分標示並逐項對應。」

LABEL 提示詞（`{FOOD_LIST}` 同樣動態插入）：

```
你是協助腸躁症（IBS）患者閱讀食品成分標示的助手。你會看到一張包裝食品成分標示的照片，任務是讀出成分，並把每一項對應到下方食物清單的 id。

食物清單（id | 名稱 | 別名）：
{FOOD_LIST}

規則：
1. 只負責讀取與對應，不要判斷高低腹敏。
2. 逐項讀出「成分」或「原料」欄位中的每一個成分。營養標示（熱量、蛋白質等數字）不用管。
3. 每個成分對應到清單中最接近的 id。例如：小麥粉、麵粉、麩質、大麥麥芽 → wheat_products；洋蔥粉 → onion_powder；脫脂奶粉 → milk_powder；菊苣纖維 → inulin；果糖、高果糖糖漿 → hfcs。
4. 括號內的子成分也要拆開。例如「調味粉（鹽、洋蔥粉、大蒜粉）」→ basic_seasoning + onion_powder + garlic_powder。
5. 對應不到清單的成分（例如香料、色素、防腐劑、乳化劑、維生素）：只有在它可能含高腹敏成分時才列為 unknown；明顯無關的添加物（如維生素、色素、防腐劑）不用列出。「天然香料」「調味料」「香辛料」這類不明確的寫法要列為 unknown，因為可能含洋蔥或大蒜。
6. 成分標示依含量由多到少排列。reason 要寫出這個成分排在第幾項、共幾項，例如「第 2 項／共 12 項，含量多」或「第 11 項／共 12 項，含量少」。
7. 這些是讀出來的字，visible 一律為 true。label 寫標示上的原文。
8. confidence：字清楚就高；字模糊、被遮住或你在猜就低於 0.5。
9. dish 寫產品名稱（若看得到），否則寫「包裝食品」。
10. 如果照片中看不到成分表，或字太模糊無法讀，items 回傳空陣列，dish 寫「看不清楚成分標示，請靠近一點、對焦後重拍」。
11. 所有文字使用繁體中文。
```

## 4. 結果頁

- items 為空時：不要顯示「✅ 未發現高腹敏食物」，改顯示 dish 文字（灰色卡片）＋「重新拍攝」按鈕（用同一個模式再開相機）。這同時修正 meal 模式拍到非食物時的誤導。
- label 模式時，結果頁底部免責聲明改為：「結果由 AI 讀取成分標示，僅供參考。成分排序代表含量多寡，排在後面的通常份量較少。請以實際包裝為準。」

## 5. sw.js

`CACHE_VERSION` 改成 `"v2"`。

## 6. 測試

在 `tests/classify.test.mjs` 新增：
- `onion_powder` → high，且 `source === "general"`
- `garlic`（原表）→ `source === "table"`
- `silken_tofu` → high；`tofu` → low
- `searchFoods("菊苣纖維")` 找到 `inulin`
- `searchFoods("毛豆")` 只找到 `edamame`（不能再出現 `whole_beans`）
- 資料完整性：所有 id 唯一；每個食物的 category 都在 `categories` 中；level 只會是 low/high/conditional

## 驗收（完成前執行並回報實際輸出）

1. `node tests/classify.test.mjs` 全部通過
2. 每個 .js 檔 `node --check --input-type=module < file`
3. **不要**啟動 http server（使用者的 8911 port 正在使用中）；**不要**執行任何 tailscale 指令
4. 列出修改過的檔案，以及任何與規格不同之處
