# Sound Coverage Sketch：2026-11-05 稽核修正報告

> **摘要**
> 1. Yves 2026-11-05 凌晨拍板的項目全部做完，分支 `coverage-fixes-2026-11`（從 `origin/main` @ `10f2e04` 開），沒有 push main、沒有 merge。
> 2. **Layout health**：沒包住聽覺中心的 layout 改成只顯示 `hull-open` 警示、不打分；平面判定改成 ±1° 仰角；區域標籤改用面的外法向量；凸包演算法改成「從最明顯可見的面往外長」，稽核 J 節 504 個案例 0 個破網，另有 manifold 檢查擋在打分之前。repo 的 Atmos 7.1.4 demo 現在正確顯示「沒包住中心」。
> 3. **完成定義 1–7 都達成**：dev tests 102/102（Node 與 Chromium）；Node 修正測試 62/62；瀏覽器修正測試 48/48；往返兩條路 STATE／UI／自由視角完全還原；30 個「改壞實作」的突變全部被測試抓到。
> 4. **需要 Yves 判斷的有 9 件**（§4），最重要的是兩個解讀：「±1°」我解讀成相對耳朵高度（所以「整圈都吊在頭上的環」現在算 hull-open，不再是平面）；SPEC 的 8 個標籤拿掉 `centerline` 後，`surround ring` 依規則永遠選不到。
> 5. 另外發現一個稽核沒列的 SPEC 不一致：`< 1024px` 時 CSS 會把所有編輯面板藏起來，但 SPEC §13 說「不阻擋任何功能」。手機提示條我照**實際行為**寫，規則要改哪邊待決。

---

## 1. 做了什麼

### Commit 清單（`coverage-fixes-2026-11`）

| Commit | 內容 |
| --- | --- |
| `fix(coverage): apply 2026-11-05 SPEC audit decisions` | coverage.js／css／index.html 全部修正、SPEC.md 同步、README／meta／landing 文字 |
| `chore(demo): re-save demos with the fixed coverage.js` | 兩個 demo 用新版重新存檔（layout 資料不變） |
| `fix(coverage): keep the offline notice above the panels` | 離線提示原本被 §2 面板蓋住（截圖時才發現），改位置與 z-index；demo 再存一次 |
| `test(coverage): 2026-11-05 fix tests, screenshots and report` | `audits/2026-11-05-coverage-fixes/` 測試、輸出、截圖與本報告 |

（第 1 個 commit 的程式改動是同一個檔案裡交錯的多項修正，沒有再拆；每一項的位置見下表。）

### 逐項修正

| 編號 | 改了什麼 | 位置 |
| --- | --- | --- |
| F-01 | 建好凸包後做包圍檢查：每個面 `n·a > ε`，`ε = sin(1°)`。不通過 → `hull-open`：只顯示現成的 `⚠ Layout doesn't enclose the listening centre…`，三角形用中性灰畫、不上健康色、不給數字、不能 hover。修正 dev test `small-circle-closed-by-phantom`（改名 `small-circle-plus-zenith-hull-open`，斷言 hull-open）；稽核 D1–D7、F2、F3、Atmos demo 加進 `__triangulationDevTests` | `analyseTriangulation`、`drawTriangulation`、dev tests |
| P-03 | 平面判定：所有點仰角都在 ±1° 以內才算平面（`PLANAR_ELEVATION_DEG = 1`），只看角度 | `analyseTriangulation` |
| F-03 | 區域用面的外法向量；照 SPEC 規則（z、y 門檻，其餘最大分量）；拿掉 `centerline`、`the surround region`、`the layout`；平手列前兩名（`front and rear`）；SPEC §8.3 補平手規則 | `regionForDirection`、`dominantRegion` |
| F-04 | 程式維持 75°／105°；SPEC §8.2 改數字並寫理由 | SPEC |
| F-02 | 保護：每次分析都跑 `assertManifoldOrThrow`，失敗回 `numerical-issue`，不打分。正式修正：可見面改成**從最明顯可見的面往外連通地長**（flood fill），horizon 必須是單一迴圈，否則也回 `numerical-issue`。J 節成為 dev test（`audit-J-rounding-0-of-504-non-manifold`）與 J2 插入順序測試 | `insertPointIntoHull`、`buildSphericalHull` |
| Q-01 | `view.camera`（eye／centre／up）：滑鼠轉過或縮放就記錄，存檔帶著，開檔還原；按預設視角按鈕清掉；視窗縮放不再重設視角。SPEC §5.4、§10.2 同步 | `trackFreeCamera`、`applyCamera`、`serializeState`、`loadCamera` |
| Q-07a | `<dialog>` 表單。Speaker 預填預設值與自動 aim；使用者沒動 yaw/pitch 前，改 x/y/z 會跟著重新瞄準。Phantom 的 x/y/z 留空、必填。驗證規則和其他地方共用 | `installAddDialogs` 等、index.html |
| Q-07b | 程式不動（存檔照樣藏 Save／Open HTML）；SPEC §10.2 寫明理由 | SPEC |
| F-05 | `right = (cos yaw, −sin yaw, 0)`；SPEC §7.2 補定義 | `speakerBasis` |
| F-06 | 只濾 `\ / : * ? " < > |`、控制字元、開頭的點，空白換 `-`；HTML／PNG 都用小寫 `untitled` | `filenameStem` |
| F-07 | 停用音響的名稱標籤 `visibility:hidden`；Speakers 層關掉時整個 `#speaker-labels` 隱藏 | `updateLabels` |
| F-16 | 開檔先重設成預設 state、整份算好再一次寫入（失敗不動 STATE）；輸入欄位、Add 表單、開檔共用 `isValidFinite`／`isValidAudienceValue`／`isValidSpread`；不合法輸入不寫入、欄位標紅、離開時還原 | `applyLoadedState`、`bindNumberInput` |
| F-17 | m → cm 四捨五入到 0.01 cm | `lenStore` |
| F-15 | `CAMERA_DISTANCE_LIMITS = { min: 100, max: 5000 }`，每個 frame 在 `orbitControl` 之後夾住；開檔的相機也夾 | `enforceCameraDistance`、`clampCameraEye` |
| F-18 | 匯出時 `pixelDensity(2)` → 重畫 → 擷取 → 還原密度與投影 | `exportPng` |
| F-19 | 拿掉 Jost（理由見 §4）；live 工具 Open HTML 後 `document.title = "{name} — Sound Coverage Sketch"`；張角限制 (0, 180) | css、`importHtmlFile`、`isValidSpread` |
| P-04 | 內嵌 JS 跳脫 `</script`、`<!--`，內嵌 CSS 跳脫 `</style`；冪等 | `escapeInlineScript` |
| F-08 | Phantoms 面板標題下一行小字（常駐可見），Add Phantom 表單裡也有 | index.html |
| F-10 | p5 沒載入時畫面中央顯示提示。順便把計算用的 `radians()`（p5 的）換成自己的 `degToRad`，所以離線時面板、清單、Layout Health 照常算（原本會 `radians is not defined`） | DOMContentLoaded、index.html |
| demo | 兩個 demo 用新版重新存（`regenerate-demos.js`：live 工具 Open → Save，並檢查 layout 資料完全相同）。Atmos 舊檔的檔頭註解寫著 `Layout name: 12ch Pentakis Dome`（應是手工複製留下的），重存後正確 | demo/ |

**過程中自己抓到、已修好的 bug**：開機載入存檔的 IIFE 原本在檔案開頭，新增的 `loadCamera` 用到後面才宣告的 `const CAMERA_DISTANCE_LIMITS`（TDZ），結果「有自由視角的存檔」一開就整份退回預設 layout，只留一行 `console.warn`。已把載入器移到檔案最後並加測試（Node 模擬內嵌 state 開機 + 瀏覽器 file:// 重開）。

### F-02 的判斷（Yves 交給我決定）

沒有改門檻大小，改的是「哪些面算可見」：

- 根本原因不是門檻跟座標尺度沒關係——凸包是在**單位方向向量**上算的，座標大小根本不會傳到門檻。真正的問題是：座標四捨五入到 5–6 位小數時，環上的點只「幾乎」共圓，有些面和新點的距離在 1e-9 上下，舊程式**逐面獨立**判斷，結果可見面變成好幾塊不相連的島，horizon 變成多個迴圈，產生重複的邊和多餘的面。
- 新做法：從「看得最清楚」的那一面開始，只沿著相鄰的面往外長。可見區域一定連成一塊，結果只取決於輸入，不受浮點誤差左右。
- 驗證：稽核 J 節（8 種精度 × 63 = 504 個）全部正常；另外在 scratch 跑了 24,350 個隨機案例（多圈環、隨機旋轉、0–8 位小數、zenith／nadir），舊做法 2,074 個破網，新做法 0 個，包住中心的案例面積總和全部 = 4π。
- 保護仍然保留：manifold 檢查失敗或 horizon 不是單一迴圈 → `numerical-issue`，不顯示假分數（有 fault-injection 測試）。

---

## 2. 逐條驗證結果

| # | 完成定義 | 結果 | 證據 |
| --- | --- | --- | --- |
| 1 | `__triangulationDevTests()` 在 Node 與 headless Chromium 全數通過（含新增） | ✅ Node 102/102、Chromium 102/102 | `audit-run-devtests.out.txt`、`test-fixes-browser.out.txt` |
| 2 | 稽核 `test-triangulation-edges.js` 重跑：D1、D5、Atmos → `hull-open`；D6、D7 仍 ok；J 節 0/63 | ✅ 全部符合。另外 D2、D4、F2、C1、C2、F4 也是 hull-open（都沒有東西在耳朵以下），D3 從 36 面破網變成 24 面正常、面積 4π | `audit-test-triangulation-edges.out.txt` |
| 3 | `roundtrip.js` 重跑：兩條路 STATE／UI 完全還原含自由視角；停用音響的標籤不殘留 | ✅ STATE diff identical、UI diff identical、自由視角 eye+centre+up 完全相同（兩條路）；停用的 C 標籤 hidden；Speakers 層關閉時 `#speaker-labels` display none；第二代存檔與第一代 identical；三種壞檔 STATE 不變 | `roundtrip.out.txt`（`roundtrip.js` 只做了新 UI 需要的最小修改，diff 見資料夾 README） |
| 4 | 每個修正至少一個「改壞就失敗」的測試 | ✅ Node 修正測試 62/62、瀏覽器修正測試 48/48；30 個突變（20 個 Node、10 個瀏覽器）全部被抓到 | `mutation-check.out.txt` |
| 5 | 截圖：彈出表單、hull-open、Phantoms 說明、離線提示 | ✅ `add-speaker-dialog.png`、`add-phantom-dialog.png`、`hull-open-atmos-demo.png`、`phantoms-note.png`、`offline-notice.png`，另附 `mobile-banner.png` | `audits/2026-11-05-coverage-fixes/` |
| 6 | SPEC 同步所有決策 | ✅ §2、§5.4、§7.2、§8.1–8.4、§9.1–9.2、§10.1–10.3、§11、§12、§13、§14、§17。SPEC 開頭**沒有**變更紀錄區塊，所以沒有新增；改動處都在文中標了日期 | `SPEC.md` |
| 7 | 報告、commit、push `coverage-fixes-2026-11` | ✅ 本檔；已 push `origin coverage-fixes-2026-11`（未動 main、未 merge） | — |

其他稽核腳本重跑：

- `test-coverage-and-state.js`：K1 熱區仍是 1,280,000 格 0 差異；K2 吸頂音響 yaw 0／90 的覆蓋區現在會跟著轉 90°；K2b 在 |pitch| < 87.4° 與舊版最大差 4.6e-16；L1 `2.53 m → 253 cm`；L2 沒有 phantoms 欄位的檔案開完 phantom = 0；L3 `工作坊 7.1.4 → 工作坊-7.1.4-coverage-sketch.html`。（L2 那行字尾的「stale phantom kept」是稽核腳本寫死的說明文字，數字已經是 0。）
- 瀏覽器修正測試（`test-fixes-browser.js`，48/48）：表單預填與自動 aim、張角 180° 被擋、m 輸入、phantom 空白座標被擋、行內 Infinity／181°／聽覺高度 0 不寫入、標籤、相機距離夾到 100／5000 cm、PNG 由 2880×1800 的 WebGL 畫布重畫且事後還原密度與相機、中文檔名、`</script>` 注入不執行、title、離線提示在最上層、Atmos demo 顯示 hull-open。

---

## 3. 文字「原文 → 新文」對照表（**全部待 Yves 確認**）

原則：不武斷（不說「只回答」「這是…工具」這種斷語），但「不是聲學模擬」那句保留粗體、放在前面。

| 位置 | 原文 | 新文 |
| --- | --- | --- |
| §2 中文首句（SPEC） | 這是幾何瞄準與覆蓋草圖工具。 | 這是一個用 3D 草擬音響擺位、瞄準與覆蓋範圍的幾何工具。 |
| §2 中文首句（頁面，Yves 版） | 這是一個透過 3D 視覺化呈現音響角度與覆蓋的草圖繪製工具。 | （同上，SPEC 與頁面一致） |
| §2 中文第二句 | 輸入的音響發散角將作為高頻覆蓋的近似值，並依 Pulkki-VBAP convex-hull 三角化提供 layout 健康度提示。（頁面）／它使用使用者輸入的擴音張角作為…（SPEC） | 它把你輸入的擴散角當作高頻覆蓋的近似值，並依 Pulkki VBAP 的凸包三角剖分，提供 layout 健康度提示。 |
| §2 中文限制句 | 請注意：這個工具不能取代聲學模擬，不預測 SPL、頻率響應、反射或相位，也不模擬任何 renderer 行為。 | **它不是聲學模擬：不預測 SPL、頻率響應、反射或相位，也不模擬任何 renderer 的行為。** |
| §2 中文引導句 | 它只回答兩個問題： | 它主要幫你看兩件事： |
| §2 中文兩個問題 | 「我設想的聽覺中心，真的有被我擺放的音響涵蓋嗎？」／「我的多聲道 layout 從幾何上看，對 VBAP 系列 panner 是健康的嗎？」 | 「我設想的聽覺中心，有沒有被我擺的音響涵蓋到？」／「從幾何上看，我的多聲道 layout 對 VBAP 系列 panner 是否健康？」 |
| §2 中文結尾 | 聽覺判斷仍仰賴 renderer 與你的雙耳。 | 實際聽起來如何，仍以你的 renderer 與耳朵為準。 |
| §2 英文首句 | This is a geometric aiming & coverage sketch tool. | A geometric sketch tool for placing and aiming speakers in 3D and seeing what they cover. |
| §2 英文第二句 | It uses your speaker dispersion angles as an approximation of high-frequency coverage, and provides layout-health hints based on… | It treats your speaker dispersion angles as an approximation of high-frequency coverage, and gives layout-health hints based on Pulkki-VBAP convex-hull triangulation. |
| §2 英文限制句 | It does not replace acoustic simulation. It does not predict SPL, frequency response, reflections, or phase. It does not model any renderer's behaviour. | **It is not an acoustic simulation: it does not predict SPL, frequency response, reflections or phase, and it does not model any renderer's behaviour.** |
| §2 英文引導句 | It only answers two questions: | It is meant to help with two questions: |
| §2 英文結尾 | Auditory judgement still belongs to your renderer and your ears. | How it actually sounds is still up to your renderer and your ears. |
| 手機提示條（中） | 此工具為桌面瀏覽器設計，行動裝置僅供預覽。 | 此工具為桌面瀏覽器設計。在較小的螢幕上只會顯示 3D 畫面，編輯請改用較寬的視窗。 |
| 手機提示條（英，頁面） | This tool is designed for desktop. Mobile view is for preview only. | This tool is designed for desktop. On smaller screens only the 3D view is shown — use a wider window to edit. |
| 手機提示條（英，SPEC §13） | This tool is designed for desktop. The editing experience is limited on smaller screens. | （同上一列）；**維持雙語**，SPEC §12 例外改成兩條（§2 與提示條） |
| meta description／og:description | Plan multichannel speaker layouts in 3D — visualize cone coverage on the audience plane and check Pulkki-VBAP layout health. A geometric aiming sketch for sound designers, not an acoustic simulation. | Sketch multichannel speaker layouts in 3D: see the geometric coverage of each speaker on the audience plane and get VBAP layout health hints. A sound design sketch tool, not an acoustic simulation.（含 SPEC §15 四個關鍵字） |
| README 開頭 | …sketch multichannel speaker layouts in 3D and check VBAP-family layout health, without a CAD pipeline. | …sketch multichannel speaker layouts in 3D, see their geometric coverage, and get VBAP-family layout health hints, without a CAD pipeline. |
| README「What it isn't」 | This is a **geometric aiming sketch**, not an acoustic simulator. … It only answers two questions: … Auditory judgement still belongs to your renderer and your ears. | It is a **geometric sketch**, not an acoustic simulation: … It is meant to help with two questions: … How it actually sounds is still up to your renderer and your ears. |
| README phantom 條目 | Phantom speakers to sketch panning slots that aren't physical (zenith / nadir closure, etc.) | Phantom speakers to reserve panning positions on the sphere that aren't physical speakers (e.g. closing the hull above or below the listeners) |
| README 手機條目 | No mobile-optimised editing (desktop-first; viewport < 1024px shows a banner) | No mobile-optimised editing (desktop-first; below 1024px only the 3D view is shown, with a banner saying so) |
| landing 卡片 | Plan multichannel speaker layouts: visualize cone coverage on the audience plane and check Pulkki-VBAP layout health. | Sketch multichannel speaker layouts in 3D: see each speaker's geometric coverage on the audience plane and get Pulkki-VBAP layout health hints. A geometric sketch, not an acoustic simulation. |

手機提示條為什麼這樣寫：原本我想寫「可以瀏覽，但編輯可能不太順手」，但查了 CSS 才發現 `< 1024px` 時編輯面板是**整個藏起來**的，那句話就不誠實了。新文照實際行為寫。

---

## 4. 待 Yves 確認

### 文案（照 Cowork 稿上線）

- F-08 Phantoms 說明：`Phantoms reserve a panning position on the sphere — they are not speakers to buy. Add one to see how the layout health changes when that direction is covered.`（選「面板內一行小字」，同一句也放在 Add Phantom 表單裡）
- F-10 離線提示：`The 3D view needs an internet connection to load p5.js. Your layout data in this file is intact — reconnect and reload to see the scene.`

### 我新寫的介面文字（也請過目）

- Layout Health：`⚠ Numerical issue — the triangulation for this layout could not be built reliably, so no health scores are shown.`；triangulation 說明列：`Numerical issue — triangulation withheld (N points).`
- Add Speaker 表單提示：`Yaw and pitch follow the position (aimed at the listening centre) until you edit them.`；表單標題 `Add speaker`／`Add phantom`、按鈕 `Cancel`／`Add`
- 張角 tooltip 加上「between 0° and 180°」
- live 分頁標題：`{layoutName} — Sound Coverage Sketch`（存檔的 `<title>` 仍是 layout 名稱本身，照 SPEC §10.2）

### 數值

| 項目 | 目前值 | 備註 |
| --- | --- | --- |
| 相機距離 `CAMERA_DISTANCE_LIMITS` | 100–5000 cm | 決策稿的數字，照做；一個常數 |
| 平面容差 `PLANAR_ELEVATION_DEG` | ±1° | 決策稿 |
| 包圍檢查 `ENCLOSE_EPS` | `sin(1°)` ≈ 0.0175 | **我選的**。和平面判定用同一個 1°：面所在平面離聽覺中心不到 sin 1° 就算沒包住。這種面幾乎跨半個球，原本也一定是紅色，不會誤傷健康 layout |
| 凸包可見性門檻 `HULL_VISIBILITY_EPS` | 1e-9（沒改） | 見 §1 F-02 |
| Phantoms 面板最小高度 | 190 px | 讓說明文字不會把「+ Add Phantom」擠出畫面（1440×900 實測） |

### 需要判斷的解讀

1. **「±1° 仰角」相對什麼？** 我解讀成相對耳朵高度（每顆音響的仰角都在 −1°～+1°）。後果：「整圈音響都吊在觀眾頭上、同一高度」以前算平面環（`ℹ Planar layout`），現在是 `hull-open`（加一個正下方的 phantom 就會包住）。如果你的意思是「彼此仰角差 1° 以內」，小圓環會回到平面——改一行（`analyseTriangulation` 的平面判定）並改兩個 dev test。
2. **`surround ring` 標籤**：決策是「回到 SPEC 的 8 個標籤、拿掉 `centerline`」，但 SPEC 的判定規則（z／y 門檻，其餘最大分量）只會產生 6 個方向標籤，`surround ring` 永遠選不到。SPEC 目前列 7 個並註明待決。要刪掉它，還是另訂它的規則？
3. **hull-open 時三角形要不要畫**：決策是「不上色、不給數字」。我畫成中性灰色的線（看得出凸包形狀、哪裡開口），不能 hover。若要完全不畫，刪 `drawTriangulation` 的一個分支即可。
4. **Speaker 表單的自動 aim**：我做成「使用者沒動 yaw/pitch 之前，改位置會跟著重新瞄準」，加一顆「⊙ Aim at centre」恢復跟隨。
5. **`< 1024px` 隱藏編輯面板**（稽核沒列）：CSS 的實際行為和 SPEC §13「不阻擋任何功能、不重排」衝突。這次只讓提示條照實寫，沒動 CSS。
6. **Jost**：選擇**從 CSS 拿掉**。理由：原本列了卻沒載入，而且排在 `system-ui` 後面，實際上從來沒用過；真的載入的話，自包含存檔多一個外部依賴（離線時字型會跑掉）；landing page 本來就只用 system font。SPEC §14 已改。
7. **開檔變嚴格**：共用驗證後，存檔裡用字串寫的數字（例如 `"x": "5"`）不再接受、會變 0。本工具自己存的檔一定是數字，只有手改檔案會碰到。
8. **工具版本號**沒有動（仍是 `1.0.0-beta`）。這次行為改動不少，要不要升版（例如 `1.0.1-beta`）由你決定；升版只改 `TOOL_VERSION` 一處，但 demo 要再重存一次。
9. **SPEC 變更紀錄**：SPEC 開頭沒有變更紀錄區塊，所以沒新增；需要的話可以補。

---

## 5. 無法在雲端驗證的事

- **Safari、Firefox 完全沒測。** 新用到的 `<dialog>`／`showModal()` 需要 Safari 15.4+、Firefox 98+；`String.prototype.normalize`、`:modal` 只在測試裡用。存檔下載的 Unicode 檔名在真實桌面瀏覽器應該沒問題，但沒實測（見教訓 2）。
- **真實 GPU 效能**：headless 用軟體 WebGL。PNG 匯出現在會在 2× 解析度多畫一個 frame，大螢幕、慢 GPU 上可能多等一下。
- **P-01（閒置時停止重畫）、P-02（Safari 觸控板捏合縮放）**：照指示不做，需要實機。
- **相機距離限制的手感**：100 cm 會不會太近／5000 cm 會不會太遠，要實際用滾輪感受。
- **Windows 檔名**：保留名稱（`CON` 等）因為後面一定接 `-coverage-sketch.html`，不會出問題；結尾的點、空白也會被去掉。沒有在 Windows 上實測。

---

## 6. 教訓候選

1. **開機時就執行的程式，要有自己的測試。** 存檔開機載入是包在 try/catch 裡的頂層 IIFE，新增一個後面才宣告的 `const` 就讓它在 TDZ 靜默失敗，畫面看起來完全正常（只是變回預設 layout）。只測「live 工具 Open HTML」那條路抓不到，file:// 重開那條路才抓得到。
2. **headless Chromium 在 C locale 下，所有非 ASCII 下載檔名都會變成 `download`。** 第一次看到測試失敗很像是程式的錯；確認方法是用 `LANG=C.UTF-8` 重跑。雲端瀏覽器測試涉及檔名時，先設 UTF-8 locale。
3. **數值穩定問題先看「判斷是否一致」，不要先調 ε。** 凸包破網的原因是每個面各自判斷可見性、結果互相矛盾；改成從一個確定可見的面連通地往外長就解決了，門檻值完全沒動。舊的 dev test 甚至把錯誤結果寫成預期值——測試斷言的是當時的實作，不是幾何事實。
