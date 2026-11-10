# 2026-11-05 coverage 修正：測試與證據

報告本體：[`../2026-11-05-coverage-fixes.md`](../2026-11-05-coverage-fixes.md)
稽核來源：`origin/audit/2026-11-05-coverage-spec` 分支的 `audits/2026-11-05-coverage-spec.md` 與同名資料夾（本分支沒有合併那個分支；需要時用 `git show` 取出）。

## 檔案

| 檔案 | 做什麼 |
| --- | --- |
| `test-fixes-node.js` | Node 單元測試（不需瀏覽器）：跑 `__triangulationDevTests()`，再逐項測 F-01／F-02／F-03／F-05／F-06／F-15／F-16／F-17／F-19／P-03／P-04／Q-01 |
| `test-fixes-browser.js` | headless Chromium：Add Speaker／Add Phantom 表單、輸入驗證、標籤（F-07）、相機距離（F-15）、PNG 真 2×（F-18）、存檔／開檔（Q-01、Q-07b、P-04、F-06、F-16、F-19）、離線提示（F-10）、Atmos demo 的 hull-open（F-01）、手機提示條。設 `SHOTS_DIR` 時順便輸出截圖 |
| `roundtrip.js` | 稽核的 `roundtrip.js` 副本，只做了新 UI 需要的最小修改（見下） |
| `mutation-check.js` | 把每個修正「改壞」（暫存副本，不動 repo 檔案）後跑測試，確認測試會失敗 |
| `regenerate-demos.js` | 用目前的 coverage.js 重新存 `demo/*.html`（Open HTML → Save HTML），並檢查 layout 資料完全相同 |
| `load-coverage.js` | 用 Node `vm` 載入 coverage.js。**不提供** p5 的 `radians` stub（計算程式不能依賴 p5，F-10）；可模擬存檔內嵌的 state 以測開機載入 |
| `browser-helpers.js`、`checker.js` | 共用：本機 http server、p5 CDN 轉本機檔、UTF-8 locale 啟動 Chromium、檢查結果彙整 |
| `*.out.txt` | 各腳本這次的輸出（`audit-*.out.txt` 是稽核原腳本對修正後程式的重跑結果） |
| `*.png` | 報告引用的截圖（1440×900，DPR 1） |

## 跑法

```bash
cd audits/2026-11-05-coverage-fixes
node test-fixes-node.js
```

```bash
node mutation-check.js
```

瀏覽器測試需要 Playwright（Chromium）與本機的 `p5@1.11.0/lib/p5.min.js`：

```bash
npm pack p5@1.11.0 && tar xzf p5-1.11.0.tgz package/lib/p5.min.js
```

```bash
P5_LOCAL=$PWD/package/lib/p5.min.js node test-fixes-browser.js
```

```bash
P5_LOCAL=$PWD/package/lib/p5.min.js node roundtrip.js
```

```bash
P5_LOCAL=$PWD/package/lib/p5.min.js node mutation-check.js --browser
```

稽核原腳本（`test-triangulation-edges.js` 等）要放在 `audits/2026-11-05-coverage-spec/` 才找得到 `../../coverage/coverage.js`：

```bash
mkdir -p ../2026-11-05-coverage-spec && for f in load-coverage.js run-devtests.js test-triangulation-edges.js test-coverage-and-state.js; do git show origin/audit/2026-11-05-coverage-spec:audits/2026-11-05-coverage-spec/$f > ../2026-11-05-coverage-spec/$f; done
```

## 注意

- **Chromium 要用 UTF-8 locale 啟動。** 雲端容器預設是 C locale，Linux 版 Chromium 會把所有非 ASCII 的下載檔名變成 `download`（`é.html` 也一樣）。這是環境問題、不是程式問題；`browser-helpers.js` 的 `launch()` 會設 `LANG=C.UTF-8`。真實桌面瀏覽器都是 UTF-8 locale。
- headless Chromium 用軟體 WebGL，幾 fps 而已；所以 F-15 的測試直接把相機放到範圍外、讓下一個 frame 夾回來，而不是一直滾滾輪。
- `roundtrip.js` 相對稽核版的修改：(1) Add Speaker／Add Phantom 改成送出表單（speaker 用預填值；phantom 填 0／0／250，也就是舊按鈕直接新增的位置）；(2) Chromium 用 UTF-8 locale；(3) §2 檢查字串改成新的英文句子；(4) 多印自由視角是否完全相同、停用音響的標籤狀態。其餘步驟與比對方式不變。
