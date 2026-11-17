# PDF 頁面整理（tools.zcreation.art/pdf/）

在瀏覽器裡整理 PDF 頁面、在頁面上加方塊等圖形，再下載成新的 PDF。不列在網站首頁，網址只給需要的人。

## 怎麼用

1. 按「加入 PDF」或把檔案拖進視窗。可以一次加好幾份，所有頁面會排在一起。
2. 點縮圖選頁（Ctrl 點多選、Shift 點範圍選、Ctrl+A 全選），用「刪除」「複製」整理；拖曳縮圖調順序，不同檔案的頁面可以混排。
3. 雙擊縮圖或按「加圖形」：在頁面上拖出方塊、圓角方塊、圓形、直線。顏色、有無框線、框線粗細從工具列選。點圖形可以拖動、拉角落縮放，按 Delete 刪除。上一頁／下一頁換頁，Esc 或「完成」回到頁面總覽。
4. 按「下載 PDF」。

Ctrl+Z 可以復原上一步（刪頁、複製、排序、加入檔案、圖形的新增／移動／縮放／刪除／改樣式都算）。

## 要知道的事

- **檔案不會上傳。** 全部在這個分頁裡處理。關掉分頁或重新整理，沒下載的進度就沒了（離開前瀏覽器會提醒）。
- **不支援有密碼保護的 PDF**，包括一般閱讀器打得開、但設了權限密碼的檔案。
- 從不同檔案搬頁時，原檔的書籤和頁面之間的連結可能會遺失。
- 下載後，圖形會固定畫進頁面，之後不能再當成物件修改。
- **白色方塊只是蓋住**，底下的文字仍在檔案裡，可以被選取、複製、搜尋。
- 罕見情況：加密設定不完整的檔案（加密字典缺少 `/P`）會顯示「無法讀取」而不是「有密碼保護」。

## 開發

純 HTML＋JavaScript，沒有打包流程。`assemble.js` 是唯一寫出 PDF 的地方（頁面順序、複製頁面、圖形座標換算）；`app.js` 是頁面總覽，`editor.js` 是加圖形的編輯器。

本機開啟（module 與 worker 需要 http，不能用 `file://`）：

```bash
python3 -m http.server 8000   # 在 repo 根目錄執行，然後開 http://localhost:8000/pdf/
```

測試：

```bash
cd pdf/test
npm ci
npx playwright install chromium
npm test                 # Node：assemble() 的頁數、順序、旋轉、圖形座標
npm run test:browser     # Chromium：整條操作流程、下載檔比對
npm run mutation         # 故意改壞 assemble.js，確認測試會失敗
```

`test-browser.js` 另外用 macOS 的 PDFKit（`render-pdfkit.swift`）重畫下載的檔案取色，這一步只在 macOS 上跑。

### 函式庫（放在 `vendor/`，不走 CDN）

| 檔案 | 來源 |
| --- | --- |
| `pdf-lib.min.js` | `pdf-lib@1.17.1` 的 `dist/pdf-lib.min.js` |
| `pdf.min.js`、`pdf.worker.min.js` | `pdfjs-dist@6.5.438` 的 `legacy/build/pdf.min.mjs`、`pdf.worker.min.mjs`（改名成 `.js`，確保伺服器用 JS 的 MIME 送出） |
| `cmaps/`、`standard_fonts/` | 同一版 `pdfjs-dist` 的同名資料夾（沒有內嵌字型的中文 PDF 需要 cmaps） |
| `wasm/` | 同一版 `pdfjs-dist/wasm/` 的 jbig2、openjpeg、qcms 與授權檔（不含 quickjs，沒開 scripting） |

升級步驟：

1. 在 `pdf/test/package.json` 改 `pdfjs-dist` 版本，`npm install`。
2. 依上表從 `pdf/test/node_modules/` 重新複製檔案到 `vendor/`（`.mjs` 改名成 `.js`），並更新上表的版本號。
3. 跑 `npm test`、`npm run test:browser`、`npm run mutation`，全部通過再 commit。
