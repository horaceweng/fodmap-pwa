# 腹敏拍拍

拍食物照片，由 Claude 視覺辨識食材，再依本地 `data/fodmap.json` 查表分類為低腹敏 / 高腹敏 / 有條件 / 無法確定。分類一律由程式查表決定，模型只回傳食物 id。

## 本機執行

純靜態檔案，不需要 build 或 npm install：

```
python3 -m http.server 8000
```

用瀏覽器開啟 http://localhost:8000/ 。（iPhone 的相機與 service worker 需要 HTTPS，或 localhost。）

## 部署（GitHub Pages）

1. 將整個資料夾推到 GitHub 儲存庫。
2. Settings → Pages → 選擇分支與根目錄。
3. 用 iPhone Safari 開啟網址，點「分享」→「加入主畫面」。

所有路徑皆為相對路徑，可部署在子路徑下。

## 設定

首頁右上角 ⚙️：輸入 Anthropic API Key、選擇模型，並可按「測試連線」。金鑰只存在瀏覽器的 localStorage。請到 Anthropic Console 為此 App 建立專用金鑰並設定每月花費上限。

## 測試

```
node tests/classify.test.mjs
```

## 注意

- 執行時從 jsDelivr CDN 載入 `@anthropic-ai/sdk@1.1.0`，首次辨識需要網路。
- 結果由 AI 辨識，僅供參考，不能取代營養師或醫師建議。
- 更新程式後請調整 `sw.js` 的 `CACHE_VERSION` 以更新快取。
