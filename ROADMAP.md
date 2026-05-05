# Sound Coverage Sketch — v1 實作路線圖

> 檔名：`ROADMAP.md`。此文件追蹤 v1 開發階段、每階段「視覺檢核」方式、與尚未解決的討論事項。
> **`SPEC.md` 是規格的單一真實來源，本文件是執行層計畫。**
> 進度標記變動、階段範圍調整、或實作中做出的重要決策，請同步回填到此檔。

---

## 工作流程（重要）

每個 milestone 都從本檔出發、回到本檔：

1. **動工前**：先讀本檔對應 milestone 的「範圍 / 視覺檢核」與「討論事項」，確認沒有遺漏的決定。
2. **過程中**：重要決策、踩到的坑、解決方案、新發現的遺留問題，全部回填到本檔（決策放對應 milestone 的「收尾備註」或「討論事項」；坑與限制放「收尾備註」）。
3. **完成時**：勾選對應 checkbox、寫一行收尾備註、若有跨階段影響則同步更新「討論事項」。

---

## 進度概覽

- [x] **M1** — 場景骨架 + 資料模型 + 音響 / cone / camera / 圖層 toggle（完成 2026-05-05，commit `4855bb4`）
- [x] **M2** — 聽覺平面 + 覆蓋熱區（grid sampling + gradient）（完成 2026-05-05，commit `5fa8124`）
- [x] **M3** — Phantom speaker + 球面凸包三角剖分 + Layout Health（完成 2026-05-05）
- [x] **M4** — HTML 下載 / 上傳（self-contained）+ PNG 截圖（完成 2026-05-06，A → C 三階段）
- [ ] **M5** — i18n + mobile banner + landing page 正式化 + meta / OG / 公開化

---

## 全域開發約定

- **檔案分布**：開發期維持 `coverage/index.html` + `coverage.js` + `coverage.css` 三檔分離；只有 M4 的「下載產物」需要 inline 合併（透過一個 build 函式即時組裝，不是部署檔）。
- **凸包**：自寫小型 spherical incremental convex hull，不引 npm。
- **commit 訊息**：英文，conventional style（`feat:` / `fix:` / `chore:` / `docs:`）。
- **每完成一個 milestone**：本檔對應 checkbox 打勾、寫一行收尾備註。

---

## M1 — 場景骨架與資料模型

**範圍**

- Repo 基礎檔：`index.html`（landing，先極簡一行字 + 連結，M5 再正式化）、`_headers`、`_redirects`、`robots.txt`、`sitemap.xml`
- `coverage/index.html` + `coverage.js` + `coverage.css`
- p5.js WEBGL 場景：地面格線、原點標記、X/Y/Z 軸（debug 用）、觀眾席矩形、聽覺平面（半透明）
- Camera：滑鼠拖曳 orbit、滾輪 zoom（min/max 距離限制）、5 個預設視角按鈕（Perspective / Top / Front / Side / Listening）
- 資料模型（§5）：`Speaker` / `PhantomSpeaker` / `Audience` / `ViewState`，內部統一以 `cm` 儲存
- 右側浮動面板：Add / Edit / Delete speaker（彈出 modal 或 inline 表單）；Audience 尺寸 + listening height；單位 toggle（cm ↔ m）
- 音響本體（盒型 + 文字 label）+ cone 繪製（向 yaw/pitch 方向、半透明，使用 `angleH`/`angleV` 各自獨立）
- 圖層 toggle：`floor` / `audience` / `listening-plane` / `listening-centre` / `speakers` / `cones` / `axes` / `coords`（其餘留 placeholder，後續 M2/M3 啟用）
- §2「定位語句」**完整顯示在第一屏**（不省略）
- 解決 p5.js WEBGL 座標 handedness（見下方討論事項 1）

**動到的檔案（新增）**

- `index.html`
- `_headers` / `_redirects` / `robots.txt` / `sitemap.xml`
- `coverage/index.html`
- `coverage/coverage.js`
- `coverage/coverage.css`

**視覺檢核（你親自跑的清單）**

1. 用 `python3 -m http.server` 或類似方式起本機，開 `localhost:PORT/coverage/`。
2. 第一屏看得到 §2 定位語句完整三段，**沒有被截斷**。
3. 拖曳滑鼠 → camera 繞 (0,0,0) 旋轉，**不是鏡像**（軸標 X/Y/Z 文字沒反過來、Top 按鈕按下後從上往下看符合直覺）。
4. 滾輪 → 平滑縮放，不會穿過原點或飛太遠。
5. 五個預設視角按鈕都正確：
    - Perspective：斜上方
    - Top：z 軸朝下俯視，看到觀眾席矩形是 X×Y
    - Front：從 -Y 看 +Y
    - Side：從 +X 看 -X
    - Listening：從 (0, 0, listeningHeight) 朝 +Y
6. 加 1 顆 speaker（預設座標例如 (200, 100, 200)，yaw=0、angleH=90），看到盒型 + 朝 +Y 的半透明錐體。
7. 把 yaw 改 90° → 錐體轉向 +X；改 pitch 30° → 錐體仰起；改 angleH=120 → 錐體變寬。
8. 加 3 顆 speaker、各自命名，列表正常顯示，刪除有確認對話框。
9. 改觀眾席 length/width/listeningHeight → 矩形與聽覺平面即時更新。
10. 切 cm ↔ m → 顯示數字即時轉換、內部資料不變（再切回去數字回到原樣）。
11. 圖層 toggle：每個都能各自開關。
12. Resize 視窗 < 1024px → 出現 mobile banner（M5 才完整實作，M1 先放一個 stub 也可以）。

**收尾備註**

M1 完成於 **2026-05-05**（commit `4855bb4`，已推上 `tools.zcreation.art/coverage/`）。落地內容除原訂範圍外的延伸：

- **座標 handedness 重做**：原本用「`up.z` 取負 + top view `scale(1,-1,1)`」的雙重 hack，改為單一機制 `cam.yScale = -1`（在 `applyCamera()` 中、`perspective()` 之前設定）。p5 v1.11 的 `perspective()` 在投影矩陣 Y row 寫死 `-f * yScale`——把 yScale 設成 -1 即抵銷該 Y-flip，五個視角全部用「自然」up vector，右手定則在每個視角都成立。詳見討論事項 1。
- **Aim at centre 修正**：`aimAtCentre()` 原本對著 `(0, 0, 0)`，這是「地板原點」而非「假想耳朵位置」，所以每顆音響都被往下偏。改為對著 `(0, 0, listeningHeight)`。預設 L/R/C 三顆的 pitch 也對應重算。
- **Listening centre layer**（預設 ON）：`(0, 0, listeningHeight)` 一顆 teal 球 + 從地板原點往上的細虛線，把「Z 從哪裡量、耳朵在哪裡」的關係視覺化。深度測試 OFF（同 speaker bodies），永遠可見。
- **Coordinates layer**（預設 OFF）：勾選後在每顆音響、原點、聽覺中心旁顯示 `(x, y, z 單位)`，跟著 cm/m toggle 即時更新。出圖給其他設計用。
- **Panel-vs-canvas 事件隔離**：滑鼠在 function panel 上時，拖曳和滾輪不影響 3D。實作方式：在 `document` 的 bubbling phase 對 panel target 上的 `mousedown` / `wheel` 做 `stopPropagation()`，p5 的事件 listener 掛在 `window`（更外層）所以攔在 document 就夠。`mouseup` 故意不攔，避免從 canvas 起拖、在 panel 放開時 `mouseIsPressed` 卡住。
- **柔和場景光**：`ambientLight(120) + directionalLight(180, 180, 170, -0.3, 0.4, -0.85)`，在 `drawScene()` 開頭設一次。stroke 不受影響所以軸 / 格線 / cone 邊都還是清晰線條；speaker 與 listening centre 的球體有了立體感。配色因此調亮（speaker `(30,35,55)` → `(110,122,150)`、原點 `40` → `110`），讓 shading 落在可見範圍。
- **Axes 升格**：拿掉「(debug)」標註，正式列為設計師可用的 layer。

**已知未處理（留給後續 milestone）**：

- 拖曳 top view orbit 後再切回別視角，相機可能停在奇怪角度（mode (a) 改完 yScale 後此前的 top-view scale 副作用已消失，但 orbit 殘餘狀態仍會留在相機；按任一預設視角按鈕即可重置）。
- Cone 在 pitch 接近 ±90° 時邊界仍可能退化，視 M2 / M3 用起來再決定要不要處理。
- M1 沒有 Mobile banner 的完整體驗（只有最基本的 stub），M5 補。
- `_redirects` 是空檔（只有註解），M4 / M5 視需要再加 redirect 規則。

---

## M2 — 聽覺平面覆蓋熱區

**範圍**

- 在聽覺平面做 grid sampling（解析度先 50×50，效能不足再降）
- 每個 grid point 對所有 enabled speaker 套 §7.2 角度判定（轉到 speaker 本地座標 → 比 `angleH/2`、`angleV/2`）
- 著色 lookup：0=紅 / 1=黃 / 2=橙偏綠 / 3+=綠（半透明，不蓋掉地面格線）
- 圖層 `coverage-heat` toggle 啟用
- 性能：speaker 改動時 debounce 重算（例如 50ms），避免拖 slider 時卡頓

**動到的檔案**

- `coverage/coverage.js`（新增 coverage 計算模組）
- `coverage/coverage.css`（legend / 顏色說明）

**視覺檢核**

1. 開啟 `coverage-heat` 圖層，加 1 顆 speaker 朝舞台前方（+Y）→ 觀眾席前方一段是黃 / 綠，其餘是紅。
2. 故意把 speaker 朝 +X 偏太多 → 觀眾席中央出現大片紅「黑洞」。
3. 加第二顆鏡像位置的 speaker → 中央區出現綠（兩顆覆蓋重疊）。
4. 拖曳 angleH slider 從 60° → 120° → 看到熱區即時擴張，沒有卡頓 / 沒有閃爍。
5. 切到 Listening 視角 → 熱區仍貼在聽覺平面，沒有 z-fighting。
6. 改 listeningHeight → 熱區跟著平面上下移、且重新計算（高度變了，speaker 角度判定結果應改變）。
7. 關 `coverage-heat` → 完全消失，地面格線無殘留。

**收尾備註**

M2 完成於 **2026-05-05**（commit `5fa8124`）。實作中做出的決定與踩到的坑：

- **Render path：textured plane → grouped QUADS**：原本想把 80×80 counts 寫進 `p5.Image` 用 `texture()` 貼一張圖，但 p5 v1.11 的 WEBGL renderer 在 `loadPixels()/updatePixels()` 之後 GPU 上傳會無聲失敗——quad 會 fallback 到當下 fill 色，畫面看起來整片同色。改成 compute 階段把 cell 依 count 桶進 `groupVerts[0..3]`，每 frame 4 個 `beginShape(QUADS)` 一次畫完。意外好處：sharp cell 邊界正好對齊 SPEC §3.3「誠實優先」——看得到 grid 解析度，使用者不會誤以為精度比實際高。
- **`noLights()` for heatmap pass**：`drawScene()` 開頭設的 ambient + directional light 會 modulate textured/filled surface 的 RGB，把暗色紅 / 黃往灰白 / 綠拉。heatmap 4 條 colour band 必須讀得到「pure RGB」，所以這個 pass 用 `noLights()` 隔離。
- **Listening plane fill suppression when heatmap on**：兩層都畫的話，半透明藍 fill (alpha 45) 在 heatmap (alpha 175) 下會把 colour band 整體拉灰。改為「coverage-heat layer 開啟時，listening-plane 只畫外框、不畫 fill」；toggle 關掉後 fill 自動回來。
- **Throttle，不是 debounce**：拖 angleH 時要看到 heatmap 即時擴張（檢核 #4），所以不能等使用者放手才算。改 leading-edge 50 ms throttle：第一次 dirty 立即排 50 ms 後 compute，期間任何 dirty 全部 batch 進去。實測 ~20 fps live update，無卡頓。
- **Cone 邊線弱化**：heatmap 開啟後，cone 4 條邊射線在觀眾席平面的投影會跟 colour band 互打。stroke alpha 從 200 降到 90（rays）/ 140（base outline）、base outline weight 1.5 → 1.2。Cone 仍可讀，但不再搶走 heatmap 主訊息。
- **預設 `coverage-heat` 改為 ON**：對齊 SPEC §6 layer 表（之前 M1 留 `false`）。
- **§7.2 rectangular pyramid 判定**直接用 M1 拆出來的 `speakerBasis(yaw, pitch)`——M1 為了 cone 視覺而做的「forward × world-up」基底，coverage 計算原樣套用，兩者像素級對齊。
- **Legend swatches**：layers panel 的 coverage-heat 列下方一行 chip + `0 / 1 / 2 / 3+ speakers covering`，CSS-only。

**已知未處理**（留給後續 milestone / 上線前）：

- **預設 LCR layout 是否要重排到 audience 外面**：v1 上線前依 onboarding 觀感決定，見討論事項 12。
- **Coverage 範圍止於 audience matrix 邊界**：SPEC §7.1 沒要求外擴；v1 不動。M3 三角剖分是「全 enabled speaker / phantom 都丟到單位球」，不受此限。
- **80×80 grid res 寫死**：之後若要支援極大或極小場館，可考慮以「目標 cm/cell」推算解析度。M3/M4 真正用起來再決定。
- **80×80 cell 在預設 audience 800 cm 寬下 = 10 cm/cell**，與耳朵間距同量級。畫面像素化邊緣是 feature 不是 bug，視覺上對齊「rough sketch」氣質。

---

## M3 — Layout Health（Triangulation Diagnostic）

**範圍**

- Phantom speaker 資料模型 + Add/Edit/Delete UI（§5.2）
- 球面凸包三角剖分（自寫，§17）：
    - 把所有 enabled speaker + phantom 的方向向量投影到單位球
    - Incremental convex hull on sphere → 三角形列表
    - 邊界情況：少於 4 點時不三角化、所有點共面時警示
- 每三角形計算：球面面積（L'Huilier theorem）、最大內角
- L/R 對稱性偏差：鏡像 + 最近鄰配對平均距離（弧度）
- 著色 §8.2：每三角形取「最差色」（綠 / 黃 / 紅）
- Layout Health panel（§8.3 文字，含 panel 開頭框架說明）：全綠 ✓ / 黃 ⚠ / 紅 ✗ + 對稱性獨立行
- `[region]` 判定（§8.3 重心方向 → 區域標籤）
- 圖層 `triangulation` / `phantoms` / `health-panel` 啟用
- 三角形 hover：tooltip 顯示最大內角 + 球面面積 + 健康度

**進度（截至 2026-05-05）**

- ✅ **M3.A** — Phantom speaker 資料模型 + Add/Edit/Delete UI + 3D marker（淺紫小球）+ overlay label（commit `952053f`）
- ✅ **M3.B-α** — 退化檢測 + 2D fallback + status caption + headless 測試（2026-05-05，commit `f64aa4d`）
- ✅ **M3.B-β** — 球面凸包三角剖分（sliver pre-merge、種子四面體、horizon walk、manifold assert、視覺串接）（2026-05-05，commit `060a848`）
- ✅ **M3.C** — 每三角形 metrics + 三角形著色（顏色從 M3.E 拉前）（2026-05-05，commit `df6a70b`）
- ✅ **M3.D** — L/R 對稱性偏差 + bulk-paste 與 distance/delay caption（dev affordances）（2026-05-05，commit `f6d6f32`）
- ✅ **M3.E** — Layout Health panel + region 偵測 + 動態警示（2026-05-05，commit `9cb1c6c`）
- ✅ **M3.F** — 三角形 hover tooltip + 右下 layout 修正（2026-05-05，commit `35a792a`）
- ✅ **M3.G** — Speaker hover + planar unification + 7 條視覺檢核 walkthrough（2026-05-05）

**M3.B-α 收尾備註**

落地內容：`analyseTriangulation()` 五分類（`too-few` / `point-at-centre` / `collinear` / `planar` / `ok`）+ 2D ring 繪製 + status caption + 12 個 headless 單元測試（`__triangulationDevTests()`，可從 devtools 跑）。實作中做出的決定與踩到的關鍵點：

- **mode 選單 vs auto-detect**：原本 owner 提議「在 layer 旁加 2D / 3D 選單」。否決，理由是「投影到單位球後是否共面」是實作細節，不該外露給使用者；改為自動偵測 + status caption 一行字解釋。判定邊界 `PLANAR_EPS = 1e-3 rad`（≈ 0.057°），夠緊讓正常 3D dome 不誤判、夠鬆吸收座標 rounding。
- **判定條件不是「z 都一樣」而是「方向向量共面」**：speakers 全部 z=240（非耳高）一般 *不* 共面（因水平距離各異 → 從聽覺中心看的 elevation 不同）；只有 z = listeningHeight 才必然共面。這層理解寫進 `analyseTriangulation` 的 doc 區塊。
- **Coplanarity 的 normal candidate 取最大 |d_i × d_j|**：任一非平行 pair 的 cross product 都是合法 plane normal（共面前提下），但取最大 magnitude 的那一對能把浮點誤差降到最低；之後 max |d_k · n̂| < ε 確認所有點都在這個平面上。
- **Point-at-centre collect-all（非 early return）**：owner 在測試時發現多顆音響都在原點時只列出第一顆。改成 collect 全部、status grammar 處理 1/2/3–4/5+（"X sits" → "X and Y sit" → "X, Y, and Z sit" → "X, Y, Z, and N more sit"）。誠實優先（§3.3）的小落實。`POINT_AT_CENTRE_EPS = 1.0 cm`。
- **2D ring 繪製座標**：用 azimuth 排序後的「原始 3D 位置」連線，不是球面投影位置。在 LCR 全 z=120 的典型 case 下，ring 落在 listening plane 上；在罕見的「全部前方共面」case 下會落在垂直平面上，視覺上 weird 但數學正確。
- **Render pass 安置**：drawTriangulation 進原本的 no-depth-test pass（與 speaker bodies / phantom markers / listening centre 同 pass），畫在最前面，讓 sphere markers 蓋在 ring 之上。Cone 仍走 depth-test pass。
- **Dirty / 即時性**：`markTriangulationDirty()` 用 `setTimeout(0)` 推遲 + `scheduled` flag 合併同 tick 多次 dirty。不需要 50 ms throttle（O(N²) on N≤32 = 微秒級）。Status caption 在 layer 關閉時也會更新（caption 是 layer 之外的獨立 affordance）。
- **Sliver pre-merge 延後到 B-β**：B-α 的 2D polygon 邊界即使在重合點上也只是「短邊」，視覺上沒問題；只有 hull 才會生成瘦長三角形被 M3.C 標紅。閾值已先鎖定 0.05 rad（≈ 2.9°，人耳定位 JND 量級），B-β 動手再實作。

**遺留事項到 B-β**：

- 'ok' kind 目前 draw 是 no-op，status 文字含 `(Hull rendering pending — M3.B next phase.)`；B-β 完成後要把這句拿掉、把點數補成「N points / M triangles」。
- B-α 的 coplanarity test 對「3 點近共線 + 第 4 點偏離」會偵測為 planar（best cross 來自第 4 點 + 任一其他點，前 3 個近共線點都會落在這個平面附近）。實務上不會發生，B-β 改寫成 SVD / 共變數矩陣最小特徵值可消除這個邊界。

**M3.B-β 收尾備註**

落地內容：sliver pre-merge（union-find on direction angle）、種子四面體（4-stage extreme-point 搜尋）、incremental hull main loop（visibility scan + horizon walk）、manifold assert helper、'ok' kind 三角形 wireframe 視覺、status text 加上 `→ K triangles (M sliver-merged)`。Headless 測試擴充到 24 個（含 octahedron 8 面、立方體 12 面、sliver merge collapse、50 隨機點 manifold valid）。實作中做出的決定與踩到的關鍵點：

- **Sliver merge 用 union-find 而非 greedy grouping**：greedy 不具傳遞性（A–B 0.04 rad、B–C 0.04 rad，但 A–C 0.08 > 閾值，greedy 會把 C 留下）。union-find 一遍掃對所有 pair 並聯，自動處理 transitive cluster。閾值 `0.05 rad ≈ 2.9°`（人耳 JND ~1°–3° 量級，閾值上方安全邊界）。
- **Merge representative 同時帶 dir 與 pos**：`dir` 是「組內方向向量平均後 renormalize」（hull 算法用），`pos` 是「組內 3D 位置算術平均」（畫圖用）。Names 留下供 status 與未來 M3.E 顯示。
- **Hull 面方位用 directed-edge horizon 規則自動保證**：每個 horizon edge `(u, v)` 取自被刪 visible face 的 CCW 方向，新面 `(P, u, v)` 中 `(u, v)` 邊保留同方向；非 visible 鄰面那邊的 `(v, u)` 因此仍與新面保持「opposite direction」一致 → manifold invariant 自動成立，不需後驗 normal 修正。
- **Seed tetrahedron 4-stage extreme search**：`P0` 任選 / `P1` 角距 P0 最遠 / `P2` 離 P0P1 大圓最遠（max |cross|）/ `P3` 離 P0P1P2 平面最遠（max |det|）。Seed 階段 4 個 normal 用「opposite vertex 在內側」規則計算（origin 不必在 hull 內，這條規則對任何凸 tetrahedron 都成立）。後續 incremental insertion 用上述 directed-edge 規則繼承方位。
- **'collinear' branch 變成 defensive code**：sliver merge 之後，幾何上「共線」的輸入永遠收斂到 ≤ 2 個 merged points（一條過原點的線最多 2 個方向 = forward/back），所以一定先觸發 too-few。原本 B-α 寫的 collinear test case 的期望值因此更新為 `'too-few' with mergeReduction === 2`，更貼近真實使用流程。`COLLINEAR_EPS = 1e-3 rad` 的 branch 仍保留作為極端浮點邊界的最後防線。
- **Manifold assert 三條件**：(1) 每個 directed edge 出現恰好 1 次、(2) 其反向 directed edge 也恰好 1 次（= 每條無向邊由恰好 2 個三角形共用）、(3) Euler `V − E + F = 2`。這條 assert 是 horizon walk 邊界 bug 的最佳金絲雀——任何方位翻轉、horizon 開放、重複插入 face 都會在這三條中至少一條失敗。dev tests 對 tetra / octa / cube / 50-random 全跑過、無人報錯。
- **Random50 用 deterministic LCG**：`seed = (seed * 1103515245 + 12345) & 0x7fffffff`，回放穩定。Uniform sphere 取樣用 `(z, θ)` 法（`u ∈ [-1,1]`、`θ ∈ [0, 2π)`），均勻。
- **Wireframe 渲染**：每個三角形 `beginShape() ... endShape(CLOSE)` 三點直接畫，無 fill。每條邊被相鄰兩個 face 各畫一次，alpha 220 + strokeWeight 1.3 下「畫兩次」視覺上等同畫一次（沒有可見加深），免去 per-edge dedup pass 的成本。深度測試 OFF，與 2D ring / speaker bodies / phantom markers 同 pass。
- **Status text 後綴語意**：`mergeNote(r)` helper 把 `(N sliver-merged)` 共用給 too-few / collinear / planar / ok 四個 kind，避免 ad-hoc 拼接。

**遺留事項到 M3.C**：

- 每三角形 metrics（球面面積 L'Huilier、最大內角）尚未計算 → 三角形目前都同色，無 health colour。
- 三角形 hover tooltip 尚未接（M3.F）。
- 'ok' 的 `r.points` 是 merged points 陣列；若 hover 要顯示「組成這個三角形的 source speaker names」要走 `points[i].names`（不是 `name`）。
- 「點不在 hull 上」的情境（speaker 落在其他 speaker 的方向凸殼內側）目前不在 status 裡標出——會被 incremental insertion 自然忽略。M3.E 視 onboarding 觀感再決定要不要加「N points are inside the hull and not used in the panning grid」這類提示。

**M3.C 收尾備註**

落地內容：球面三角形 metrics（L'Huilier 面積、spherical law of cosines 最大內角）+ 中位數比較 + SPEC §8.2 分類門檻（max angle > 70° / 90°、area ratio > 1.5× / 2.5×、worst-of-two-metrics）+ status caption 健康摘要後綴 `· N⚠ M✗` + 三角形邊線著色（綠/黃/紅，stroke weight 1.8）。Headless 測試擴充到 33 個（regular tetrahedron 精確值驗證、regular octahedron、random50 summary totals、現有測試格式更新）。實作中做出的決定與踩到的點：

- **著色從 M3.E 拉前**：原計畫 M3.E 一次處理「著色 + panel + region 偵測 + 動態警示」。但著色資料來源（metrics）在 M3.C 已備齊，且驗證 metrics 正確性的最自然方式就是看顏色——只看 status caption 的 `8⚠` / `4✗` 數字反而要肉眼比對抽象指標。一行 stroke 改寫 + 5 行 LEVEL_STROKE 表，立即把 metrics 變成可視化驗證點。M3.E 因此縮減成「panel 文字 + 動態警示 + region 偵測」純文字 milestone。
- **stroke weight 1.3 → 1.8**：使用者主動開啟 triangulation 表示「現在這層是焦點」，1.3 太接近 cone 邊線（1.0–1.2）和 floor grid（1.0），讀不出 hierarchy。1.8 在 cone 之上、軸線（2.0）之下，健康色在預設 perspective zoom 下清楚可辨。
- **每邊畫兩次的設計取捨**：相鄰兩 face 共用的邊會被畫兩次（per-face draw 而非 per-edge dedup）。當兩面 level 相同 → 同色疊加，視覺等同畫一次；當兩面 level 不同（如黃 + 紅）→ 第二面 stroke 顏色蓋掉第一面，肉眼看到「這一邊的鄰域有紅有黃」的混合訊息，這實際上是正確的健康訊號（哪邊有問題鄰居）。Per-edge dedup 需要 hash + 取 worst-of-two-faces 的選擇，視覺收益不明顯，留給 M3.E 視需要再優化。
- **Degenerate side guard**：sphericalTriangleArea / MaxAngle 在任何邊長 < `SPHERICAL_SIDE_EPS = 1e-9` 時直接回傳 area=0 / maxAngle=π。這對應「sliver triangle 沒被 sliver merge 攔下、但仍小到 sin(b)·sin(c) 進不到 acos」的極端浮點情境；回傳 π 讓它觸發 red threshold 而非 NaN。
- **Median 用樸素 sort + middle**：N ≤ 100 face 的層級成本可忽略；無需 quickselect。
- **Classification 順序矩陣**：red 一旦設定不可被降級。`if (angle > 90°) red; else if (angle > 70°) yellow; if (ratio > 2.5×) red; else if (ratio > 1.5× && level !== 'red') yellow;`。對應 SPEC §8.2 「最差色」原則。
- **Random50 sample 的健康分布**（3 green / 30 yellow / 61 red of 94 faces）顯示 SPEC §8.2 hardcode 的門檻是針對「好的喇叭佈署」校準，不是針對「球面均勻隨機點集」。這沒問題——使用者不會餵隨機點進工具——但確認了 **discussion item 2「對稱性 / 健康度門檻 v1 上線前需用真實 layout 校準」** 仍然是合理的。
- **Regular octahedron 落在 90° 邊界**：`> 70°` 嚴格 yes、`> 90°` 嚴格 false → 黃。語意：八面體環繞（5.1 / 7.1 風格的天頂 / 地底補充）是「不完美但可行」而非「壞」，與 M3.B-β 的 octahedron-faces 測試一致地把它當作 baseline。
- **Regular tetrahedron 落在 120°**：4 顆音響擺正四面體頂點 → max angle 120° > 90° → 全紅。geometric 上正確：4 顆就是太少，跨三角形的 phantom panning 會跳。

**遺留事項到 M3.D**：

- L/R 對稱性偏差（將所有點對 X=0 平面鏡像、最近鄰配對求平均球面距離）。判定門檻 v1 估算（黃 > 0.05 rad、紅 > 0.15 rad），上線前用真實 layout 校準（discussion item 2）。
- 對稱性結果如何呈現：獨立的 status caption 行？或整合到 'ok' 的健康摘要後綴？M3.D 動工時決定。

**M3.D 收尾備註**

落地內容：L/R 對稱偏差（每個 merged direction 找鏡射集合中最近鄰、平均角度）+ 分類 green/yellow/red（0.05 / 0.15 rad 門檻）+ status caption 條件式 sym 後綴（綠 silent、黃紅 `· sym Δ=X.XX{⚠/✗}`）+ 9 個新測試（共 42 個）。同時併入 2 個 dev / UX affordance：bulk paste 與 per-speaker distance/delay caption。

**對稱演算法決定**：

- **Greedy nearest-neighbour，不 Hungarian**：對每個 original direction d_i，找 mirror set 中與 d_i 球面距離最小的 m_j（不要求一對一配對）。Hungarian 嚴謹但實作複雜，對 N ≤ 32 的常見 layout 兩種策略結果幾乎相同（差異只在「多顆 cluster 同時拉向同一 mirror」的病態情境，speaker 配置不太會這樣）。Greedy 算 O(N²)，N=32 = 1024 ops，微秒級。
- **計算時機放在 sliver merge 之後**：原始 input 中的 sliver-pair 一旦合併成單點，鏡射對稱判定就從這一個 representative 出發，不會被「兩個近重合的 speaker 各自找最近 mirror，數值噪音」干擾。
- **Symmetry 附在所有 post-merge kind 上**：too-few / collinear / planar / ok 都帶 `r.symmetry`。point-at-centre 早返回不附（atCentre 階段 merge 還沒跑）。Status text 各 case 都加同一個 `symmetryNote(r.symmetry)` suffix，邏輯共用。
- **綠 silent**：對稱是「期待的常態」，每次都顯示 `· sym ✓` 會洗版。只在黃 / 紅報，符合「異常才出聲」的 UX 慣例（同 M3.C 的健康後綴規則）。
- **Status text 順手清掉巢狀括號**：以前 planar 帶 sliver merge 時是 `(4 points (1 sliver-merged))`，刺眼。趁 M3.D 重排 mergeNote 出 paren 之外，現在是 `(4 points) (1 sliver-merged)`。
- **Regular tetrahedron 是 L/R 不對稱**：用 alternating-sign 4 vertices 構造的正四面體（rotation-symmetric 但 mirror-asymmetric across X=0），所以 status 顯示 `· 4✗ · sym Δ=1.23✗`（acos(1/3) ≈ 1.23 rad）。`regular-tetra-status` 測試的期望值因此更新。
- **Octahedron 是 L/R 對稱**：±X / ±Y / ±Z 在 X-mirror 下封閉，Δ = 0，green。

**併入的 dev / UX affordance**：

- **Bulk paste (dev)**：每個 list panel（Speakers、Phantoms）多一個 `<details>` 折疊區，內含 textarea + 「Replace」按鈕。Parser 用 `text.match(/-?\d+(?:\.\d+)?/g)` 抓所有 signed integer/float token，每 3 個一組塞入 x/y/z。逗號 / 括號 / 換行 / 標籤都被忽略，所以 `(100, 100, 220), (-100, -100, 220)` 直接 paste 即可。這是 M4 完整 HTML state import 的輕量級表親，純 dev 加速 testing。Speaker 預設 yaw/pitch 用 aimAtCentre()、angleH/V 用 90/60；phantom 只需 x/y/z。
- **Per-speaker distance + delay caption**：每顆 speaker header 下方一行小灰字 `{N cm 或 m} · {N.N ms}`，3D 距離從 listening centre 到 speaker、延遲 = 距離 / 343 m/s（20°C 乾燥空氣，常數 `SPEED_OF_SOUND_MPS`）。tooltip 標註出處。Sound designers 用此值做 delay-line 對齊。即時更新：x/y/z 改、listeningHeight 改、cm/m toggle。Phantom 不顯示（panning slot 沒延遲意義）。

**遺留事項到 M3.E**：

- 三角形著色（M3.C）+ 健康摘要後綴（M3.C）+ symmetry 後綴（M3.D）目前都掛在 status caption 一行。M3.E 要把這些訊息搬進完整 Layout Health panel（SPEC §8.3 framing text + dynamic warning + region 偵測），caption 就回到單純的「what kind of layout this is」。
- Region 偵測（§8.3）：取問題三角形重心方向向量、依 (x, y, z) 主導分量映射到 `upper hemisphere` / `front` / `centerline` / 等標籤。
- 對稱與三角形健康門檻（discussion item 2）M5 上線前要用幾組真實 layout 校準。

**M3.E 收尾備註**

落地內容：右下浮動 `#health-panel`（鏡 `#audience-panel` 的 `position: fixed` 樣式）+ 永遠顯示的 SPEC §8.3 framing paragraph + 動態 status block + 8 種 region 標籤 + dominantRegion 共識挑選 + 4 種 severity（ok / warn / fail / info）+ caption 化簡（health 後綴與 sym 後綴拿掉，panel 接手）+ health-panel layer toggle 啟用（default ON per §6）+ 19 個新 headless 測試（61 總）。

實作中做出的決定與踩到的點：

- **Caption 與 panel 分工**：Caption 回答「這層在畫什麼」（layout kind + counts + sliver-merged 註記），Panel 回答「這個 layout 表現如何」（severity 訊息、不對稱警示、教育性 framing）。caption 永遠跟著 triangulation toggle 一起在 layers panel 下方；panel 自己一個獨立浮動元件、靠 health-panel toggle 控制可見性。兩者互補，不重複資訊。
- **Region 決策樹的優先順序**：先看 z（upper / lower hemisphere），再看 y（front / rear），再看 x（right / left side），最後 fallback 到 centerline（|x| < 0.3）或 surround ring（|z| < 0.3）。**為什麼 z 優先**：3D layout 最常見的 health 失敗模式是「沒蓋到頂點 / 底點」（zenith / nadir 缺洞），這類 phantom-speaker 的補洞決策都依賴垂直軸的 region 識別正確；front/rear 次之，left/right 因為通常是對稱錯誤（symmetry 後綴覆蓋）所以排第三優先級。
- **8 標籤的視覺含義**：upper / lower hemisphere（垂直主導）、front / rear（前後主導）、right / left side（左右主導）、centerline（接近 X=0 平面，垂直 / 前後不主導）、surround ring（接近 Z=0 平面，左右 / 前後不主導）。SPEC 列出的 8 個都覆蓋；fallback `the surround region` 只有在 6 條規則全不命中（罕見）才會出現。
- **dominantRegion 用 Map 自然順序當 tiebreaker**：多個 region 同票時，第一次出現的勝出（JavaScript Map 保留插入順序）。等於以三角形索引順序為準，避免每次重算時順序跳動讓使用者困惑。
- **Severity vocabulary**：`ok` / `warn` / `fail` / `info` → ✓ / ⚠ / ✗ / ℹ icon + 對應 CSS 顏色框。**Symmetry red 用 'fail' 級**但 SPEC §8.3 的 icon 是 ⚠（不是 ✗）：SPEC 的觀點是「對稱程度由 Δ 數值傳達」，icon 維持單一 ⚠；我尊重 SPEC，所以 symmetry 行的文字是 `⚠ Layout is asymmetric ...`，但 CSS 框配色是 fail（紅）— 訊息嚴重度 + 視覺顏色標準，icon 是 SPEC 既定。
- **Pluralization 用真複數而非 SPEC 的 `(s)` 簡寫**：SPEC §8.3 寫 `N suspect triangle(s) detected`，code 改寫成 `1 suspect triangle` / `3 suspect triangles`。SPEC 的 `(s)` 是文件 shorthand；實際 UI 該用正規語法。
- **Synthetic test technique**：composeHealthLines 用合成的 result object（不經過 analyseTriangulation）測。原因是「all green」layout 在 M3.E 時很難用真實座標構造（icosahedron 12 頂點面 max angle 72° 仍超過 70° 黃門檻；要 geodesic 二級細分才能全綠）。合成 result 直接驗證 line composition 邏輯，與上游 pipeline 解耦。
- **Caption 期待值兩個測試更新**：`regular-tetra-status` 和 `left-heavy-status-suffix` 原本檢 caption 含 `· N✗ · sym Δ=...` 後綴；M3.E 把這些搬走後 caption 變單純，測試改成檢 panel 的 composeHealthLines 輸出。

**遺留事項到 M3.F**：

- 三角形 hover tooltip（SPEC §9.3）：滑鼠停在某個三角形上時顯示「最大內角 + 球面面積 + 健康度」。需要：(1) 三角形射線拾取（pointer ray vs hull face）、(2) tooltip DOM 元素跟著滑鼠移動、(3) 從現成 metrics 拉 area / maxAngle / level。
- 「圖層 toggle 啟用」原本列在 M3.F；M3.A 啟用了 phantom toggle、M3.B-α 啟用 triangulation、M3.E 啟用 health-panel，M3.F 範圍因此縮減成只剩 hover tooltip。
- Speaker hover highlight（SPEC §9.3 末段「hover 某顆音響：highlight + 顯示其資料摘要」）：列入 M3.F 看時間。

**M3.F 收尾備註**

落地內容：三角形 hover tooltip（5 行：max angle、area + 中位數比例、health level、region、vertex names）+ pointInTriangle + pickTriangle（screen-space 投影 + 深度 tiebreak）+ 可見性 gate（layer off / kind 非 ok / pointer 在 panel 上 / 拖曳 orbit 中）+ TOOLTIP.lastIdx 快取避免重複 DOM 寫入 + 7 個新測試（68 總）+ 兩個 layout 修正（vertices 行標籤上下排列、Layout Health panel 移開右欄）。

實作中做出的決定與踩到的點：

- **screen-space 拾取而非 3D 射線**：`pointInTriangle` 接受 mouse(mx,my) 與三角形三個 screen-pixel 頂點，做 signed-area 測試（winding-agnostic）。每個 face 三個世界座標頂點先過 `projectToScreen`（既有 helper，用 cam.cameraMatrix × cam.projMatrix 手動投影），再點測試。比 3D 射線拾取簡單很多、且與 triangulation 渲染同一 projection 機制完全一致——不會有「我看到的三角形與工具拾取的三角形不一致」的詭異 bug。
- **深度 tiebreak 用 camera 到重心的世界距離**：多個三角形重疊時取距離 `cam.eyeX/Y/Z` 最近的（重心，不是頂點）。p5 Camera 的 `eyeX/eyeY/eyeZ` 是動態追蹤 orbitControl 的 — 拖完視角後立即可用、不必快取。
- **TOOLTIP.lastIdx 快取，跨三角形才重寫 DOM**：滑鼠在同一三角形內連續移動時，只更新 left/top（位置），不重寫 5 行文字。為了讓快取在 layout 變動時失效，`ensureTriangulationFresh` 一併把 `TOOLTIP.lastIdx = -1`。typeof guard 是因為 dev tests 跑 analyseTriangulation 時也會走這條路，那時 TOOLTIP 物件還沒定義（剛 require 的 module）。
- **拖曳期間隱藏**：若 `mouseIsPressed && !_dragStartedOnPanel`（= canvas 上正在拖曳 orbit），tooltip 直接隱藏。拾取在 camera 變動中沒有意義、且會跟著閃爍。
- **Vertices 行標籤上 + 內容下 + 右對齊**：原本 5 行都是 label-左 value-右 兩欄，但 vertices 在 3 個 speaker 名時就會在窄欄被斷行（user 截圖確認）。改成 vertices 那一行 flex column、label 在上獨佔一行、3 個名字下方一整行**右對齊**（user 確認對齊比左對齊整齊，與上面 4 行 value 共線）。
- **Layout Health panel 從 right:1rem 移到 right:calc(260px + 2rem)**：原位置會蓋到 phantom panel（user 截圖確認）。新位置避開 right-column 整塊，恰好坐在中央偏右的 bottom 區域，與 audience-panel（bottom-left）平衡。對 ≥1024px 寬度安全；< 1024px 由 mobile banner 警告涵蓋（M5 處理）。
- **Layer toggle off → 主動隱藏**：toggle 三角化 layer off 時不能等下一次 mousemove 才把 tooltip 隱掉（畫面已沒三角形可指）；toggle handler 直接 `el.hidden = true; TOOLTIP.lastIdx = -1`。

**遺留事項到 M3.G**：

- M3.G 是 ROADMAP M3 視覺檢核清單（7 條）的一次性整合 pass。多數條目 M3.A-F 中已被驗過；M3.G 動工時可順手加 SPEC §9.3 末段「speaker hover highlight + 資料摘要」（hover 一顆音響時 highlight + 顯示其 yaw/pitch/angles 概要 tooltip）—— 與三角形 tooltip 同套 picking 框架，可重用。
- 視 onboarding 觀感再決定要不要做：(1) 預設 LCR 是否重排（discussion item 12，至今未決）、(2) panel 在 < 1024px 的 layout 衝突（M5 mobile banner 完整實作前還會碰）。

**M3.G 收尾備註**

落地內容：speaker hover tooltip（name header + Position / Orientation / Spread / Distance 4 行）+ pickSpeaker（pixel 距離 + 世界距離 tiebreak）+ 3D highlight（hover 中音響球從 slate-navy 提亮到 soft sky）+ unified hover handler（speaker 優先於 triangle）+ tooltip CSS 抽 `.tooltip` 共用 + planar 偵測重做（great circle + small circle 都進 'planar' 分支）+ hull-open kind 退成 defensive code + 7 條視覺檢核 walkthrough 驗收。

**Speaker hover 實作決定**：

- **Picking 用螢幕像素距離（28 px tol）+ 世界距離 tiebreak**：speaker 球體在 world-space 是 sphere(26)，但投影到螢幕的半徑會隨 camera 距離變動。固定像素 tolerance 比動態算半徑簡單，28 px 在預設 perspective zoom 下對應大約 sphere(26) 的可見半徑略寬，重疊 5.1 / 7.1 spacing 下不會誤拾鄰居。世界距離（cam.eyeX/Y/Z 到 speaker 位置）做深度 tiebreak — speaker bodies 是 always-on-top 渲染，但拾取仍以「最靠近觀察者」為前景。
- **Speaker 拾取優先於 triangle**：當滑鼠同時在 speaker 球體和某個三角形上，speaker tooltip 顯示、triangle tooltip 隱藏。Speaker 是更具體的編輯單位，使用者通常 hover speaker 是想看 / 編 那顆，hover 三角形是想看健康診斷。
- **Highlight color**：原本 `(110, 122, 150)` slate-navy → hover 時 `(180, 200, 240)` soft sky。同 hue family，僅 lightness 提升。配合 directional light 的 shading 仍然清楚可辨「這就是 tooltip 描述的那顆」。
- **Speaker tooltip 邊框配速度顏色**：`#speaker-tooltip` 左邊框 `rgba(110, 122, 150, 0.85)` —— 與 speaker body 同色號，讓「tooltip 屬於我正在看的那顆 speaker」這層意思從顏色就讀得出來。Triangle tooltip 的左邊框依 health level 變色，speaker tooltip 不變色（speaker 本身沒有 level）。

**Planar 偵測重做**：

原本的 'planar' 偵測用 `a × b` 取兩個 unit vector 的叉積，只能偵測 origin-coplanar（great circle，all directions on a plane through listener）。對於現實世界最常見的「全部 cabinets 同高且高於 / 低於耳朵」情境（small circle of latitude），原偵測判為 NOT planar → 進 buildSphericalHull → seedTetrahedron 4-stage |det| 失敗（4 個 affine-coplanar 點 det=0）→ fallback 到 'collinear' 標籤（誤導）。

**改寫**：plane normal 用 edge cross `(b - a) × (c - a)`（O(N³) triple loop），對 affine-coplanar 也成立。共面測試從 `|p · n| < eps` 改成 `|p · n - p0 · n| < eps`（reference projection），great circle (d0 ≈ 0) 與 small circle (d0 ≠ 0) 都進同一個 'planar' 分支。Tangent basis 在 sort by azimuth 時減去 `d0 · n` 分量，兩種情況通用。

**意義**：使用者把 4 顆 cabinet 擺在 z=180cm（耳上、朝下打、製造朝下飽滿度）— 這是現實劇場最常見 layout — 工具現在會正確識別為「2D ring」並繪製，不會誤報為「無法三角化」。`hull-open` kind 從之前的初步 fix 退成純 defensive fallback（典型流程已不會打到）。

**視覺檢核 walkthrough 中發現 / 確認的事項**：

- **對稱是球面弧度，不是物理距離**：把 +X speaker 從 1000 推到 2000（沿 X 軸），symmetry Δ 仍 0（方向相同）。SPEC §8.1 step 5 明寫「球面弧度」，所以這是正確語意——VBAP panning topology 看的是方向不是距離。但這對 onboarding 訊息可能違反直覺；若 M5 onboarding 測試時使用者反映困惑，可考慮加說明文字。
- **矩形 4 角 + listening centre 在對稱軸上 永遠是 planar**：4 個矩形 corners 的方向向量總是落在同一個 affine 平面（幾何恆等式，不論各角 z 不同）。要做 mirror-symmetric 3D layout 測試，必須加第 5 個 on-axis phantom 打破矩形 → 5 點才會進 'ok'。對這個事實的內化讓 #5 視覺檢核從 4-pt 改成 5-pt。
- **`'the surround region'` 是 fallback 標籤的常客**：region 偵測門檻 z>0.7 / |x|<0.3 等對許多典型 layout 的三角形重心都「不夠強烈」，落到 catch-all。屬於 SPEC §8.2 / discussion item 2 的校準工作（M5 上線前），M3.G 不動。
- **#2 的 "缺一個方向" 比 "推遠一個方向" 更能展示 region**：octahedron 缺 -Y 頂點 → 後方有大洞 → 三角形重心明顯偏向 upper hemisphere（缺一個底部支撐 → 上半球三角形變稀疏並紅）。這是 discussion item 12 預設 layout 設計時可參考的 onboarding 教學素材。

**M3 全程小結**：

A 資料模型 + UI / B 球面凸包（含 sliver merge）/ C per-triangle metrics + 著色（顏色從 E 拉前）/ D 對稱偏差 + bulk paste + distance-delay 兩個 dev affordance / E Layout Health panel + region 偵測 / F triangle hover tooltip + layout 修正 / G speaker hover + planar 重做 + 視覺驗收。共 7 個 commits，68 → 71 → 71 個 headless tests（M3.G 沒新增 case，但驗證了所有 既有 case 仍綠）。

**M5 校準清單（discussion item 2）累積到此的所有未完門檻**：

- 三角形最大內角：黃 > 70° / 紅 > 90°（hardcoded）
- 三角形面積比：黃 > 1.5× 中位數 / 紅 > 2.5× 中位數
- L/R 對稱性偏差：黃 > 0.05 / 紅 > 0.15 rad
- Region 決策樹門檻：z 主導 0.7 / centerline |x| < 0.3 / surround ring |z| < 0.3
- 隨機 50 點 sphere 測試的 health 分布（3 綠 / 30 黃 / 61 紅 of 94）顯示門檻偏緊；正常使用情境下還可接受，但需要 M5 用真實 layout 校準。



**M3.B 拆解（next session 起點，先討論再動手）**

選型已鎖定：自寫 incremental spherical convex hull（不引 npm，§17）。實作中 4 個吃時間點：

1. **Degenerate cases 檢測**
    - `N < 4 enabled point` → 球面三角剖分需至少 4 個非共面點
    - 全部 coplanar（例如所有 speaker 同高度） → 投影到球面後落在同一大圓
    - 兩點同方向（例如 speaker 與 phantom 在同一條 origin→point 方向上） → projection 重合
    - 點正好在 origin（方向 0，無法 normalize）
    - 每種要：epsilon-aware 檢測 + 明確 UI 訊息（不能崩、不能默默回空）

2. **數值穩定性（orientation test 邊界）**
    - 3×3 行列式符號決定 P 在 ABC 面哪一側；P 幾乎在面上時符號可能浮點誤差翻轉 → horizon walk 崩
    - 防禦：epsilon 一致（unit vector 規範化後 1e-9 ~ 1e-7）+ 邊界返回 0 時固定走某一分支

3. **Sliver triangle 的「誰的鍋」問題**（這題是設計，不是演算法）
    - 兩顆 speaker 幾近同方向 → hull 必生極瘦三角形 → M3.C 標紅
    - 但紅不是 layout 缺陷，而是輸入冗餘
    - **建議方案 A**：pre-merge 幾近重合的點，合成等效一顆進 hull，panel 標「N speakers merged for triangulation」
    - **動工前要先跟 owner 確認方案 A**

4. **Incremental algo 的 horizon walk**
    - 一致 outward normal（每三角形朝外、從 origin 看）；某面翻 → visibility 翻 → horizon 開放路徑
    - Horizon 必須單一閉迴路；epsilon 邊緣不一致會分裂成多段
    - **每次插入後 assert manifold 不變量**（每邊正好屬 2 三角形、所有面積總和 4π）——最關鍵的 debug 工具

**B 內部子任務 + 預估占比**

| | 工作 | 占比 |
|---|---|---|
| B.1 | normalize / orientation test / L'Huilier 球面面積 / 最大內角 helpers | 15% |
| B.2 | 退化檢測 + 明確錯誤回傳 | 15% |
| B.3 | 種子四面體（4 極端點，沿 x/y/z 軸找最遠） | 10% |
| B.4 | 主迴圈：visibility / horizon walk / 插入 new face | 30% |
| B.5 | Manifold validate assert | 5% |
| B.6 | Test cases（四面體 / 立方體 / 5.1 / coplanar / merge / 隨機 50 點） | 20% |
| B.7 | 視覺串接（triangle 邊線 + 半透明面 fill） | 5% |

**起點建議**：從 B.1 helpers 動手——純函式、各自可單獨測試、後續 B.2/B.3/B.4 全都會用到，cognitive ramp-up 平緩。B.1 收完直接接 B.2，這樣動到 B.4 主迴圈時所有「假設輸入合法」的前提都已被 B.2 過濾過。

**動到的檔案**

- `coverage/coverage.js`（新增 hull / health 模組）
- `coverage/coverage.css`（panel + tooltip）

**視覺檢核**

1. 4 顆音響圍成一個正方形 → 三角化應呈現正常（4 個三角形或合理切分）、health panel 全綠。
2. 故意把一顆音響挪到很偏的位置 → 出現黃 / 紅三角形，panel 顯示對應 region。
3. 在「黃 / 紅三角形」附近加一顆 phantom → 三角化即時 re-evaluate、警示降級或消失。
4. 故意做不對稱 layout（左 3 顆、右 1 顆）→ 對稱性警示出現，數值合理（< 0.5 rad）。
5. 鏡像對稱 layout → 對稱性警示消失。
6. Hover 任一三角形 → tooltip 顯示三項數值，數值與顏色一致（例如 90° 以上應為紅）。
7. 把所有音響高度設成同一個值（共面）→ panel 顯示「無法三角化」訊息，不 crash。

**收尾備註**

（完成後填寫）

---

## M4 — HTML 下載 / 上傳 + PNG 截圖

**範圍**

- 「Download as HTML」：
    - 序列化完整 State（§5.5）成 JSON
    - 組裝 self-contained HTML：p5.js 從 CDN 留外連、其他 JS / CSS inline、State 嵌入 `<script id="coverage-state" type="application/json">`
    - 檔頭 metadata HTML 註解（§10.2）
    - `<title>` = layoutName 或 `Sound Coverage Sketch — Untitled`
    - 觸發 download，檔名 `{layoutName}-coverage-sketch.html`
- 「Open from HTML」：FileReader → DOMParser → 找 `script#coverage-state` → 解析 → 驗證 `schemaVersion === 1` → load state；失敗顯示錯誤、不破壞當前 state
- 下載出的 HTML：固定英文、含完整編輯 UI、可再次下載
- 「Download as PNG」：擷取 canvas（顯示解析度 × 2）；檔名 `{layoutName}-coverage-{timestamp}.png`

**動到的檔案**

- `coverage/coverage.js`（新增 export / import 模組 + inline build 函式）
- `coverage/index.html`（download / open / png 按鈕）

**視覺檢核**

1. 編一個 layout（3 顆 speaker + 1 phantom + 觀眾席尺寸客製）→ Download as HTML。
2. 直接雙擊下載出的 HTML（離線、新瀏覽器分頁）→ 開啟後看到完全相同 layout、視角、圖層、單位。
3. 在下載出的檔案內加一顆音響、再下載 → 第二份檔案載入後 layout 包含新音響。
4. 把第二份 HTML 拖回工具的「Open from HTML」按鈕 → 工具進入該 layout。
5. 故意上傳一個亂寫的 HTML（沒有 `script#coverage-state`）→ 顯示錯誤訊息，當前 state 不變。
6. 故意改 schemaVersion = 999 上傳 → 顯示 schema 不符的訊息。
7. 下載出的 HTML 檔頭註解區塊存在、metadata 完整。
8. PNG 截圖打開後解析度是視窗的 2×、影像內容與當下 canvas 一致。

**收尾備註**

完成 2026-05-06，分成 A → C 三階段：

- **M4.A**（commit `4db4313`）—— Save PNG：composite WEBGL canvas + HTML overlay labels onto a 2× viewport scratch canvas via Canvas2D；panel UI / tooltip 不入鏡。需要 `setAttributes('preserveDrawingBuffer', true)` 否則 `drawImage(canvas)` 抓到空白。labels 用 `getBoundingClientRect()` 中心 + `getComputedStyle` 拿字型 / 顏色，halo 用 shadowBlur stamp 三次模擬 multi-layer text-shadow。
- **M4.B**（commit `d690ebe`）—— Save HTML：DOMParser clone 當前 document → 替換 `<link>` / `<script src=>` 成 inline → 注入 `script#coverage-state` JSON → 加 metadata HTML comment → trigger download。Boot loader IIFE 在 module top 執行，比 setup() 早把 STATE 換掉。踩過：state script **必須 insertBefore inline coverage.js**（inline script 沒 defer，parse 到就執行）；`document.documentElement.outerHTML` 會把 p5 動態加的 `<canvas>` 也存進去 → 必須 strip `#canvas-host`；file:// 上重存的 inline-tag fallback 已實作但被 hide 條件擋掉用不到，留著作為 single-source-of-truth；snapshot 模式（下載出的 HTML）hide Save HTML / Open HTML，file I/O 只屬於 live tool。
- **M4.C**（commit `638d3a6`）—— Open from HTML：FileReader → DOMParser → `script#coverage-state` → JSON.parse → `applyLoadedState()` → `syncUiFromState()`。錯誤分支各自 alert（找不到 state / 空 state / JSON 壞 / schemaVersion 不符）。`applyLoadedState` 的 schemaVersion guard 在所有 STATE 寫入之前 throw → 載失敗 STATE 一個 bit 都不動。loader 對未知欄位 silently drop，v1.1（如 floor plan）可加 optional 欄位不必 bump schema。

QA：8 項 visual checks 全過，包含 round-trip / 錯誤分支 / 空 layoutName / 重複選同檔 / snapshot mode 隱藏。

未解：朋友 Chrome 開檔顯示異常（Safari / Edge OK），等朋友 console 輸出回來再 reproduce；不擋 M5 啟動。

---

## M5 — i18n / mobile banner / landing / meta / 公開化

**範圍**

- i18n（§12）：`I18N` 物件 + `t('key')` helper、預設語言依 `navigator.language`、切換按鈕固定右上角、`localStorage` 持久化（key: `zcreation-tools-lang`，try/catch）
- 下載出的 HTML：固定英文（去掉 lang switch 按鈕）
- Mobile banner（§13）：< 1024px 顯示、可手動收起、reload 後再出現、不重排 layout
- Landing page (`/index.html`) 正式化：簡潔 header、工具卡片（先只有 coverage）、ZCreation 主站 footer 連結
- Meta（§15）：description 中英、OG preview（用工具預設視角截圖）、sitemap.xml 含 `/coverage`
- robots.txt：允許全部、無 noindex
- **M5.E — 公開化收尾**（launch day 當天最後做）：
    - `LICENSE`（MIT，三行）
    - `README.md` 改寫：對外說明 + 截圖 + 連結（live tool / GitHub / ZCreation 主站）；保留現有的開發 notes 但分到「Development」段落
    - landing page 加 GitHub link（footer 或工具卡片旁的 icon）
    - GitHub repo visibility：private → public
    - Git tag：`v1.0.0`
    - 注意：`SPEC.md` / `CLAUDE.md` / `ROADMAP.md` 都**留著**，作為「AI-assisted 開發過程透明化」的一部分

**動到的檔案**

- `coverage/coverage.js`（i18n module）
- `coverage/index.html` + `coverage/coverage.css`
- `index.html`（landing 改寫）
- `sitemap.xml`、`robots.txt`、各 HTML 的 `<head>` meta tags
- `LICENSE`、`README.md`（M5.E）

**視覺檢核**

1. 第一次造訪（清 localStorage）：瀏覽器中文設定 → 顯示中文 UI；英文設定 → 英文 UI。
2. 切換語言按鈕 → 所有 UI 字串切換、§2 定位語句切換（中英兩版都完整）；reload 後仍是上次選擇。
3. Resize < 1024px → banner 出現；點 ✕ 收起；reload 後再出現。
4. Landing page 簡潔好讀，連到 `/coverage` 正常、GitHub link 點得開。
5. View source → meta description / OG / canonical 正確。
6. 用 Twitter / Facebook 的 OG debugger（或本機檢查 `<meta property="og:*">`）確認預覽圖正確。
7. M5.E 後：repo 在無痕視窗能存取（已 public）、`v1.0.0` tag 出現在 GitHub releases 頁。

**收尾備註**

（完成後填寫）

---

## v1.1 Backlog（v1 上線後回頭做）

beta 期間或 launch 後若有人提出再評估，不擋 v1。

- **舞台平面圖上傳**（§見對話 2026-05-05）：把建築圖貼到地板 texture。需要比例尺校正（點兩點 + 輸入實際距離）、位置 / 旋轉 handle、self-contained HTML 是否 base64 嵌圖（會肥很多）。schema 不必預留欄位，因為 M4.C loader 已對未知欄位 silently drop（forward-compat 已就緒）。
- **教學 / 使用示範影片**（YT）：v1.0 + 7 月 workshop 之後再錄；需要工具 UI / 文案先穩定一輪。錄完放到 landing page 工具卡片的「demo」按鈕。
- **CHANGELOG.md**：第一次發 v1.1 patch 時開檔，回填 v1.0.0 → v1.1.0 之間的 user-facing 變化。v1 之前不必。

---

## 討論事項 / 已知問題

### 1. p5.js WEBGL 座標 handedness（**M1 結束時已用單一機制重做，2026-05-05**）

**最終解法**：在 `applyCamera()` 中、呼叫 `perspective()` 之前設一次 `cam.yScale = -1`。

**為什麼這就夠**：閱讀 p5 v1.11 原始碼後確認，`p5.Camera.prototype._getLocalAxes()` 是**標準右手系**（`x = up × z`、`y = z × x`）；handedness 問題的單一來源是 `perspective()` 在投影矩陣 Y row 寫死 `-f * yScale`（投影層的 Y-flip）。把 yScale 設成 -1 就抵銷掉這個 flip，整個 pipeline 就是標準右手座標系，所有視角的 up vector 都用自然值（perspective / front / side / listening 用 +Z，top 用 +Y），不再需要任何 per-view 補償。

**早期試過、已捨棄的雙重 hack**（保留為紀錄）：

- 早期 M1：`up.z` 取負（mode (a)）+ top view `scale(1, -1, 1)`（mode (b) 縮小版）。
- 問題：兩個機制針對不同視角各自運作，邏輯不一致；top view 拖曳 orbit 後 scale flip 仍會套用，畫面方向感會跑掉。
- 改用 yScale 後上述問題全部消失。

**`projectToScreen()` 對應變更**：`projMatrix.mat4` 自動反映新的 yScale，所以原本 `(1 - cy/cw) * height / 2` 的公式繼續有效；移除 top-view 專屬的 `y → -y` 修正（不需要了）。

**踩到的坑（M1 過程紀錄，仍適用）**：

1. **`createCamera()` 會切換 camera 類型**：在 `setup()` 用 `createCamera()` 取得 camera 參考會把 camera 切成 "custom" 類型，導致 `orbitControl()` 的滑鼠拖曳被禁用（只有 default camera 路徑會處理 drag）。正確做法：用 `camera()` 全域函式設定參數（套用在 default camera 上），再以 `cam = _renderer._curCamera` 抓 reference 給後續 zoom / 投影使用。
2. **`setAttributes()` 必須在 `createCanvas()` 之前**：`setAttributes()` 在 createCanvas 之後呼叫會**重建 WEBGL renderer 與 canvas DOM 元素**——前面 `c.parent('canvas-host')` 綁的是舊 canvas，新 canvas 變成 body 的直接子元素，舊 canvas 上的事件 listener 全部失效，`orbitControl` 拖曳直接無作用。正確順序：`setAttributes()` → `createCanvas()` → `c.parent()` → 抓 cam reference → 設定 `cam.yScale = -1` → `applyCamera()`（內部呼叫 `perspective()` 才會吃到新的 yScale）。
3. **lighting 的 fill 不能太暗**：`fill(30, 35, 55)` 加上 ambient/directional 後，最亮也只到 `~(60, 70, 95)`，視覺上是黑的——shading 有發生但落在「都是黑」的範圍。實務上 fill 至少要在 `(80, 80, 80)` 以上 shading 才看得到。M1 把 speaker fill 提到 `(110, 122, 150)`，原點地標從 `40` 提到 `110`。

### 2. L/R 對稱性偏差門檻（§8.2）

v1 開發中先用估算（黃 > 0.05 rad、紅 > 0.15 rad），M3 完成後拿幾組真實 layout 校準，**M5 上線前定案**。

### 3. Phantom speaker 數量上限（§18）

v1 暫不設限，M3 觀察使用情況再決定。

### 4. 工具最終命名（§10、§18）

`Sound Coverage Sketch` 為候選，**M5 上線前確認**。命名一變，§10 下載 HTML 的 `<title>` 與檔名也要連動改。

### 5. 第一屏定位語句呈現方式（§2）

spec 寫「完整、可見地呈現於工具首頁第一屏」。是要做成「永遠可見的固定區塊」還是「首次造訪 modal、之後折疊」？傾向**永遠可見、可折疊但預設展開**，避免使用者誤以為工具能做它做不到的事。M1 先永遠可見，M5 加折疊細節。

### 6. Cone 在 pitch ±90° 附近的 label / geometry 退化

極端 pitch 時 cone 邊界與 label 可能重疊或退化。M1 不處理，視 M2 / M3 用起來的觀感再決定。

### 7. p5.js WEBGL `text()` 不可用（M1 已繞過）

**現象**：p5.js WEBGL 模式下 `text()` 預設 bitmap font 不會渲染；需要 `loadFont()` 載入 TTF/OTF。M1 軸標籤完全消失。

**M1 解法**：所有文字標籤改用 HTML overlay span，每幀以 `screenX/screenY` 投影到 canvas pixel coords、`position: fixed` 對齊。實作位置：`coverage.js` 的 `updateLabels()` / `positionLabel()`，HTML 端是 `#overlay-labels` 容器。

**優點**：解析度永遠清晰、無 WEBGL renderer 限制、無外部字檔。
**代價**：標籤是 2D，永遠面向螢幕、不會被 3D 物體遮擋（這對標籤通常是正確行為）。

**M4 影響**：下載出的 self-contained HTML 沿用同一套 overlay 機制，無外部字檔依賴。

### 8. Cone 視覺：矩形角錐 + 移除側面實心填色（M1 決定）

**現象**：cone 4 個側面以 alpha 32 半透明填色仍會視覺上遮蔽 sphere（depth write + 多重透明面疊加）。

**M1 解法**：

- 拿掉側面填色、只保留 4 條邊射線 + 底端輪廓 + 底端極淡填色（alpha 18）。
- Sphere 半徑加大到 26、永遠 on top（item 9）；邊射線不再需要從 apex 外推。
- Cone length 從 600 → 400 cm，避免在密集 layout 中視覺壓制其他元素。

**幾何修正（2026-05-05）**：原本的 `coneCornerDirs()` 用「yaw ± halfH、pitch ± halfV」的球面座標獨立偏移算 4 角，**當 pitch ≠ 0 時會產生梯形** ——上下緯度圈半徑不同（cos 因子），上邊比下邊寬。改為**矩形角錐**：

- `speakerBasis(yaw, pitch)` 算出 forward / right / up（用 forward × world-up 求 right）
- 4 角放在垂直於 forward 的平面上：`base + ±tan(halfH) × length × right + ±tan(halfV) × length × up`
- 基底永遠是真矩形

**對 SPEC §7.2 的影響**：SPEC 原本定義 coverage 為「水平 / 垂直軸向角度偏移分別 ≤ halfH / halfV」（球面判定，會產生梯形覆蓋區）。M2 實作 coverage 時應與這個視覺對齊，改為矩形角錐判定：

- 計算 `P - speaker` 在 forward / right / up 上的投影分量
- 條件：`|right_proj / forward_proj| ≤ tan(halfH)` 且 `|up_proj / forward_proj| ≤ tan(halfV)` 且 `forward_proj > 0`

M2 動工時要把 SPEC §7.2 同步更新。

**對 SPEC §6「半透明錐」的詮釋**：以邊界線 + 底端淡色傳達「半透明 envelope」，而非實心半透明面。

### 9. Speaker bodies 為 always-on-top 位置標記（M1 決定）

**問題**：在多聲道 layout 中，cone 重疊或從前方視角看時，3D 球體仍可能被遮擋，影響「指出音響在哪」這個工具核心目的。

**M1 解法**：speaker bodies 在 `drawScene()` 拆出獨立 pass，畫前 `gl.disable(gl.DEPTH_TEST)` 畫後再 enable，所以無論深度都浮在最上層。等同於把 speaker 當成 3D 標記而非真正的 3D 物件——這和 HTML overlay labels 的「永遠可見」邏輯一致。

**取捨**：失去「哪顆音響在哪顆前面」的深度線索，但工具不需要這個資訊；換來編輯時的可靠定位與視覺穩定性。

**M3 影響**：phantom speaker 點按相同模式處理（disable depth test 的同一 pass）。

### 10. Listening centre 視覺化（M1 決定）

**問題**：SPEC §4 寫「原點 (0, 0, 0) = 假想聽覺中心」，但實作中世界原點落在地板（speaker Z 從這裡量），「假想聽覺中心」其實在 `(0, 0, listeningHeight)`。SPEC 文字不夠精準，但程式 / 資料模型若把 listening centre 也放在原點會與既有 `listeningHeight` 欄位互斥，反而不直覺。

**M1 解法**：把 `(0, 0, 0)` 詮釋為「聽覺中心在地板的投影」，把 `(0, 0, listeningHeight)` 詮釋為「假想耳朵位置」，兩個都畫出來——

- 原點：地面格線中心一顆 fill(110) 小球（半徑 7）。
- 聽覺中心：teal `(40, 150, 150)` 小球（半徑 11，深度測試 OFF），加上一條從原點往上的 dashed teal 細線。

兩者皆有獨立的 layer toggle，coords layer 開啟時兩者都會帶座標標籤。

**對 SPEC §4.1 的影響**：SPEC 措辭應改為「原點 (0, 0, 0) = 假想聽覺中心**在地板的投影**」以對齊實作（已在 SPEC.md 同步更新）。

### 11. Panel-vs-canvas 事件隔離（M1 決定）

**問題**：浮動 function panel（右側 view / layers / speakers、左下 audience、左上 meta、頂部 disclaimer）和 canvas 重疊。p5 把 mouse / wheel listener 掛在 `window`，所以即使滑鼠在 panel 上滾動或拖曳，p5 仍會收到 → 3D 視圖被誤動。

**M1 解法**：在 `document` 的 bubbling phase 攔截 `mousedown` / `wheel`，若 `event.target.closest('.panel, #disclaimer, #mobile-banner, #overlay-labels')` 命中就 `stopPropagation()`。bubble path 是 target → ... → document → window，攔在 document 等於擋在 p5 收事件之前，但 panel 自己的 default scroll / click 不受影響。

**`mouseup` 故意不攔**：避免「從 canvas 起拖、在 panel 放開」時 p5 的 `mouseIsPressed` 卡住。

**`draw()` 中的 orbit 守門**：`allowCanvasInteraction()` 判斷拖曳起點是否在 panel 上、目前 hover 是否在 panel 上，決定是否呼叫 `orbitControl()`。被攔下的 frame 同時把 `_renderer.zoomVelocity` 歸零，避免 wheel 慣性飄到 canvas 上才釋放。

### 12. 預設 LCR layout 是否要重排（v1 上線前決定）

**狀況**：M2 完成後 owner 觀察到自己很少用 LCR，但 LCR 仍是劇場聲音設計最廣的公約數，學生與多數工作者都熟。預設 layout 的職責是「首屏 5 秒把工具教完」而不是「貼近 owner 個人偏好」，目前 LCR + sweet-spot diamond + 前緣紅 dead-zone 視覺強烈，§2 Q1（聽覺中心是否被覆蓋）幾乎一秒讀懂；前緣紅又會誘發 first edit。

**選項**：

1. **保留現狀 LCR**（傾向）。
2. **微調 LCR**：把 L/R 從 `y=150`（在 audience 內、朝後瞄）移到 `y > +400`（audience 上邊界外、stage 側朝後瞄）。對齊一般 FOH「speaker 在 stage 側」的直覺，sweet-spot diamond 仍保留。教學損失最小。
3. **換成更 spectacular 的環繞 layout**（5.1 / 7.1）。能秀工具能力但首屏訊息變雜，offset onboarding 教學效果。

**M5 上線前定案**。屆時會用幾組真實 layout 跑過、看 onboarding 觀感再決定。

---

**最後更新**：2026-05-05（M3 全部完成：A → G 七階段；71 headless tests；M4 待續）
