# M1B：離線發布準備候選

2026-10-23，B20-RP-46。預定 origin 固定為 `https://image-pdf.glossquote.com`，toolSlug `images-to-pdf`。網址尚未上線；這不是 M2 公開來源／部署放行，也不代表必要瀏覽器驗收通過。

## 重現與驗證

使用現有 Node.js 24+ 與 npm，不需 install；在本工具目錄執行：

```text
npm test
npm run check
npm run build:release
npm run check:release
```

兩個 release scripts 分別是 `node scripts/release.mjs build` 和 `node scripts/release.mjs check`。缺少 mode、未知 mode、額外參數全部拒絕；沒有 origin／部署／認證參數，也不讀環境變數選擇網址。既有 test/check/build/dev 保留原行為。`node scripts/verify-release.mjs` 將上述四個命令的 exit/count/log hash 寫入新 `evidence/m1b/`，不碰 M1 證據。

輸出：[release-artifacts/site/](release-artifacts/site/index.html)，共16個站點檔；同層的 [manifest.json](release-artifacts/manifest.json) 不放入 site。未來的瀏覽器驗收者應使用這個 **site 目錄**，由主代理確認的隔離機制載入。現有 `npm run dev` 仍服務原 preview dist，不能以它的 noindex headers 當成 release `_headers` 的實際 hosting 證據。本輪沒有啟動它。

## 輸入與輸出界線

來源只取原 public 的13檔閉合 allowlist；[release-baseline.json](scripts/release-baseline.json) 釘住M1受驗版本的完整 bytes/SHA，以及 `scripts/serve.mjs` 的來源指紋。來源改變會拒絕，不能用改掉輸出 manifest 的方式重新定義合法來源。之後若有另行核准的產品修正，須由主代理重新審核 baseline 與新候選，不會自動接受。

兩語HTML僅更動head的robots與canonical/hreflang links；title/description/H1、html lang、body、可見「候選／尚未公開」聲明保持原文。canonical 指向 `/index.html` 和 `/en/index.html`；兩頁皆列 zh-Hant/en/x-default，x-default 中文。其餘 JS/CSS 全部保持M1逐byte一致。新增 robots.txt 明確Allow及Sitemap；sitemap只列兩個canonical、沒有lastmod。

原 public 沒有 `_headers`，因此引用既有 `scripts/serve.mjs` 的完整 `CSP` 常數，並保留 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Cache-Control: no-store`；只有 `X-Robots-Tag` 變成 `index, follow`。原serve來源SHA-256是 `f71dce3a8ddcab5e604c04ec36c615b7c882d629e0f4ce5f299756c58c4d5c54`。connect-src/script-src/img-src data/blob規則沒有放寬。`_headers`只是靜態配置，並非已驗到真實hosting headers。

第一次build先完整檢查所有來源和既有輸出，再以exclusive create寫入新目錄，manifest最後寫入。不提供force／刪除／修復／覆寫路徑；既有合法同輸入候選可重建且bytes一致（直接重用），被改動／不完整／未知輸出則拒絕並保留所有檔案。若首次寫入遇到I/O中斷，可能留下不完整新候選；後續會安全拒絕，應交主代理決定有界恢復，不能默默清除。

## 已執行證據與未驗項

針對本輪的release測試12/12通過；最後完整 `npm test` 61/61，check/build:release/check:release全部exit0。測試涵蓋雙語SEO互返／固定domain、完整文件語義反例、head以外與runtime保持原bytes、兩個獨立副本的確定性、manifest與asset同改、source/serve drift、缺檔／多檔／未知目錄／unmanaged output、junction、CLI拒絕參數。所有負例僅對 `test/.release-*` 臨時副本操作，沒有污染真正public/dist。

命令與原始輸出見 [final-commands.json](evidence/m1b/final-commands.json)、[test log](evidence/m1b/final-test.log)、[check log](evidence/m1b/final-check.log)、[build log](evidence/m1b/final-build-release.log)、[release check log](evidence/m1b/final-check-release.log)。開發時一個 tokenizer boolean-attribute smoke 失敗及修正紀錄保留於 [DEVELOPMENT](evidence/m1b/DEVELOPMENT.md)。最後完整suite只有本次契約要求的一輪，沒有重跑原preview build。

環境guard前後PASS、完整Snapshots相同，見 [比較](evidence/m1b/environment-comparison.json)。來源與產物的完整bytes/SHA清單分別記於 [sources-final](evidence/m1b/sources-final.json)／[artifacts-final](evidence/m1b/artifacts-final.json)，本輪差異見 [source-changes](evidence/m1b/source-changes.json)；這些由最後背景audit生成，與M1凍結身分分開。

正式候選manifest SHA-256：`b89031e973e6b0ba6aa54b2bfe2f8852e19217c669816598a82f7d645d16184a`。它不是自我可信的證書；checker每次從M1 pinned source重建expected bytes、解析全文件SEO並重算實際產物，拒絕manifest與資產協同竄改。

真瀏覽器／視覺／Canvas JPEG／EXIF／PDF viewer／實際下載／Network／Storage／hosting headers／原生／真機均為 **NOT_RUN_USER_FOCUS_INCIDENT**。原M1 [瀏覽器gates](evidence/m1/BROWSER-GATES.md)仍適用。沒有啟動server/browser/CUA/IAB/CDP/native，沒有隔離實驗、憑證讀取、安裝、付費、Windows/Git/auth持久設定、GitHub、部署或正式首頁更動。requested `gpt-6.1-sol/max`；backend身分未獨立確認，沒有改模型、另開chat或委派。
