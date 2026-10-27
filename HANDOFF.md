# 多張圖片合成 PDF 交接
狀態：**M1 本地實作候選已建立；Node/check/build PASS，真瀏覽器必要 gate 待驗。** 版本 `0.1.0-m1`，2026-10-23（Asia/Taipei）。尚未通過產品完整驗收，未公開 GitHub、未部署、未整合首頁、未進入外部驗收。沒有 M2 放行。

requested `gpt-6.1-sol/max`；未獨立確認 backend identity，未切模型、未委派或另開 chat。主代理負責下一階段獨立驗收與單一整合 ZIP，本輪未另製交付 ZIP。

## 已實作與範圍

- 繁中 `public/index.html` 與英文 `public/en/index.html`：選圖與追加、清除、上移／下移、逐張 90° 旋轉、移除、A4/Letter 直橫向、即時紙張配置摘要、明確操作的單張照片預覽、進度／取消、建立／下載單一 PDF。兩語 title/description/H1、16 個錯誤碼和說明、FAQ、同語言首頁連結與語言切換皆有實際來源；預覽保持 noindex,nofollow，沒有 production canonical/sitemap。
- 核心：所有來源通過 preflight 才能 decode；count/8MiB/64MiB/16MP/8192-edge hard caps；bounded JPEG SOF/APP1 Exif 與 PNG IHDR/chunk CRC/eXIf/acTL 檢查，拒絕 malformed metadata/APNG。EXIF 1–8 視覺尺寸再套額外 rotation。
- 瀏覽器邊界：明確 from-image ImageBitmap，單一 reusable 工作 Canvas；預覽與 export 共用序列 queue，每次 bitmap close、Canvas 歸零，透明區先填白；toBlob image/jpeg / 0.92、MIME/signature/header dimensions 檢查。任何錯誤／取消／過期 callback 不得回傳 partial PDF。
- PDF：固定 PDF 1.4、Catalog/Pages + 每頁 Page/Image/Contents 三物件、DCTDecode/DeviceRGB、固定兩位小數、contain/center/28.35pt 白邊；UTF-8 實際 bytes、direct stream Length、20-byte classic xref entries、startxref、固定 `images-document.pdf`，無來源字串或 metadata 欄位。實際 64MiB cap 與 +1 邊界已測。
- ownership：任何來源／排序／旋轉／紙張變更先同步取消舊結果；generation fences 每個 async 邊界；URL 最晚 60 秒／清除／pagehide revoke。重複下載重用同一個有效 URL，避免每次另存 Blob；已交付下載不能撤回。失敗保留來源供重試；清除釋放頁面參照，不承諾 OS 資料刪除或記憶體抹除。
- 工具鏈：ESM/private/Node>=24、零依賴。check 檔案／語法／資源及模組路徑／靜態危險 API 掃描；build 閉合 13 檔 allowlist，拒絕來源與輸出 junction/symlink、未知／缺失／stale 檔案，保留未知輸出而報錯。dev handler 有 exact route、Host、GET/HEAD、MIME、CSP 與 no-store/noindex，僅可在 127.0.0.1:4226 啟動；**本輪未啟動**。

新增 package/.gitignore、public/**、scripts/**、test/**、TASK-ENTRY；更新 HANDOFF；生成 dist/** 與 evidence/m1/**。未修改 AGENTS、六份核心規格或 docs、兄弟工具、共享首頁／看板、GlossGate。根 Git 對本工具仍顯示 untracked directory，所以沒有已提交版本的 tracked diff；以固定相對路徑 bytes/SHA 清單交主代理逐檔審閱。

## 最終實際驗證

Node `v24.14.0`。由 `node scripts/verify.mjs` 使用現有 `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`，子程序 `shell:false/windowsHide:true`，沒有 npm install。下面是最後產品程式版本的結果；後續只更新交接／證據文件。

|實際命令|exit|結果／範圍|
|---|---:|---|
|npm test|0|49 tests、49 pass、0 fail/cancelled/skipped/todo；含 A01–A20、7 項 fake DOM 接線、4 項工具鏈／offline handler 測試|
|npm run check|0|13 public files；JS/ESM 語法與靜態本地資源／preview noindex 檢查|
|npm run build|0|13 allowlisted preview files → dist；無 server/browser|
|node scripts/capture-artifact.mjs|0|實際 PDF bytes 1,180、2頁、8 object offsets 全部對準；僅 framing 證據|
|check-persistent-environment.ps1 前／後 + full Snapshots 比較|0|前後 Status PASS，完整 Snapshots 相同|

完整命令、執行檔、exit/count/log SHA 見 [final-commands.json](evidence/m1/final-commands.json)。原始輸出：[test](evidence/m1/final-test.log)、[check](evidence/m1/final-check.log)、[build](evidence/m1/final-build.log)。測試皆為離線合成資料；fake DOM/Canvas/bitmap 的測試只證明控制流程，沒有操作使用者桌面或真正瀏覽器。

固定來源及 dist 的完整 bytes/SHA 清單由最後 freeze 流程產生於 [frozen-sources.json](evidence/m1/frozen-sources.json)、[frozen-dist.json](evidence/m1/frozen-dist.json)，整體索引 [FREEZE.json](evidence/m1/FREEZE.json)。來源清單涵蓋原 14 份規格與本輪來源，排除 dist/evidence；dist 逐檔與 public bytes 相同。所有 document links 使用可攜相對路徑。不要在原地變動凍結候選後沿用本輪測試身分。

## 真實產物與證據邊界

[writer-structure-only.pdf](evidence/m1/artifacts/writer-structure-only.pdf)：1,180 bytes，SHA-256 `5e78e42aca457959ac730ba638661dba9049ad9b92a13edb055404cce20f7355`。A4 兩頁，xref offsets `[19,68,131,267,439,534,670,842]`、startxref `937`，頁面數／順序與精確 A4 operations 已從實際產物讀回。詳 [structure-report.json](evidence/m1/artifacts/structure-report.json)。

此檔的兩個 image streams 是 `[FF D8 00 0A FF D9]`／`[FF D8 80 00 FF D9]` opaque payload，**不是可解碼 JPEG，也不是實際照片 PDF 示範**。來源已接上真正原生 Canvas API，但此環境沒有執行過它。64MiB 測試產物只在測試記憶體生成，不把大檔加入交接包。照片清晰度、JPEG 內容、EXIF mirror、透明白底成像、PDF viewer 相容性仍須下面的真瀏覽器 gate。

## 環境與未驗項

[前快照](evidence/m1/environment-before.json)、[後快照](evidence/m1/environment-after.json)、[完整比較](evidence/m1/environment-comparison.json) 已保存，只含 guard 允許的 hash／型別／長度等資訊。

|Scope|PATH type / length / ephemeral count|PATH SHA-256|完整 Environment-key SHA-256|
|---|---|---|---|
|HKCU|ExpandString / 834 / 0|3efe0b0eba15a12d5555fb191a204ce0048f87381d73108bac1d6d5d05b67ffb|3a36b632b9e0143f2ff2b9e1c5b964e89bf192a4a3aa3ebc93ea8d0314ee7e5a|
|HKLM|String / 1227 / 0|52d7cb0c3e02b67714f1b0caefc8f92d5d2c365bb2513dc537d42207d8b56eb8|a0f49688069fd5a21146e94fd22764caedcd3ffbe25dc60c716a6a398673ac82|

既有重複 PATH entry 保持原樣。未改任何持久環境／PATH／registry／services；沒有讀憑證／token、安裝套件、Git auth/global/system 設定、push 或 deploy。

|範圍|狀態|
|---|---|
|M1 實作／Node／check／build|PASS（限本地程式與離線證據）|
|Native Canvas/JPEG、EXIF 視覺方向、透明白底成像、actual PDF viewer|NOT_RUN_USER_FOCUS_INCIDENT|
|真瀏覽器取消競態、下載、keyboard/320px/200%/對比/reduced-motion、Network/Storage/實際 headers|NOT_RUN_USER_FOCUS_INCIDENT|
|原生／真機／OS dialogs|NOT_RUN_USER_FOCUS_INCIDENT；列印非目標|
|實際 HTTP server|NOT_RUN（依本次禁啟 server 指令）；只做 handler unit tests|
|GitHub repo／source commit／reviewed commit／released commit／Cloudflare／首頁|NOT_PUBLISHED／NONE；不得跨 M2/M3|
|主代理完整獨立驗收／外部驗收|PENDING／NOT_RUN|

下一步的具體觀察與安全條件見 [BROWSER-GATES.md](evidence/m1/BROWSER-GATES.md)。不可用 Node/fake DOM 結果豁免，亦不可在使用者輸入環境試驗隔離或自行啟動 browser/CDP。

FAQ 以 FR-03 確切 fit 公式為準，明說小圖可能被放大、不能增加細節；沒有把「縮放」誤寫成禁止放大。方向尺寸檢查不能分辨 square/mirror 情況，視覺非對稱 fixtures 仍必要。沒有引入 PDF engine 或宣稱 viewer 已驗讀。

## M1 執行紀錄（2026-10-23）

- T00：建立 ESM/private/Node>=24 零依賴 scaffold、閉合 allowlist check/build、未啟動的 loopback dev handler。`node scripts/check.mjs` exit 0，4 個初始 public files。PDF research 與 scope/design 決定見 TASK-ENTRY.md。
- T10：新增 bounded JPEG SOF/Exif、PNG IHDR/chunk CRC/eXIf/acTL 預檢、hard caps、頁面 contain math、排序/旋轉 pure helpers 與假資料 fixtures。`node --test test/image-preflight.test.mjs test/page-layout.test.mjs` exit 0，16/16 PASS。A01–A10 全含；沒有 decoder 或 browser 呼叫。T20 前將 PDF 數字輸出統一為固定 2 位小數，直接符合 A13 精確文字；最終重跑受影響測試。
- T20：建立 PDF 1.4 pure writer、閉合 numeric schema、固定 filename、UTF-8 byte chunks、每頁三個 objects/classic xref/direct Length。`node --test test/pdf-writer.test.mjs test/page-layout.test.mjs` exit 0，12/12 PASS（writer 7 項 + layout 5 項）。A11–A17 含真正 67,108,864-byte 產物 cap 與 +1 拒絕；payload 是 opaque 合成資料，不是可解碼照片。
- T30：新增 serial Canvas adapter、每次 close/reset、全檔二次預檢、cancel/generation fence、輸出記憶體 ownership 與 60 秒 URL lifecycle。`npm test`（以 Node 執行現有 npm-cli.js）exit 0，36/36 PASS，其中 10 項 fake pipeline 與 2 項 URL ownership tests。A18–A20 有取消 decode、第二頁 encode、JPEG arrayBuffer 邊界及 stale callback；不代表原生 Canvas 已通過。
- T40：雙語 UI 與核心已接線；check/build exit 0，13 public files。新增 app/toolchain 指定測試 exit 0，10/10 PASS。一次補丁格式錯誤被 apply_patch 拒絕，沒有局部寫入，後已改正。TASK-ENTRY 的完成條件已明確改成待驗條件，非提前 PASS。
- T50：初輪最終命令 47/47 + check/build exit 0，紀錄保留於 evidence/m1/history/round-1。自檢發現重複下載 URL 可累積、下載 allocation error 需要安全清除，修復後增加兩項行為測試；最後 49/49、check/build 全 exit 0，固定來源供主代理驗收。後續無產品程式變更。
- 環境基線：guard Status PASS；已存 evidence/m1/environment-before.json。第一次 shell wrapper 誤用未設定的 LASTEXITCODE 而拋錯；guard 本身沒有失敗，改以 script success 與 JSON Status 驗證後成功存檔。未做任何持久環境寫入。

初始交接於本輪進入時為「規格已準備，尚未實作／驗收／公開／部署」；本節保留實際進展和前期 wrapper/patch 錯誤。規格文件的初始狀態標示未在允許範圍內更新，以本 HANDOFF 和固定證據索引為本輪事實。真瀏覽器待驗不等於必要 gate 已豁免。

## M1B／B20-RP-46 離線發布準備（2026-10-23 追加）

本輪以最新 `.runs/batch20-release-prep-2026-10-23/TASK.md` 為精確範圍。M1段、舊證據與舊freeze全部保留歷史身分，沒有把原產品改版或瀏覽器待驗改成PASS。本輪仍未進入M2／M3。

實際差異：package新增build:release/check:release（保留原scripts及產品version），.gitignore新增release-artifacts；新增 `scripts/release.mjs`、`scripts/release-html.mjs`、`scripts/release-baseline.json`、`scripts/verify-release.mjs`、`test/release.test.mjs` 及 [M1B-RELEASE](M1B-RELEASE.md)；TASK-ENTRY與本HANDOFF追加本輪狀態。其他原scripts/tests沒有修改。新增證據只在evidence/m1b，產物只在release-artifacts。六份規格／AGENTS／docs、public/dist、舊evidence及兄弟工具不在修改範圍。

原生runtime與兩語可見candidate聲明保留；release只改HTML head的index,follow/canonical/互返hreflang，新增robots/sitemap/_headers。固定預定origin `https://image-pdf.glossquote.com`，slug `images-to-pdf`。site 16檔，加同層manifest為17檔；manifest固定schemaVersion1/mode release-candidate、完整public sourceFiles與site files bytes/SHA，沒有時間、隨機數、絕對路徑。安全headers依M1 serve的CSP與固定header設定，僅索引header不同。

checker不是只比manifest：來源受M1 pin約束、整份HTML解析語義、產物依合法來源重新生成expected bytes、原始manifest及所有site bytes完整比較。source、asset或manifest任何污染都拒絕。build完整preflight後僅新建；既有合法同輸入可重用，未知／缺失／修改輸出保留並報錯，不提供自動刪除或覆寫恢復。

|本輪實際命令|exit|結果|
|---|---:|---|
|node --test test/release.test.mjs|0|12/12新測試PASS，全部離線副本負例|
|npm test（最後固定版本）|0|61 tests／61 pass／0 fail,cancelled,skipped,todo；原49+本輪12|
|npm run check|0|13 public files，原preview noindex／本地資源與新增ESM語法檢查|
|npm run build:release|0|獨立release-candidate site 16檔+同層manifest；未serve／deploy|
|npm run check:release|0|固定origin、來源、完整內容／SEO／安全配置與manifest重驗通過|
|environment guard 前後／完整Snapshots比較|0|PASS／完全相同；PATH型別、長度、ephemeral count與全Environment fingerprint未變|

最後四個npm命令由 `node scripts/verify-release.mjs` 執行一輪，子程序shell:false/windowsHide:true，Node v24.14.0。原preview build沒有重跑。可機器核對的命令／exit/count/log SHA見 [final-commands](evidence/m1b/final-commands.json)；環境快照見 [before](evidence/m1b/environment-before.json)、[after](evidence/m1b/environment-after.json)、[comparison](evidence/m1b/environment-comparison.json)。初次HTML parser smoke的exit1和修正保留於 [DEVELOPMENT](evidence/m1b/DEVELOPMENT.md)，不刪歷史失敗。

完整來源差異與固定來源bytes/SHA由最後audit記於 [source-changes](evidence/m1b/source-changes.json)、[sources-final](evidence/m1b/sources-final.json)，產物逐檔bytes/SHA見 [artifacts-final](evidence/m1b/artifacts-final.json) 及 [manifest](release-artifacts/manifest.json)。manifest SHA-256：`b89031e973e6b0ba6aa54b2bfe2f8852e19217c669816598a82f7d645d16184a`；pinned input文件 SHA-256：`513b9cc32bb9f833d61195692b0a5dd2f8ef57af6b932e95bf6b2e000dd3a4bb`。

必要真browser/Canvas/JPEG/PDF viewer/視覺/keyboard/實際下載/Network/Storage/hosting header/原生/真機 gates仍 **NOT_RUN_USER_FOCUS_INCIDENT**。`_headers`配置通過不等於實際HTTP headers已驗。沒有GitHub／source commit／reviewed/released commit、部署或首頁發布；單一ZIP仍由主代理整合。

需要主代理後續決定：核准的真正隔離驗收機制與必要browser gates完成後，才另行M2發布放行。本輪沒有新依賴或權限需求。若未來來源刻意改版或首次I/O失敗留下不完整候選，需主代理另設有界baseline／輸出恢復任務；本工具拒絕自行清除或擴權。

## B20-46-M2A 發布候選準備（2026-10-27 追加，最新狀態）

**M2A PREPARED；等待主代理 M2B，沒有 push／deploy／首頁整合／外部驗收。** 本節更新先前階段的待驗狀態；M1、M1B 與舊證據保留各自歷史身分。requested gpt-6.1-sol/max 未改，沒有委派、另開 chat 或宣稱已驗證 backend identity。

主代理已親跑隔離 Chromium `145.0.7632.6` 的 `b20-46-r3`：32 PASS／10 NOT_RUN／0 FAIL、prohibited=[]，並回報已目視實際 screenshots。已讀回原 RUN 的結果與最後 parent-cleanup PASS；實際下載 PDF bytes、內嵌 JPEG pixels、EXIF 1–8、A4/Letter、取消／stale、鍵盤／320px、network/storage 等 PASS 沿用未修改的產品版本。可核對的 receipt 路徑、bytes/SHA、下載 PDF 範例與完整 case 狀態見 [browser-acceptance-reference](evidence/m2a/browser-acceptance-reference.json)。本功能對話沒有啟動 browser、IAB、CDP、server、native UI 或碰使用者輸入環境。

精確變更：新增 `wrangler.jsonc`、`scripts/worker-config.mjs`；修改 `scripts/check.mjs`、`scripts/release.mjs`、`scripts/release-html.mjs`、`test/release.test.mjs`，本 HANDOFF 追加紀錄。新證據只在 `evidence/m2a/`。public、dist、browser/core runtime、原規格／AGENTS／docs、原測試其餘部分、舊 evidence/m1/m1b 全部保留原 bytes。逐檔 before/after bytes/SHA 與實際差異見 [source-changes](evidence/m2a/source-changes.json)、[source.diff](evidence/m2a/source.diff)、[release.diff](evidence/m2a/release.diff)。

Wrangler 採 42 的精確 assets-only 格式，僅替換 name/domain：Worker `glossquote-images-to-pdf`、domain `image-pdf.glossquote.com`、compatibility date `2026-10-24`。workers.dev／preview URLs／metrics／logs／invocation logs／traces 全關；assets 只指向 `./release-artifacts/site`、run_worker_first=false、html_handling=none、not_found_handling=none。沒有 executable Worker、binding、vars、env 或額外 routes。check 和 release preflight 均拒絕配置偏移；沒有安裝或執行 Wrangler，靜態檢查不代表 Cloudflare 已接受或已部署。

release 只對兩個 allowlisted footer 節點移除候選／未發布字樣，保留 `Gloss Tools by GlossQuote`。HTML head／SEO／其餘 body 與舊 release 全 bytes 相同；public HTML 原候選聲明仍保留。新增 `_redirects` 為三行真正 LF，含末尾 LF：

```text
/ /index.html 301
/en /en/index.html 301
/en/ /en/index.html 301
```

release site 現為 17 檔，加同層 manifest 共 18 檔；manifest 閉合記錄 `_redirects`。新 manifest SHA-256：`b5b5b9f08c7821c39554098ca95a59945a5840030d54768124f52739b8027f59`。build/check 仍依 pinned public 與固定規則重建 expected bytes，不能透過修改資產及同步 manifest hash 偽造通過；不提供自動覆寫／刪除輸出。

此次已獲授權的單次候選替換先驗證舊 17 檔符合 M1B freeze，再將完整原目錄移至 [previous-release-artifacts](evidence/m2a/previous-release-artifacts/manifest.json)，然後另建新 release-artifacts。舊 manifest SHA 仍為 `b89031e973e6b0ba6aa54b2bfe2f8852e19217c669816598a82f7d645d16184a`；舊全檔 bytes/SHA 及移動前後驗證見 [preservation](evidence/m2a/previous-release-preservation.json)。舊 evidence 與舊 manifest bytes 未改；先前章節指向目前 release-artifacts 的歷史 manifest 請改以這份保存副本核對。

|本輪實際命令／驗證|exit|結果|
|---|---:|---|
|node --test test/release.test.mjs|0|21 tests／21 pass／0 fail,cancelled,skipped,todo|
|npm run check|0|13 public files；既有靜態檢查與精確 assets-only config|
|npm run build:release|0|17 site assets＋manifest，未部署|
|npm run check:release|0|來源、完整輸出 bytes、HTML、redirects、config、manifest PASS|
|環境 guard 前後完整 Snapshots 比較|0|PASS；HKCU/HKLM PATH 與完整 Environment-key／TEMP/TMP fingerprints 完全相同|

Node `v24.14.0`，使用既有 npm-cli.js；子程序 shell:false/windowsHide:true。命令、exit、counts、log SHA 見 [final-commands](evidence/m2a/final-commands.json)。新負例含 redirect 目標改寫、額外行、缺行、CRLF、缺末尾 LF、與 manifest hash 同步竄改；footer 重複／巢狀／屬性／非 allowlist 字樣；Worker routes、telemetry、bindings、vars、fallback 等偏移。原 49 項產品測試輸入未變，沿用 M1B 的通過證據，本輪沒有重跑 full npm test 或 preview build。完整來源、產物與保護範圍見 [sources-final](evidence/m2a/sources-final.json)、[artifacts-final](evidence/m2a/artifacts-final.json)、[release-delta-proof](evidence/m2a/release-delta-proof.json)、[FREEZE](evidence/m2a/FREEZE.json)。

剩餘 10 個 browser NOT_RUN 維持原狀（兩語各五項）：原生 PDF viewer A4／Letter、真正 200% 文字縮放、viewer visible content、原生 OS dialogs／真機 AT。另有 MIME 不一致的 raw-byte 子斷言未驗；不可用產品錯誤文案或離線 mock 取代。主代理對產品 screenshots 的目視回報不改寫原生 viewer NOT_RUN。M2A 的 footer／redirect／config 只有離線驗證，Cloudflare 實際 redirects／headers／404、GitHub repo/visibility/commit、hosting、首頁與外部驗收仍未執行；source/reviewed/released commit 均 NONE。

沒有讀憑證／token、變更持久環境／Git auth/config、安裝依賴、push、deploy、付費或製作額外 ZIP。下一階段為主代理 M2B；本輪候選準備通過不等於產品或發布完成。
