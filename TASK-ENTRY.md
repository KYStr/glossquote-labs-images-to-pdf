# B20-46-M1 — 多張圖片合成 PDF

2026-10-23（Asia/Taipei）。本次只做 M1，本工具為原功能對話；requested `gpt-6.1-sol/max`，沒有可獨立確認的 backend identity，不切換模型，不委派。

已讀本工具 14 份規格、根 AGENTS、安全基線、產品論述、完整家族設計契約。工具 DESIGN-SYSTEM 與根文件 SHA-256 相同：`935d4cca13c22b8a66688c8b83fdf412b448a0ff5c62d816728f510aeee05ada`。使用 frontend-design skill 作實作輔助，既定規格優先。

允許變更僅 package/.gitignore/public/scripts/test/dist/HANDOFF/TASK-ENTRY/evidence/m1。未啟動任何 browser、server、native/UI 工具，未安裝套件。沒有 GitHub/部署權限進入 M2。無新 ZIP，由主代理整合。

## T00 PDF research gate

已直接核對 [Adobe PDF Reference 1.4](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.4.pdf)，§3.2.7（印刷頁 35–38）、§3.4.3–3.4.4（頁 64–68）。決定：固定 Catalog/Pages 和每頁三個 objects；stream 使用 direct Length，計算資料 bytes 而非字元；JPEG bytes 原樣加入；20-byte classic xref entries，10-digit offset + generation + status + 空格與 LF；offset 指向物件第一 byte；startxref 指向 xref；固定 trailer Root/Size，無 Info/Metadata/actions。固定 binary comment 以實際 UTF-8 bytes 計數。全輸出不含使用者字串。這是格式決定，並非實際 viewer 驗證。

## 設計與完成條件

Product App；使用者整理交件照片，主要物件為有序頁面。常用選圖、排序、旋轉與紙張保持可達；逐頁摘要呈現紙張白邊和方向。全部來源預檢後，明確預覽只解一張，輸出再逐張處理，兩者共用 Canvas 與 serial queue。桌面：來源列表｜頁面摘要畫布｜紙張設定；目前窄版依 DOM 順序堆疊來源→畫布→設定→產生/下載，鍵盤順序一致，真實 reflow 待驗。使用共享紙色、墨色、acid primary 與系統字體，無外部資源。

預定完成條件（此段不是執行結果）：雙語來源 UI 需接上 PDF writer/Canvas adapter；Node oracle、life-cycle、最終 check/build 需通過，再固定來源 bytes/SHA。真瀏覽器 gates 必須明列 NOT_RUN_USER_FOCUS_INCIDENT。當下已執行事實只記於 HANDOFF 的逐任務紀錄，最終結果另行追加。

## 最終觀察（完成命令後追加）

雙語原生 UI、來源預檢、單張照片預覽／串行 PDF adapter、固定 template writer 已實作接線；最終 `npm test` 49/49，`npm run check` / `npm run build` exit 0，13 preview public/dist 檔。實際結構測試 PDF 1,180 bytes／2頁／8個 xref 物件全部對準，僅使用 opaque fake JPEG。環境完整前後 Snapshots 相同。測試檔／命令輸出與所有界線見 [HANDOFF](HANDOFF.md)。真瀏覽器能力仍 NOT_RUN_USER_FOCUS_INCIDENT，非完整產品驗收。

## B20-RP-46 / M1B 進入（2026-10-23）

已完整讀最新 `.runs/batch20-release-prep-2026-10-23/TASK.md`，它提供本輪新增範圍；M1 內容是歷史紀錄，不覆寫。只允許 package/.gitignore/scripts/test/HANDOFF/TASK-ENTRY/M1B-RELEASE/evidence/m1b/release-artifacts。不得修改 public/dist/原M1證據／規格／兄弟工具。requested `gpt-6.1-sol/max` 未切換、未委派，不以自述確認 backend。

已記59個受保護檔案／46個原來源基線，13個public檔與M1 freeze相符。已新增 pinned M1 public/serve SHA、固定 https://image-pdf.glossquote.com、release renderer/full-document semantic checks/closed output ownership；targeted release tests 12/12 PASS。正式候選只改HTML head索引/SEO，加 robots/sitemap/安全_headers；runtime與可見候選文案保留。後續完整命令／guard／固定hash由 HANDOFF 的 M1B 段與新 evidence/m1b 記錄，不沿用M1測試冒充本輪browser。
