# Sound Coverage Sketch — v1 設計規格 / v1 Design Specification

> 此文件是 `coverage` 工具 v1 的**單一真實來源 / Single Source of Truth**。
> 任何在實作中發現需要修改的細節，請更新此文件。

---

## 1. 專案資訊 / Project Info

- **工具名稱 / Tool name**：Sound Coverage Sketch
- **URL**：`tools.zcreation.art/coverage`
- **目標使用者 / Target users**：聲音設計師（劇場、現場、多聲道創作者；含學生與獨立工作者）

---

## 2. 定位語句（首頁顯著呈現）/ Positioning Statement (Prominent on Landing)

**中文版**

> **這是幾何瞄準與覆蓋草圖工具。**
>
> 它使用使用者輸入的擴音張角作為高頻覆蓋的近似值，並提供基於 Pulkki VBAP 凸包三角剖分的 layout 健康度提示。
>
> 它**不取代聲學模擬**，**不預測 SPL、頻率響應、反射、相位**，**不模擬任何 renderer 行為**。
> 它只回答兩種問題：
> 1. 「我假想中的聽覺中心，有沒有被我擺的音響覆蓋到？」
> 2. 「從幾何上看，我的多聲道 layout 對 VBAP 系列 panner 是否健康？」
>
> 聽覺判斷以你實際的 renderer 與耳朵為準。

**English version**

> **This is a geometric aiming & coverage sketch tool.**
>
> It uses your speaker dispersion angles as an approximation of high-frequency coverage, and provides layout-health hints based on Pulkki-VBAP convex-hull triangulation.
>
> **It does not replace acoustic simulation. It does not predict SPL, frequency response, reflections, or phase. It does not model any renderer's behaviour.**
> It only answers two questions:
> 1. "Is my imagined listening centre actually covered by the speakers I've placed?"
> 2. "Geometrically, is my multichannel layout healthy for VBAP-family panners?"
>
> Auditory judgement still belongs to your renderer and your ears.

此段話必須**完整、可見**地呈現於工具首頁第一屏與下載出 HTML 檔的開頭，中英版本同步。
不要為了視覺優雅而省略其中任何一句。

---

## 3. 核心原則 / Core Principles

1. **聽覺中心優先 / Listening-centre first**：「假想的聽覺中心 (imaginary listening centre)」永遠是「世界座標原點 (0, 0, 0) 加上聽覺高度」（可能是站、坐姿耳高），所有資料、視角、計算以此為錨。沒有「場館建模」概念。
2. **可攜性優先 / Portability first**：使用者可隨時下載一份自我完備（self-contained）的 HTML 檔，內含目前 layout，可獨立開啟、可上傳回工具繼續編輯。
3. **誠實優先 / Honesty first**：工具明確告知它「能」與「不能」告訴使用者的事。任何可能誤導的視覺、文字、警示都必須加上限制條款。
4. **桌面優先 / Desktop first**：`< 1024px` 顯示提示 banner，但不阻擋。

---

## 4. 座標系統與單位 / Coordinate System & Units

### 4.1 世界座標 / World Coordinates

- `x` = 左 / 右（朝右為正）
- `y` = 前 / 後（朝舞台 / 觀眾正前方為正）
- `z` = 上 / 下（朝上為正）
- 右手座標系 (right-handed)：`+X × +Y = +Z`（從觀眾席往舞台看，右手 = +X、上舞台 = +Y、頭頂 = +Z）
- 原點 `(0, 0, 0)` = **假想聽覺中心在地板的投影**（始終，不可移動）
- 假想聽覺中心本身位於 `(0, 0, listeningHeight)`（耳朵高度），是 `aimAtCentre` 的瞄準目標

### 4.2 單位 / Units

- `cm` 與 `m` 切換（UI 提供 toggle）
- 所有顯示數值即時轉換（不重算內部資料；內部統一以 `cm` 儲存）
- 預設單位：`cm`

---

## 5. 資料模型 / Data Model

### 5.1 Speaker

```ts
{
  id: string,           // UUID 或自增 ID
  name: string,         // 使用者命名（預設 "Speaker N"）
  x: number,            // cm
  y: number,            // cm
  z: number,            // cm
  yaw: number,          // degrees, 0 = 朝 +Y, 順時針為正（俯視時）
  pitch: number,        // degrees, 0 = 水平, 抬頭為正
  angleH: number,       // degrees, 水平張角（總角，非半角）
  angleV: number,       // degrees, 垂直張角（總角，非半角）
  enabled: boolean      // 是否參與計算（可暫時關閉某顆音響）
}
```

> 不對稱張角支援：`angleH` 與 `angleV` 各自獨立。

### 5.2 Phantom Speaker

```ts
{
  id: string,
  name: string,         // 預設 "Phantom N"
  x: number, y: number, z: number,
  // phantom 不需要 yaw/pitch/angle，因為它只參與三角剖分，不投射 cone
}
```

### 5.3 Audience

```ts
{
  length: number,       // X 軸方向長度（cm）
  width: number,        // Y 軸方向寬度（cm）
  listeningHeight: number  // 聽覺平面高度（cm，相對地面 z=0）
}
```

> 觀眾席矩形以 `(0, 0, 0)` 在 X-Y 平面的投影為中心。

### 5.4 ViewState

```ts
{
  unit: 'cm' | 'm',
  layoutName: string,
  layers: { [layerName: string]: boolean },  // 每個視圖層的 toggle 狀態
  cameraPreset: 'perspective' | 'top' | 'front' | 'side' | 'listening'
}
```

### 5.5 完整 State（用於下載 / 上傳）/ Full State (for Save & Open)

```ts
{
  schemaVersion: 1,
  metadata: {
    layoutName: string,
    createdAt: string,    // ISO 8601
    sourceUrl: 'https://tools.zcreation.art/coverage',
    toolVersion: string   // 工具版本，例如 "1.0.0"
  },
  audience: Audience,
  speakers: Speaker[],
  phantoms: PhantomSpeaker[],
  view: ViewState
}
```

---

## 6. v1 視圖層（皆可獨立 toggle，預設值見括號）/ v1 View Layers (each toggleable, default in parentheses)

| Layer key | 內容 / Description | 預設 / Default |
| --- | --- | --- |
| `floor` | 地面格線 + 原點小球標記 | ON |
| `audience` | 觀眾席矩形（半透明） | ON |
| `listening-plane` | 聽覺平面（半透明懸浮層） | ON |
| `listening-centre` | 聽覺中心 teal 球（在 `(0, 0, listeningHeight)`）+ 從原點往上的細虛線 | ON |
| `coverage-heat` | 聽覺平面上的覆蓋熱區（gradient color） | ON |
| `speakers` | 音響本體（球體 + label） | ON |
| `cones` | 音響張角錐（4 條邊射線 + 底端輪廓 + 極淡底色） | ON |
| `coords` | 各 speaker / 原點 / 聽覺中心的 `(x, y, z)` 文字標籤 | OFF |
| `triangulation` | 凸包三角剖分（每個三角形依健康度著色） | OFF |
| `phantoms` | phantom speaker 點（虛線、半透明） | ON（若有） |
| `health-panel` | Layout Health 文字摘要（floating panel） | ON |
| `axes` | X/Y/Z 三色座標軸（紅綠藍） | ON |

---

## 7. 覆蓋熱區計算 / Coverage Heatmap Computation

### 7.1 計算位置 / Sample Positions

- 計算於**聽覺平面 (listening plane)**：`(x, y) ∈ [-length/2, length/2] × [-width/2, width/2]`，`z = listeningHeight`
- Grid sampling：建議 grid 解析度 = 兩軸各 50–100 點（視效能調整）

### 7.2 「被涵蓋」的判定（矩形角錐版，與 cone 視覺一致）/ Coverage Test (Rectangular-Pyramid Cone, Consistent with Visual)

對每個 grid point `P`，對每顆 enabled speaker `S`：

1. 取 speaker 本地基底 `(forward, right, up)` = `speakerBasis(yaw, pitch)`，其中 `right = forward × world-up`、`up = right × forward`。
2. 計算 `d = P - S`，並投影到三個基底軸：
    - `f_proj = d · forward`
    - `r_proj = d · right`
    - `u_proj = d · up`
3. 條件全部成立才算被涵蓋：
    - `f_proj > 0`（在 speaker 前方）
    - `|r_proj / f_proj| ≤ tan(angleH / 2)`
    - `|u_proj / f_proj| ≤ tan(angleV / 2)`

> **備註 / Rationale**：判定使用矩形角錐（rectangular pyramid）而非球面角度偏移（`atan2` 算 θ_h / θ_v 與 halfH / halfV 比較）。球面版本在 `pitch ≠ 0` 時會產生梯形覆蓋區（trapezoidal coverage，因為 cos 因子讓上下緯度圈半徑不同），與 cone 視覺不一致；矩形版本兩者完全對齊。

### 7.3 熱區著色（gradient）/ Heatmap Coloring (Gradient)

> **「涵蓋顆數」是幾何 overlap count，不是響度加總。** 距離 5 m 的 speaker 與 1 m 的 speaker 在熱區裡同等計為一顆。每顆 speaker 的距離與傳播延遲顯示於 speaker list caption；SPL 推算需要 speaker 規格（靈敏度、最大 SPL、頻響）與場館聲學，**屬使用者判斷範圍**，工具不介入。
>
> **Coverage count is a geometric overlap, not a loudness sum.** A speaker 5 m away counts the same as one 1 m away in the heatmap. Per-speaker distance and propagation delay are shown in the speaker-list caption; SPL inference needs speaker specs (sensitivity, max SPL, frequency response) and venue acoustics — that's the **user's domain**, not the tool's.

| 涵蓋顆數 / Coverage count | 顏色 / Color |
| --- | --- |
| 0 | 紅（警告：黑洞 / dead zone） |
| 1 | 黃 |
| 2 | 橙偏綠 |
| 3+ | 綠（充足 / sufficient） |

實作建議：用 lookup table 或簡單函式映射。**所有顏色以半透明渲染**，不蓋掉地面格線。

---

## 8. Layout Health 系統 / Layout Health (Triangulation Diagnostic)

### 8.1 計算流程 / Computation Flow

1. 對所有 enabled speaker + phantom，計算其相對原點的方向向量
2. 投影到單位球面 (unit sphere)
3. 計算凸包 (convex hull) → 取得三角形列表
4. 對每個三角形計算：
    - 球面面積 (spherical area)（用三邊弧長 + 球面三角形公式或 L'Huilier theorem）
    - 最大內角 (largest interior angle)
5. 計算整體 L/R 對稱性偏差 (symmetry deviation)（將所有點對 X=0 平面鏡像，與原點集做最近鄰配對的平均距離；單位：球面弧度）

### 8.2 健康度判定（v1 hardcode）/ Health Thresholds (v1 hardcoded)

> **這些閾值是工具的幾何 panning 條件判斷，不對應任何 ITU / SMPTE / EBU 合規標準。** ITU 標準 layout（5.1、7.1、22.2 等）也可能觸發黃 / 紅警示——這代表 VBAP 在那個三角區會 ill-conditioned，與「該 layout 是否符合 ITU 規範」**無關**。
>
> **These thresholds are the tool's geometric panning-condition heuristics, not compliance checks against any ITU / SMPTE / EBU standard.** ITU-spec layouts (5.1, 7.1, 22.2, …) can still trigger warn / critical — meaning VBAP would be ill-conditioned in those triangles, **not** that the layout violates a standard.

| 指標 / Metric | 黃 / Warn | 紅 / Critical |
| --- | --- | --- |
| 三角形最大內角 / Largest interior angle | > 70° | > 90° |
| 三角形球面面積 vs 該 layout 中位數 / Spherical area vs layout median | > 1.5× | > 2.5× |
| L/R 對稱性偏差 / L/R symmetry deviation | > [實測校準] | > [實測校準] |

每個三角形顏色 = 各指標觸到的最差色。

### 8.3 警示文字（顯示於 Layout Health panel）/ Warning Text (Layout Health Panel)

**Panel 開頭文字**（永遠顯示，作為框架說明，獨立於下方動態警示）：

- **中**：這些三角形是任何 sphere-panning renderer（VBAP、AllRAD ambisonic decoder 等）背後共同的幾何骨架。三角形不健康，無論之後用哪個 renderer，跨過該區域的 phantom source 都會定位不清。**這不是合規檢驗——ITU 標準 layout 也可能觸發警示；那代表 VBAP 在該區條件不佳，不代表 layout 違反規範。**
- **EN**：These triangles are the geometric backbone every sphere-panning renderer (VBAP, AllRAD-decoded ambisonics, …) works from. Sources panned across an unhealthy triangle will localise poorly regardless of which renderer you use later. **This is not a compliance check — ITU-spec layouts can still trigger warnings; that means VBAP conditioning is poor in that region, not that the layout violates a standard.**

**動態警示**（依當下 layout 狀態切換）：

- 全綠：`✓ Layout looks healthy.`
- 有黃但無紅：`⚠ N suspect triangle(s) detected in [region]. Coverage may degrade.`
- 有紅：`✗ N problematic triangle(s) detected in [region]. Consider adding phantom speaker(s).`
- 對稱性問題（獨立一行）：`⚠ Layout is asymmetric (L/R, Δ = X.XX rad). Sources panning across the centerline may behave inconsistently.`

`[region]` 用粗略區域描述，從以下集合中選取最相關者：
`upper hemisphere` / `lower hemisphere` / `front` / `rear` / `centerline` / `right side` / `left side` / `surround ring`

> **判定區域的方法**：取該三角形重心方向向量，依其 (x, y, z) 分量大小決定主導區域。
> 例如 `z > 0.7` → `upper hemisphere`；`y > 0.7` → `front`；其餘以最大絕對值分量為準。

### 8.4 設計原則 / Design Principles

警示**只指出問題位於哪個粗略區域**，**絕不建議具體座標**。
phantom speaker 完全由使用者手動放置。
這是 v1 的核心設計決定，不要為了「對使用者更友善」而違反。

放下 phantom 後，三角剖分 + 警示**即時 re-evaluate**——這個 feedback loop 是工具最有教育意義的部分。

**Phantom speaker 的語義 / Semantics of "phantom speaker"**：phantom 是「我假裝這個方向有顆音響、看 layout 健康度怎麼變」的 sketch 工具，**不一定要事後補成實體音響**。Spat / Panoramix 的實際 workflow 也是這樣：phantom speaker 在 render 時，靠 triangulation 把 gain 攤回鄰近的實體 speaker（zenith / nadir 補洞最常見）。Tool UI 文字應把 phantom 框成「在球面上預訂一個 panning 位置 / reserve a panning slot」，而不是「未來要買的音響」——這個用語選擇影響使用者怎麼理解工具用途。

---

## 9. 互動 / Interaction

### 9.1 Camera

- 滑鼠拖曳：旋轉視角，圍繞 (0, 0, 0)
- 滾輪：縮放（min/max distance 限制，避免穿模或飛太遠）
- 預設視角按鈕：
    - `Perspective`（預設啟動視角）
    - `Top`（從正上方俯視）
    - `Front`（從 -Y 方向看 +Y，看舞台）
    - `Side`（從 +X 方向看 -X）
    - `Listening`（從 (0, 0, listeningHeight) 朝 +Y 方向看，模擬「坐在聽眾位置」）

### 9.2 編輯 / Editing

- 「+ Add Speaker」：彈出表單輸入 x/y/z/yaw/pitch/angleH/angleV/name
- 列表中點擊任一 speaker：展開編輯欄位（inline edit）
- 列表中 × 按鈕：刪除（無 undo，但有確認對話框）
- 「+ Add Phantom」：彈出表單輸入 x/y/z/name
- 觀眾席尺寸 / 聽覺高度：右側面板輸入欄位，即時更新

### 9.3 視覺輔助 / Visual Aids

- 滑鼠 hover 三角化視圖中的某個三角形：顯示該三角形的最大內角 + 球面面積 + 健康度
- hover 某顆音響：highlight + 顯示其資料摘要

---

## 10. 下載 / 上傳 HTML / Save & Open HTML

### 10.1 下載 / Save (Download)

按下「Download as HTML」：

1. 將完整 State（§5.5）序列化為 JSON
2. inline 進一個 self-contained HTML template：
    - p5.js 從 CDN 引用（保留外部依賴是為了檔案小）
    - 工具邏輯（coverage.js）inline 嵌入
    - 樣式（coverage.css）inline 嵌入
    - State JSON 嵌入為 `<script id="coverage-state" type="application/json">{...}</script>`
3. 觸發瀏覽器下載（檔名：`{layoutName}-coverage-sketch.html` 或 `untitled-coverage-sketch.html`）

### 10.2 下載出 HTML 的特性 / Properties of Saved HTML

- `<title>` = layout 名稱（無命名則 `Sound Coverage Sketch — Untitled`）
- 檔頭 HTML comment 區塊寫入 metadata：

    ```html
    <!--
      Generated by Sound Coverage Sketch
      Layout name: {layoutName}
      Generated at: {ISO 8601 timestamp}
      Source: https://tools.zcreation.art/coverage
      Tool version: {toolVersion}

      This file is fully editable.
      Open it in a modern browser, or upload it back to the source URL to continue editing.
    -->
    ```

- **可編輯瀏覽 / Fully editable**：包含所有編輯 UI、可加減音響、可截 PNG、layer toggle 與相機切換照舊
- **不含 Save HTML / No Save HTML button**：下載產物是 snapshot，再次下載 / round-trip 編輯走 live tool 的「Open from HTML」（§10.3）。boot 時偵測 `#coverage-script-inline` 自動 hide Save HTML 按鈕
- **固定英文 UI / English-only UI**
- 開啟即顯示 layout 當前狀態（沿用儲存時的視角、layer toggle、單位設定）

### 10.3 上傳（Resume Editing）/ Open (Resume Editing)

「Open from HTML」按鈕：

1. 接受 `.html` 檔案
2. 讀取檔案內容、用 regex / DOMParser 找到 `<script id="coverage-state">` 區塊
3. 解析 JSON、驗證 `schemaVersion === 1`
4. 載入 state、進入編輯模式
5. 失敗（檔案格式錯 / schema 不符）：顯示錯誤訊息，不破壞當前 state

---

## 11. 截圖匯出 / Screenshot Export

- 「Download as PNG」：擷取當前 canvas
- 解析度：顯示解析度 × 2（高 DPI）
- 檔名：`{layoutName}-coverage-{timestamp}.png`

---

## 12. 語系策略 / Localisation Policy

工具 UI 全部維持英文。聲音設計領域的關鍵詞（phantom speaker / cone / yaw / pitch / dB / SPL / VBAP）以英文為公約數，硬翻反而要使用者反查。

**唯一例外 / Sole exception**：§2 定位語句採中英雙呈現（同一塊 panel 內中文在上、英文在下，皆完整可見）。理由是 §2 是錯誤成本最高的地方——使用者若誤解工具能做什麼，會帶著錯誤期待去用；對中文圈使用者（包含工作坊現場），中文版能徹底消除此誤解。

下載出的 HTML 沿用同一塊 §2 區塊（無特殊處理），UI 同樣全英文。

---

## 13. 行動裝置政策 / Mobile Device Policy

```js
if (window.innerWidth < 1024) {
  // 顯示非阻擋式 banner（頁面頂部 / 浮動）
  // 文字：This tool is designed for desktop.
  //       The editing experience is limited on smaller screens.
  // banner 可手動收起，但每次頁面重新載入又會顯示
  // 不阻擋任何功能、不重排 layout、不切換 mobile UI
}
```

- **不做** responsive 重排
- **不做** touch-first 編輯體驗
- **不做** device 分流
- 行動裝置仍可瀏覽 + 進行有限互動（orbit / zoom 觸控勉強可用），但不保證好用
- 此規則同時適用於下載出的 HTML

---

## 14. 視覺與互動規範 / Visual & Interaction Conventions

- **配色 / Palette**：以「中性、可讀性高」為原則。背景淺灰（接近 `#f3f3f6`），文字深色（接近 `#2a2a2a`）。
- **字體 / Typography**：優先 system font + Jost；中文 fallback 到 system CJK
- **控制面板 / Floating panels**：四角浮動半透明白色（`rgba(255,255,255,0.95)`）+ 細邊框 + 8px 圓角 + 輕陰影
- **提示 / 警示 / Alert iconography**：emoji icon（✓ ⚠ ✗）+ 顏色（綠 / 黃 / 紅）
- **動畫 / Motion**：避免不必要動畫；視角切換可有短暫 ease（< 300ms）；尊重 `prefers-reduced-motion`

---

## 15. SEO 與 robots / SEO & robots

- `sitemap.xml`：含 `tools.zcreation.art/` 與 `tools.zcreation.art/coverage/`
- meta description：英文，含關鍵字 `multichannel speaker layouts` / `VBAP layout health` / `sound design` / `geometric coverage`
- 不主動推廣，但允許被搜尋到（**不**設 noindex）
- Open Graph：1200×630 OG image（重用工具預設啟動視角的截圖）；附 `twitter:card=summary_large_image`

---

## 16. 不做清單（v1 明確排除）/ Out of Scope (v1)

- 自動 phantom 放置（建議具體位置）
- speaker / layout preset library（特定型號預設值、ITU 5.1 / 7.1 / Octagon 樣板等）
- SPL / 頻率響應 / IR / 反射 / 駐波模擬（工具只呈現幾何 + 運動學資料：位置、距離、傳播延遲、cone 方向；聲學推算交給使用者 / renderer / 量測）
- 頻率依賴的 cone 寬度（HF directional / LF omni）：不模擬。`angleH` / `angleV` 視為 manufacturer spec sheet 的單頻 reference 值（通常 −6 dB @ ~2 kHz）
- VBAP 以外的 renderer 分析（DBAP、Ambisonics decoder、Atmos）
- 場館 3D 模型 import（GLTF / OBJ / DXF）
- 帳號系統 / 雲端儲存
- 多人協作
- 行動裝置最佳化 UI / touch-first 編輯
- Build pipeline / framework 引入
- RTL 語系
- i18n / 多語切換（除 §2 雙呈現外）
- Undo / Redo（v1 不做，v2 視需要）

> **關於 preset library / On preset libraries**：實際劇場（尤其實驗 / 新媒體演出）很少對齊典範 layout——「在某個道具方向藏一顆音響」是經典且正確的做法。工具不該誘導使用者「先選一個標準再微調」，而是「直接畫你要的位置」。
>
> **附註**：工具開機時內建的 LCR 啟動畫面是 **onboarding default**（讓首屏五秒讀懂工具的視覺示範），**不是 preset library** —— 使用者可隨時編輯或刪除這三顆，工具不提供「下拉選單載入 5.1 / Octagon」這類功能。

---

## 17. 開放決定（v1 開發中或上線後解決）/ Open Decisions (Under Development or Post-Launch)

| 項目 / Item | 內容 / Description | 何時需要決定 / When |
| --- | --- | --- |
| L/R 對稱性偏差門檻 | 需以 beta / 真實 layout 校準 | beta |
| Phantom speaker 數量上限 | 是否設上限避免無意義疊加 | beta |
| 截圖按鈕是否選擇解析度 | v1 暫定固定 2× | v2 視需要 |

---

## 18. 學理參考 / Academic References

工具的設計觀點與 disclaimer 文字應該誠實地引用以下參考：

- Pulkki, V. (1997). *Virtual Sound Source Positioning Using Vector Base Amplitude Panning.* Journal of the Audio Engineering Society 45(6).
    - 凸包三角剖分 (convex-hull triangulation) 作為 VBAP 幾何基礎
    - <https://link.springer.com/chapter/10.1007/978-3-030-17207-7_3>
- IRCAM Spat / Panoramix
    - phantom speaker at zenith / nadir 的實作參考
    - <https://forum.ircam.fr/projects/detail/spat/>
- Aalto VBAP Library 實作參考
    - <http://research.spa.aalto.fi/projects/vbap-lib/vbap.html>

工具首頁或許可以放一個 "Further reading" 折疊區塊，列出上述三條連結。

---

## 19. 結語 / Closing Notes

若實作中遇到 spec 未覆蓋或矛盾的情境，先**回到 §3 核心原則判斷**。

**v1 不需要做得完美——做得誠實、可用、可下載、可繼續編輯就足夠。**
其他都可以等使用者真正開始用之後再迭代。
