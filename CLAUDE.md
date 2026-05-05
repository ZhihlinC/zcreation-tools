# CLAUDE.md
# zcreation-tools — Claude Code 工作上下文

> 此檔案在 repo 根目錄，Claude Code 啟動時會自動讀取。
> 任何架構變動或長期規則調整，請同步更新此檔。

---

## 👤 作者

- **姓名**：Zhih-Lin Chen（陳致霖）
- **身份**：劇場導演、聲音設計師、作曲家、劇作家、藝術研究者
- **主站**：https://zcreation.art
- **Email**：zhihlin.chen@zcreation.art
- **WSD2025（World Stage Design 2025）聲音設計獎**：新秀組第一名、專業組第三名

---

## 🎯 專案定位

`zcreation-tools` 是 ZCreation 旗下「給聲音設計師的小工具集合」，部署在 `tools.zcreation.art`。
每個工具是一個獨立 subpath（例如 `/coverage`、未來可能 `/spectrogram`、`/ir-viewer` 等）。

第一個工具是 **Sound Coverage Sketch**（覆蓋草圖工具），規格詳見 `SPEC.md`，
v1 實作分階段計畫與每階段視覺檢核清單見 `ROADMAP.md`。
其餘工具皆不在 v1 範圍。

---

## 🏗 架構

### 部署
- **平台**：Cloudflare Pages，獨立專案綁本 repo（main branch 自動部署）
- **網域**：`tools.zcreation.art`（與主站 `zcreation.art` 各自獨立）
- **GitHub repo**：`github.com/ZhihlinC/zcreation-tools`（private）
- **Pages 專案**：`zcreation-tools`（已綁 `tools.zcreation.art`，2026-05-04 上線）

### 技術棧
- 純 HTML + Vanilla JS + p5.js（CDN）
- **不**使用 build pipeline、**不**使用 framework
- 每個工具自成一個資料夾，盡量單檔 HTML（讓「下載 HTML」功能能成立）

### Repo 結構（規劃）
```
zcreation-tools/
├── CLAUDE.md            # 本檔
├── SPEC.md              # v1 工具規格（coverage tool 為主）
├── README.md            # 對外說明（給 GitHub / 偶然訪客）
├── index.html           # tools landing page（v1 簡單列出 coverage）
├── _headers             # Cloudflare Pages headers
├── _redirects           # Cloudflare Pages redirects
├── robots.txt
├── sitemap.xml
└── coverage/
    ├── index.html       # 覆蓋工具本體
    ├── coverage.js      # 工具邏輯
    └── coverage.css     # 樣式（盡量精簡，主要在 index.html inline）
```

> 注意：v1 為了讓「下載 HTML」可獨立運作，`coverage/` 中的 JS / CSS 最終可能會 inline 進 `index.html`。
> 開發期間可分檔，build / publish 前以簡單 inline 步驟（手動或 npm script）合併。
> 若決定 inline，請在此檔記錄選擇與流程。

---

## 🤝 與主站的關係

主站 repo：`~/DEV/zcreation-cloudflare-page/`，部署在 `zcreation.art`。
本 repo 是**獨立 repo、獨立部署**，與主站之間僅透過 hyperlink 連結
（主站 `/start` 之後可能新增一個 link tile 指向 `tools.zcreation.art`，待定）。

主站的字體系統（Shippori Mincho / Jost / Noto Sans TC）與配色 token 為了「家族感」**可以參考但不強制對齊**。
工具的視覺以「中性、可讀性高」為原則，與主站「作品集視覺」刻意區隔。

---

## ⚙️ Claude Code 工作原則

- **語言**：對作者（Yves）回覆預設使用**繁體中文**
- **程式碼**：註解、變數命名、UI 字串（除非 i18n 中文模式）使用英文
- **未知處理**：遇到 SPEC 未涵蓋或定義不明的決定，**先提問確認，不擅自生成**
- **動手前**：先讀相關檔案、確認與現狀一致；不要對著 mental model 寫
- **每次工作階段結束**：若架構變動，更新 `CLAUDE.md`；若 SPEC 有調整，更新 `SPEC.md`
- **commit 訊息**：以英文撰寫，conventional commit 風格（`feat: `, `fix: `, `chore: `, `docs: `）

### Cloudflare 快取策略

CSS / JS 採 **`_headers` 設 `Cache-Control: no-cache`**，瀏覽器每次都 revalidate。
HTML 由 CF Pages 預設處理（`max-age=0, must-revalidate`），不另外規範。

選擇此策略而非主站「version query string bump」的理由：

- 工具規模小（每個 tool 1 CSS + 1 JS），revalidation overhead（304 無 body）可忽略
- 主站方案需要每次改 CSS/JS 都記得 bump，是必踩的人為錯誤源頭
- 此設定一次定案、永久免維護
- 若 M4 改成 inline mode，此規則自動成為 no-op（沒有獨立 CSS/JS 可規範），不需 rollback

新增工具（例如未來的 `/spectrogram`）時，**`_headers` 要補對應的 `/<tool>/*` block**（`/spectrogram/*` 之類），不會自動 inherit。

**踩過的坑**：CF Pages 的 `_headers` splat (`*`) 規定**只能放路徑結尾**，`/coverage/*.js` 這種中段 glob 會默默 no-op。所以是 `/<tool>/*` 整個子樹一起套，而不是 per-extension 規則。HTML 也吃到 `no-cache`，但跟 CF 預設 `max-age=0, must-revalidate` 行為等價。

---

## 📚 開發里程碑

| 階段 | 目標 | 預期時間 |
|---|---|---|
| Spec 定稿 | `SPEC.md` 完成 | ✅ 2026-05-04 |
| **M1 — 場景骨架** | 3D 場景、camera、speaker / cone / 圖層、HTML overlay labels、handedness | ✅ 2026-05-05（commit `4855bb4`） |
| **M2 — 覆蓋熱區** | 聽覺平面 grid sampling + gradient 著色 | ✅ 2026-05-05（commit `5fa8124`） |
| M3 — Layout Health | Phantom speaker、球面三角化、健康度警示 | 預計 2 週 |
| M4 — 下載 / 上傳 / PNG | self-contained HTML + 截圖 | 預計 1 週 |
| M5 — i18n / landing / 發布 | 中英切換、mobile banner、landing page、meta / OG | 預計 1 週 |
| Beta 測試 | 自己 + 2–3 位聲音設計師朋友試用 | 1 週 |
| v1 上線 | `tools.zcreation.art/coverage` 正式公開 | 2026-06-15 ~ 06-22 |
| Workshop 發表 | 7 月多聲道工作坊使用本工具當教學素材 | 2026-07 |

---

## 🔗 重要參考

- 設計討論（Cowork session）的脈絡保存於主站 `~/DEV/zcreation-cloudflare-page/` 的對話備份（若使用者保留）
- 學理基礎參考：
  - Pulkki, V. (1997). *Virtual Sound Source Positioning Using Vector Base Amplitude Panning.* JAES.
  - IRCAM Spat / Panoramix（phantom speaker zenith/nadir 概念）
  - 上述兩者的引用 URL 列於 `SPEC.md` 末尾

---

**最後更新**：2026-05-05（M3.F 完成：triangle hover tooltip + 68 headless tests；M3.G 視覺檢核待續）
