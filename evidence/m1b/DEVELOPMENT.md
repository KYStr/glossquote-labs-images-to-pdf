# M1B 開發紀錄

- 進入時：完整讀取 `.runs/batch20-release-prep-2026-10-23/TASK.md`。59個受保護檔案快照已保存；13個public來源與M1凍結清單一致。沒有修改 public/dist/M1 evidence。
- 第一個 `prepareRelease()` 無寫檔 smoke command：exit 1，`RELEASE_HTML_INVALID`，定位為新 tokenizer 把 boolean attributes 之後的空白提前吃掉。修正 attributes scanner 以保留分隔，屬發布檢查器內修正；未變更原HTML或runtime。後續以新 release tests 驗證，不改舊產品測試。
- 修正後 `prepareRelease()` smoke：exit 0，16個候選資產／13個來源，未寫site。`node --test test/release.test.mjs` exit 0，12/12 PASS、0 skipped；所有負例只操作 test/.release-* 自建副本，刪除前核對絕對父目錄與隨機basename，沒有對真public/dist/root做污染負例。
