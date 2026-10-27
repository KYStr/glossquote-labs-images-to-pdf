# 產品需求：多張圖片合成 PDF

狀態：規格，尚未實作。使用者要把拍下來的申請文件／收據整理成可交付的 PDF；成功條件是頁數和順序可預期、方向可校正、影像完整不裁切。

## MVP 決策

- 最多 20 張 JPEG/PNG；每張 ≤8 MiB，來源總 bytes ≤64 MiB；每張 ≤16,000,000 pixels、任何邊 ≤8,192 px。先全選預檢，再開始解碼。
- 靜態 JPEG/PNG only；檔名、副檔名、`File.type` 不可信，讀 magic/header；拒 APNG/GIF/SVG/unknown/truncated/invalid EXIF。每張默認使用 EXIF visual orientation，並允許使用者額外以 90° 旋轉控制累加 0/90/180/270°。
- 紙張單一全域設定：A4 或 US Letter，直向／橫向；預設 A4 直向。固定 28.35 pt (10 mm) 四邊留白。圖片 contain-fit、居中、白底；不裁切。
- 解碼與 Canvas JPEG 編碼嚴格逐張進行，每次只有一個 ImageBitmap 和一個可重用工作 Canvas；bitmap 在取得頁面 JPEG 後一定 close。來源 `File` references 保留供重試，metadata 以小物件保存。PDF byte chunks 是累積輸出，不可同時留所有 source bitmaps。
- Canvas raster 尺寸 = orientation 後來源影像尺寸，加上使用者旋轉後交換寬高；上限仍是 16MP/8192 edge。Canvas 壓縮固定呼叫 `toBlob('image/jpeg',0.92)`；若瀏覽器不支援、回傳 null、JPEG MIME/簽章不符或無法於限制內建檔，整份失敗且清除 partial PDF。品質值屬瀏覽器建議值，輸出的實際 JPEG bytes 可能隨瀏覽器改變。
- PDF 固定版本 1.4、classic cross-reference table，不用 xref stream/object stream。每頁一個 DCTDecode JPEG image XObject 和一個 uncompressed content stream。所有 `stream /Length` 及 xref/startxref offset 都是 bytes，不是 JS string code units。PDF ≤64 MiB；超過不下載。
- 固定安全檔名 `images-document.pdf`；PDF 不寫入來源檔名、標題、作者、日期或 EXIF metadata。無加密、OCR、既有 PDF 合併、簽章或印表。
- 全部資料只留本頁記憶體；選圖變更、排序、紙張／方向或任一旋轉變更時 generation++、標 stale、清理舊 PDF／pending URLs。已開始交付給瀏覽器的下載不能撤回，UI 要如實說明。

## 功能需求

### FR-01：檔案預檢和尺寸 gate

選檔最多 20；每檔 8,388,608 bytes、總 67,108,864 bytes。先驗 signature 和 dimensions，不 decode，然後 pixel/edge bounds。JPEG 使用 bounded marker scan 至 SOF，解析 SOF dimensions 和 APP1 Exif orientation；PNG 要求 signature + IHDR，掃 chunk bounds、`eXIf` orientation 及 `acTL` animated marker。有 `acTL` 拒絕。Exif orientation 無值為 1，合法 1..8；malformed/矛盾 metadata 拒絕。所有來源都通過後才可繼續，超限／不支援列檔名和錯碼，不產半成品。

### FR-02：排序與方向調整

列表預設 input order，顯示序號、檔名文字、格式、來源 pixel size 和視覺方向；上移／下移按鈕排序。每圖 rotation 是 0°, 90°, 180°, 270° 順時針；點一次依序增加 90°，可再按到 0°。EXIF 方向先由瀏覽器 `from-image` decode，使用者旋轉再套用。任何改動立即標記 PDF stale 並禁用舊輸出。

### FR-03：紙張與 fit

紙張預設 A4 portrait，選項 A4/Letter × portrait/landscape。A4 portrait `595.28 × 841.89 pt`；Letter portrait `612 × 792 pt`；landscape 交換寬高。margin 各側 28.35pt。每 page 的 image oriented dimensions 為 `iw×ih`。`cw=pageW-2*margin`,`ch=pageH-2*margin`,`scale=min(cw/iw,ch/ih)`,`dw=iw*scale`,`dh=ih*scale`,`x=(pageW-dw)/2`,`y=(pageH-dh)/2`。PDF 座標使用左下原點；以 `q dw 0 0 dh x y cm /Im0 Do Q` 放圖，圖片不 crop。PDF 內數值以 decimal point、round to 2 fractional digits，避免浮點字串雜訊。

### FR-04：逐張產 JPEG 與 PDF

先全檔 preflight。按序只解一張 `ImageBitmap`; 驗 bitmap dimensions 和預期 EXIF orientation；將所需方向＋使用者 rotation 畫入 reusable Canvas，透明區先填白。`toBlob('image/jpeg',0.92)` 取得 JPEG bytes；檢查 MIME、`FF D8`/`FF D9` signatures 和 bytes limit；記住尺寸及 bytes 進 PDF builder，close bitmap 並把 canvas size 設回 0 再處理下一張。不可 `Promise.all`、不可把解碼圖像留在列表中。任一步取消／錯誤都清空所有已完成 JPEG page bytes 及 partial PDF。

### FR-05：PDF 1.4 結構與輸出

固定 object layout：1 Catalog、2 Pages；每頁連續三個 objects（Page、Image XObject、Contents），Page tree kids 順序等於使用者清單。Image XObject 的 `/Width`,`/Height` 取 JPEG pixel dimensions、`/ColorSpace /DeviceRGB`,`/BitsPerComponent 8`,`/Filter /DCTDecode`,`/Length n`；stream bytes 是 Canvas JPEG byte array。Contents 為 ASCII graphics operations，`/Length` 為其 ASCII bytes 長度。Writer 先記錄每個 object header 第一個 byte offset，輸出 classic `xref` free entry + 每物件固定 10 位 byte offset，`trailer /Size /Root`，`startxref` 指向 `xref` keyword 第一 byte，最後 `%%EOF`。總 PDF bytes ≤67,108,864。

成功後使用者下載唯一 PDF；UI 預覽每頁縮圖／rotation 和頁數，但不把 PDF 引擎加入本機。若瀏覽器沒有原生 PDF preview，提供 page summary，不假裝已驗讀。

### FR-06：狀態、取消、stale 和 cleanup

`idle → preflighting(i/n) → ready → decoding(i/n) → encoding(i/n) → writing-pdf → result`；錯誤 `blocked`/`failed`，變更 `stale`，取消 `cancelling → cancelled`。`createImageBitmap` 和 Canvas `toBlob` 無通用 signal；取消停止排隊並等待目前 operation 回來，close/discard 後不再處理下一張。每個 await/callback 後檢查 generation。source/settings 改變立即清 result/Blob/textures；pending image preview或下載 URL 全部撤銷。`finally` close bitmaps、canvas width/height=0、drop temp JPEG/PDF refs、revoke URLs；pagehide 和 reset 冪等。已開始的下載不能攔回，畫面不得宣稱取消既有下載。

## 錯誤碼與非目標

`TOO_MANY_FILES`、`FILE_TOO_LARGE`、`TOTAL_TOO_LARGE`、`UNSUPPORTED_FORMAT`、`ANIMATED_PNG`、`IMAGE_HEADER_INVALID`、`EXIF_INVALID`、`PIXEL_LIMIT`、`EDGE_LIMIT`、`DECODE_FAILED`、`ORIENTATION_MISMATCH`、`CANVAS_UNAVAILABLE`、`JPEG_ENCODE_FAILED`、`PDF_STRUCTURE_ERROR`、`OUTPUT_TOO_LARGE`、`CANCELLED`。非目標：PDF imports, OCR/text layer, encryption, password, signature, PDF/A, batch archives, printing, automatic email/submit, server-side conversion, quality judgement.
