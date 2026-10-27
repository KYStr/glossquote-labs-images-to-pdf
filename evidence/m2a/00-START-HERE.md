# B20-46-M2A

狀態：**發布候選準備 PASS；等待主代理 M2B。未 push／deploy。** 最新產品與限制以 [HANDOFF](../../HANDOFF.md) 的 M2A 追加節為準。

|檢查|結果|
|---|---|
|受影響 release/config 測試|21/21 PASS|
|check → build:release → check:release|全部 exit 0|
|主代理既有隔離 Chromium 145|32 PASS／10 NOT_RUN／0 FAIL；prohibited=[]；最後 cleanup PASS|
|持久環境 guard 完整 Snapshots|前後 PASS、完全相同|

先看 [source.diff](source.diff) 與 [release.diff](release.diff)，再以 [source-changes](source-changes.json)、[sources-final](sources-final.json)、[artifacts-final](artifacts-final.json)、[FREEZE](FREEZE.json) 核對完整 SHA。兩語 release HTML 只移除精確 footer 的候選字樣，其他 HTML bytes 與舊 release 相同；全部 public/runtime、dist、舊 evidence 保持不變。新 `_redirects` 三行 LF＋末尾 LF，列入閉合 manifest。Worker 設定逐 byte 等於 42 模板僅替換 name/domain，見 [release-delta-proof](release-delta-proof.json)。

舊 release 的 17 檔完整保存在 [previous-release-artifacts](previous-release-artifacts/manifest.json)，原 manifest SHA `b89031e973e6b0ba6aa54b2bfe2f8852e19217c669816598a82f7d645d16184a` 未變；見 [preservation](previous-release-preservation.json)。新 manifest SHA `b5b5b9f08c7821c39554098ca95a59945a5840030d54768124f52739b8027f59`，site 17 檔＋manifest 共 18 檔。舊 M1B freeze 仍描述舊版本，沒有覆寫其證據。

原始命令紀錄見 [final-commands](final-commands.json)。[browser-acceptance-reference](browser-acceptance-reference.json) 記錄主代理 RUN 的相對 repository 路徑與原收據 SHA；M2A 沒有另跑 browser，原 RUN 由主代理保留並在整合交付時納入所需證據。10 個 NOT_RUN 與 raw-byte MIME 子斷言維持原狀。Cloudflare runtime／live HTTP、公開 source、首頁與外部驗收均未執行。原 49 項未變的產品測試沿用 M1B；這輪未重跑 full npm test。

配置依主代理指定採用 42 的 assets-only 格式與 `2026-10-24`，所有觀測／metrics 關閉；優先於 skill 的一般建議。只讀核對的 Cloudflare 官方文件：[HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/)、[redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)。`none` 關閉內建 HTML handling，redirects 由靜態資產目錄中的 `_redirects` 宣告；這些文件與靜態檢查不構成本候選已在 Cloudflare 實際工作的證據。
