# 多張圖片合成 PDF

**English:** Images to PDF  
**狀態：** 產品規格，尚未實作。

## 你要完成的工作

申請資料、收據或掃描頁散在多張照片裡，交件時需要一份順序正確、每張一頁、不裁邊的 PDF。使用者選圖、重排、必要時每張旋轉 90°，選 A4 或 Letter 後下載單一 PDF。

MVP 一句話：在本機把最多 20 張 JPEG/PNG 依順序各自放進一頁白底紙張，保留長寬比並輸出不含來源檔名／metadata 的 PDF 1.4。

## 為什麼有用

它把「多張來源照片 → 按順序檢查方向 → 選紙張 → 一圖一頁 → 可交付 PDF」做成一次完整交付。它不是 PDF 編輯器、OCR 或掃描品質判斷器；不會合併既有 PDF，也不會偷偷傳檔。

## 環境與難度

需要支援 JPEG/PNG 解碼、Canvas JPEG 編碼的現代瀏覽器；Node.js 24+ 僅做純位元組 PDF 結構測試/build。原生 HTML/CSS/ESM、runtime 零套件，無 API、帳戶、上傳。高難度：Canvas 壓縮輸出、PDF binary bytes、stream length 和 xref offset 必須一致。

## 不包含

- 不讀既有 PDF，不 OCR、不加文字層、電子簽章、加密或 PDF/A。
- 不提供自訂頁面尺寸／邊界／濾鏡；不裁圖或另存原始照片。
- 不保留 EXIF/GPS、原檔名、日期、相機或作者 metadata。
- 不列印、不開 OS dialog、不提供雲端轉換。

## 閱讀順序

[產品需求](PRODUCT.md) → [技術契約](TECHNICAL.md) → [介面與搜尋資料](UX-SEO.md) → [驗收 oracle](ACCEPTANCE.md) → [實作順序](TASKS.md)。共用規則見 `docs/BRAND.md`、`docs/ENGINEERING.md`、`docs/PRIVACY-SECURITY.md`、`docs/DESIGN-SYSTEM.md`。

English summary: Put up to 20 local JPEG or PNG images into one ordered PDF, one uncropped image per A4 or Letter page. Rotate pages when needed; the browser builds the file locally without adding source names or metadata.
