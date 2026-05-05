# SPEC.md
# Sound Coverage Sketch — v1 設計規格

> 此文件是 `coverage` 工具 v1 的**單一真實來源**。
> 任何在實作中發現需要修改的細節，請更新此文件。
> 此 spec 由 Cowork 對話於 2026-05-04 定稿，傳遞給 Claude Code 接手實作。

---

## 1. 專案資訊

- **工具名稱**：Sound Coverage Sketch（候選；最終命名待定，見 §10）
- **URL**：`tools.zcreation.art/coverage`
- **目標使用者**：聲音設計師（劇場、現場、多聲道創作者；含學生與獨立工作者）
- **發布目標**：2026 年 6 月中下旬上線（在 7 月多聲道工作坊前 1–2 週）

---

## 2. 定位語句（首頁顯著呈現）

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

此段話必須**完整、可見**地呈現於工具首頁第一屏與下載出 HTML 檔的開頭。
不要為了視覺優雅而省略其中任何一句。

---

## 3. 核心原則

1. **聽覺中心優先**：世界座標原點 (0, 0, 0) 永遠是「假想的聽覺中心」，所有資料、視角、計算以此為錨。沒有「場館建模」概念。
2. **可攜性優先**：使用者可隨時下載一份自我完備的 HTML 檔，內含目前 layout，可獨立開啟、可上傳回工具繼續編輯。
3. **誠實優先**：工具明確告知它「能」與「不能」告訴使用者的事。任何可能誤導的視覺、文字、警示都必須加上限制條款。
4. **桌面優先**：`< 1024px` 顯示提示 banner，但不阻擋。

---

## 4. 座標系統與單位

### 4.1 世界座標
- `x` = 左 / 右（朝右為正）
- `y` = 前 / 後（朝舞台 / 觀眾正前方為正）
- `z` = 上 / 下（朝上為正）
- 右手座標系：`+X × +Y = +Z`（從觀眾席往舞台看，右手 = +X、上舞台 = +Y、頭頂 = +Z）
- 原點 `(0, 0, 0)` = **假想聽覺中心在地板的投影**（始終，不可移動）
- 假想聽覺中心本身位於 `(0, 0, listeningHeight)`（耳朵高度），是 `aimAtCentre` 的瞄準目標

### 4.2 單位
- `cm` 與 `m` 切換（UI 提供 toggle）
- 所有顯示數值即時轉換（不重算內部資料；內部統一以 `cm` 儲存）
- 預設單位：`cm`（沿用 Yves 既有檔案慣例）

---

## 5. 資料模型

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

### 5.5 完整 State（用於下載 / 上傳）
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

## 6. v1 視圖層（皆可獨立 toggle，預設值見括號）

| Layer key | 內容 | 預設 |
|---|---|---|
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

## 7. 覆蓋熱區計算

### 7.1 計算位置
- 計算於**聽覺平面**：`(x, y) ∈ [-length/2, length/2] × [-width/2, width/2]`，`z = listeningHeight`
- Grid sampling：建議 grid 解析度 = 兩軸各 50–100 點（視效能調整）

### 7.2 「被涵蓋」的判定（矩形角錐版，與 cone 視覺一致）

對每個 grid point `P`，對每顆 enabled speaker `S`：

1. 取 speaker 本地基底 `(forward, right, up)` = `speakerBasis(yaw, pitch)`（M1 已實作；`right = forward × world-up`、`up = right × forward`）。
2. 計算 `d = P - S`，並投影到三個基底軸：
   - `f_proj = d · forward`
   - `r_proj = d · right`
   - `u_proj = d · up`
3. 條件全部成立才算被涵蓋：
   - `f_proj > 0`（在 speaker 前方）
   - `|r_proj / f_proj| ≤ tan(angleH / 2)`
   - `|u_proj / f_proj| ≤ tan(angleV / 2)`

> **備註**：早期版本用「球面角度偏移」判定（`atan2` 算 θ_h / θ_v 與 halfH / halfV 比較），但這會在 `pitch ≠ 0` 時產生**梯形覆蓋區**（cos 因子讓上下緯度圈半徑不同）。M1 把 cone 視覺改成矩形角錐後，coverage 判定也對齊到矩形版本，兩者完全一致。詳見 ROADMAP 討論事項 8。

### 7.3 熱區著色（gradient）
| 涵蓋顆數 | 顏色 |
|---|---|
| 0 | 紅（警告：黑洞） |
| 1 | 黃 |
| 2 | 橙偏綠 |
| 3+ | 綠（充足） |

實作建議：用 lookup table 或簡單函式映射。**所有顏色以半透明渲染**，不蓋掉地面格線。

---

## 8. Layout Health 系統（Triangulation Diagnostic）

### 8.1 計算流程
1. 對所有 enabled speaker + phantom，計算其相對原點的方向向量
2. 投影到單位球面
3. 計算凸包 → 取得三角形列表
4. 對每個三角形計算：
   - 球面面積（用三邊弧長 + 球面三角形公式或 L'Huilier theorem）
   - 最大內角
5. 計算整體 L/R 對稱性偏差（將所有點對 X=0 平面鏡像，與原點集做最近鄰配對的平均距離；單位：球面弧度）

### 8.2 健康度判定（v1 hardcode）

| 指標 | 黃 | 紅 |
|---|---|---|
| 三角形最大內角 | > 70° | > 90° |
| 三角形球面面積 vs 該 layout 中位數 | > 1.5× | > 2.5× |
| L/R 對稱性偏差 | > [TBD：實測校準] | > [TBD：實測校準] |

> L/R 對稱性門檻 **v1 開發中先用一個合理估算**（例如黃 > 0.05 rad、紅 > 0.15 rad），上線前用幾組真實 layout 校準。

每個三角形顏色 = 各指標觸到的最差色。

### 8.3 警示文字（顯示於 Layout Health panel）

**Panel 開頭文字**（永遠顯示，作為框架說明，獨立於下方動態警示）：

- **中**：這些三角形是任何 sphere-panning renderer（VBAP、AllRAD ambisonic decoder 等）背後共同的幾何骨架。三角形不健康，無論之後用哪個 renderer，跨過該區域的 phantom source 都會定位不清。
- **EN**：These triangles are the geometric backbone every sphere-panning renderer (VBAP, AllRAD-decoded ambisonics, …) works from. Sources panned across an unhealthy triangle will localise poorly regardless of which renderer you use later.

> 這段是 §2 disclaimer 的「正向版」。§2 否定「我們不模擬 renderer」；這段補上「但 triangulation 是任何 sphere-panning renderer 共有的幾何前提，所以這個工具仍然有意義」——使用者一看就懂「我看的不是聲音，是聲音的幾何前提」。

**動態警示**（依當下 layout 狀態切換）：

- 全綠：`✓ Layout looks healthy.`
- 有黃但無紅：`⚠ N suspect triangle(s) detected in [region]. Coverage may degrade.`
- 有紅：`✗ N problematic triangle(s) detected in [region]. Consider adding phantom speaker(s).`
- 對稱性問題（獨立一行）：`⚠ Layout is asymmetric (L/R, Δ = X.XX rad). Sources panning across the centerline may behave inconsistently.`

`[region]` 用粗略區域描述，從以下集合中選取最相關者：
`upper hemisphere` / `lower hemisphere` / `front` / `rear` / `centerline` / `right side` / `left side` / `surround ring`

> **判定區域的方法**：取該三角形重心方向向量，依其 (x, y, z) 分量大小決定主導區域。
> 例如 `z > 0.7` → `upper hemisphere`；`y > 0.7` → `front`；其餘以最大絕對值分量為準。

### 8.4 設計原則

警示**只指出問題位於哪個粗略區域**，**絕不建議具體座標**。
phantom speaker 完全由使用者手動放置。
這是 v1 的核心設計決定，不要為了「對使用者更友善」而違反。

放下 phantom 後，三角剖分 + 警示**即時 re-evaluate**——這個 feedback loop 是工具最有教育意義的部分。

**Phantom speaker 的語義**：phantom 是「我假裝這個方向有顆音響、看 layout 健康度怎麼變」的 sketch 工具，**不一定要事後補成實體音響**。Spat / Panoramix 的實際 workflow 也是這樣：phantom speaker 在 render 時，靠 triangulation 把 gain 攤回鄰近的實體 speaker（zenith / nadir 補洞最常見）。Tool UI 文字應把 phantom 框成「在球面上預訂一個 panning 位置」（reserve a panning slot），而不是「未來要買的音響」——這個用語選擇影響使用者怎麼理解工具用途。

---

## 9. 互動

### 9.1 Camera
- 滑鼠拖曳：旋轉視角，圍繞 (0, 0, 0)
- 滾輪：縮放（min/max distance 限制，避免穿模或飛太遠）
- 預設視角按鈕：
  - `Perspective`（預設啟動視角）
  - `Top`（從正上方俯視）
  - `Front`（從 -Y 方向看 +Y，看舞台）
  - `Side`（從 +X 方向看 -X）
  - `Listening`（從 (0, 0, listeningHeight) 朝 +Y 方向看，模擬「坐在聽眾位置」）

### 9.2 編輯
- 「+ Add Speaker」：彈出表單輸入 x/y/z/yaw/pitch/angleH/angleV/name
- 列表中點擊任一 speaker：展開編輯欄位（inline edit）
- 列表中 × 按鈕：刪除（無 undo，但有確認對話框）
- 「+ Add Phantom」：彈出表單輸入 x/y/z/name
- 觀眾席尺寸 / 聽覺高度：右側面板輸入欄位，即時更新

### 9.3 視覺輔助
- 滑鼠 hover 三角化視圖中的某個三角形：顯示該三角形的最大內角 + 球面面積 + 健康度
- hover 某顆音響：highlight + 顯示其資料摘要

---

## 10. 下載 / 上傳 HTML

### 10.1 下載
按下「Download as HTML」：
1. 將完整 State（§5.5）序列化為 JSON
2. inline 進一個 self-contained HTML template：
   - p5.js 從 CDN 引用（保留外部依賴是為了檔案小）
   - 工具邏輯（coverage.js）inline 嵌入
   - 樣式（coverage.css）inline 嵌入
   - State JSON 嵌入為 `<script id="coverage-state" type="application/json">{...}</script>`
3. 觸發瀏覽器下載（檔名：`{layoutName}-coverage-sketch.html` 或 `untitled-coverage-sketch.html`）

### 10.2 下載出 HTML 的特性
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
- **可編輯瀏覽**：包含所有編輯 UI、可加減音響、可截 PNG、layer toggle 與相機切換照舊
- **不含 Save HTML**：下載產物是 snapshot，再次下載 / round-trip 編輯走 live tool 的「Open from HTML」（§10.3）。boot 時偵測 `#coverage-script-inline` 自動 hide Save HTML 按鈕
- **固定英文 UI**（不含 i18n 切換按鈕）
- 開啟即顯示 layout 當前狀態（沿用儲存時的視角、layer toggle、單位設定）

### 10.3 上傳（Resume Editing）
「Open from HTML」按鈕：
1. 接受 `.html` 檔案
2. 讀取檔案內容、用 regex / DOMParser 找到 `<script id="coverage-state">` 區塊
3. 解析 JSON、驗證 `schemaVersion === 1`
4. 載入 state、進入編輯模式
5. 失敗（檔案格式錯 / schema 不符）：顯示錯誤訊息，不破壞當前 state

---

## 11. 截圖匯出
- 「Download as PNG」：擷取當前 canvas
- 解析度：顯示解析度 × 2（高 DPI）
- 檔名：`{layoutName}-coverage-{timestamp}.png`

---

## 12. i18n

### 12.1 編輯器 UI
- 中（繁體）/ EN 切換
- 預設語言依 `navigator.language` 偵測（含 `zh-` 開頭 → 中；其他 → en）
- 切換按鈕固定位置（建議右上角，與主站 ZCreation 一致）
- 偏好寫入 `localStorage`（key: `zcreation-tools-lang`），try/catch 保護無痕模式

### 12.2 字串管理
- 所有 UI 字串收在 `coverage.js` 頂部一個 `I18N` 物件
- 每個字串提供 `{ en: "...", zh: "..." }`
- 取用時透過 helper：`t('key')` 回傳當前語言版本

### 12.3 下載 HTML
- **固定英文**，不含 i18n 切換按鈕
- 簡化下載產物的維護負擔
- 也避免「中英混雜的下載檔案」造成的困惑（使用者可能寄給不會中文的合作對象）

---

## 13. 行動裝置政策

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

## 14. 視覺與互動規範

- **配色**：以「中性、可讀性高」為原則。背景淺灰（接近 `#f3f3f6`），文字深色（接近 `#2a2a2a`）。**避免**主站 ZCreation 的深藍視覺以區隔——這是「工具」不是「作品集」。
- **字體**：優先 system font + Jost（與主站家族感）；中文 fallback 到 system CJK
- **控制面板**：四角浮動半透明白色（`rgba(255,255,255,0.95)`）+ 細邊框 + 8px 圓角 + 輕陰影
- **提示 / 警示**：使用 emoji icon（✓ ⚠ ✗）+ 顏色（綠 / 黃 / 紅）
- **動畫**：避免不必要動畫；視角切換可有短暫 ease（< 300ms）；尊重 `prefers-reduced-motion`

---

## 15. SEO 與 robots

- 上 sitemap：`tools.zcreation.art/coverage`
- meta description（中英）：簡短（< 160 字元），關鍵字：speaker coverage / VBAP / sound design tool / 多聲道 / 聲音設計
- 不主動推廣，但允許被搜尋到（**不**設 noindex）
- Open Graph：提供一張 og preview（可重用工具預設啟動視角的截圖）

---

## 16. 不做清單（v1 明確排除）

- 自動 phantom 放置（建議具體位置）
- speaker preset library（特定型號預設值）
- SPL / 頻率響應 / IR / 反射 / 駐波模擬
- VBAP 以外的 renderer 分析（DBAP、Ambisonics decoder、Atmos）
- 場館 3D 模型 import（GLTF / OBJ / DXF）
- 帳號系統 / 雲端儲存
- 多人協作
- 行動裝置最佳化 UI / touch-first 編輯
- Build pipeline / framework 引入
- RTL 語系
- 中英文以外的 i18n
- Undo / Redo（v1 不做，v2 視需要）

---

## 17. 從舊 P5.js 投影機檔案的可重用部分

Yves 上傳的「A1 投影方案 3D 模擬」（投影機 + RP 三折幕 + 觀眾視線 + 光錐）使用 p5.js WEBGL，以下技術可直接搬移：

- Camera 控制（azimuth / elevation / distance + custom drag handler）
- 光錐繪製（cone face + edge rays + footprint outline）→ 改為「音響張角錐」
- 圖層 toggle 系統（checkbox bind to `show` object）
- 視角預設按鈕
- 控制面板 / Legend / Info / Help 四角浮動 UI

需要重寫 / 新增的部分：
- 多顆音響的資料模型（陣列化、ID 管理、列表 UI）
- 凸包三角剖分（建議用現成 lib：[mikolalysenko/convex-hull](https://github.com/mikolalysenko/convex-hull) 或 [d3-delaunay](https://github.com/d3/d3-delaunay) 變體；或自寫 quickhull on sphere）
- 聽覺平面熱區計算（grid sampling + 角度判定）
- HTML 下載 / 上傳機制（Blob + FileReader + DOMParser）
- i18n 字串切換系統
- Layout Health 文字產生器
- 行動裝置 banner

---

## 18. 開放決定（v1 開發中或上線後解決）

| 項目 | 內容 | 何時需要決定 |
|---|---|---|
| 工具最終命名 | `Sound Coverage Sketch` 為候選；可改 | v1 上線前 |
| L/R 對稱性偏差門檻 | 待實際 layout 校準 | v1 上線前 |
| Phantom speaker 數量上限 | 是否設上限避免無意義疊加 | 開發中觀察 |
| 截圖按鈕是否選擇解析度 | v1 暫定固定 2× | v2 視需要 |
| 主站 `/start` 是否新增 link tile | 連結到 `tools.zcreation.art` | v1 上線後 |
| 工具 landing page (`/index.html`) 樣式 | v1 可極簡（一行字 + 一個連結） | 開發中 |

---

## 19. 學理參考

工具的設計觀點與 disclaimer 文字應該誠實地引用以下參考：

- Pulkki, V. (1997). *Virtual Sound Source Positioning Using Vector Base Amplitude Panning.* Journal of the Audio Engineering Society 45(6).
  - 凸包三角剖分作為 VBAP 幾何基礎
  - https://link.springer.com/chapter/10.1007/978-3-030-17207-7_3
- IRCAM Spat / Panoramix
  - phantom speaker at zenith / nadir 的實作參考
  - https://forum.ircam.fr/projects/detail/spat/
- Aalto VBAP Library 實作參考
  - http://research.spa.aalto.fi/projects/vbap-lib/vbap.html

工具首頁可放一個 "Further reading" 折疊區塊，列出上述三條連結（不是必須，但符合「教育型工具」的氣質）。

---

## 20. 結語

此 spec 由 ZCreation owner（Yves Chen）與 Cowork 助手在 2026-05-04 一場工作對話中定稿。
所有設計決定都有對應的討論脈絡，若實作中遇到 spec 未覆蓋或矛盾的情境，先**回到 §3 核心原則判斷**，再向 owner 確認。

**v1 不需要做得完美——做得誠實、可用、可下載、可繼續編輯就足夠。**
其他都可以等使用者真正開始用之後再迭代。
