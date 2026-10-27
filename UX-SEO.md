# 介面與搜尋資料：多張圖片合成 PDF

狀態：規格，尚未實作。Surface mode：Product App。M1 `noindex,nofollow`，不輸出 production canonical/sitemap；`image-pdf.glossquote.com` 是候選 URL，未發布前不得顯示為 live。

## 搜尋文案

**繁中 title：** 多張圖片合成 PDF｜排序、轉向、不裁切  
**繁中 description：** 在本機將 JPEG/PNG 照片依序放入 A4 或 Letter PDF，每張一頁，可旋轉並保留完整圖片，不需上傳。  
**繁中 H1：** 把照片整理成一份順序正確的 PDF

**English title:** Images to PDF | Order, Rotate, and Fit Photos to Pages  
**English description:** Turn local JPEG or PNG images into one ordered A4 or Letter PDF, one uncropped image per page, processed in your browser.  
**English H1:** Put your images into one ordered PDF

## 桌面工作區

```text
┌──────────── 多張圖片合成 PDF ─── zh-TW ── 尚未開始 ───────────┐
│ 頁面順序 / 來源 │                  頁面畫布                  │文件設定│
│ 1 receipt.jpg ↑↓│ ┌────────────────────────────────────────┐ │A4     │
│     3024×4032   │ │                                        │ │直向   │
│   [旋轉 90°]   │ │             第 1 頁預覽                │ │margin │
│ 2 page-2.png ↑↓ │ │         白邊；完整圖片不裁切           │ │28.35pt│
│     2000×1400   │ └────────────────────────────────────────┘ │        │
│   [旋轉 90°]   │ [加入 JPEG/PNG]  共2頁                     │        │
├─────────────────┴───────────────────────────────────────────┴────────┤
│ [產生 2 頁 PDF] → 狀態/進度             [下載 images-document.pdf]   │
└───────────────────────────────────────────────────────────────────────┘
```

## 手機工作區

```text
┌ 圖片合成 PDF ─ 狀態 ┐
│ [加入 JPEG/PNG]     │
│ A4 [直向] [橫向]    │
│ 1 receipt.jpg       │
│ [↑ 上移] [↓ 下移]   │
│ [旋轉 90°]          │
│ 2 page-2.png        │
│ [↑ 上移] [↓ 下移]   │
│ [旋轉 90°]          │
│ [產生 2 頁 PDF]     │
├─────────────────────┤
│ 頁面預覽／方向摘要  │
│ [下載 PDF]          │
└─────────────────────┘
```

排序和轉向按鈕與來源同列；畫布／頁面預覽是工作畫布。Advanced details 折疊顯示每檔 8 MiB、16 MP、20 張的界線；不能隱藏拒絕原因。下載按鈕需綁定目前 generation 的 PDF，stale 時移除。

## 狀態文案

Idle：「加入要合併的 JPEG 或 PNG；順序可在下一步調整。」；preflight：「先檢查 2 / 12 張的格式與尺寸，尚未解碼。」；ready：「12 張通過檢查，預計建立 12 頁 A4 PDF。」；decode：「正在處理第 2 / 12 張；每次只解碼一張。」；cancelling：「正在停止目前頁面，完成清理後不會提供 PDF。」；success：「PDF 已建立，共 12 頁。來源檔名與照片 metadata 未寫入 PDF。」；empty：「加入圖片後再建立 PDF。」；error：「第 4 張無法解碼；未建立部分 PDF。請移除該張或改用標準 JPEG/PNG。」；stale：「順序、方向或頁面設定已變；舊 PDF 已作廢。」；output cap：「產物超過 64 MiB，未提供下載。請減少頁數或先縮小來源圖片。」

## 無障礙

拖放可作便利但不作唯一排序方式；每張有上移、下移和旋轉按鈕，操作後 `aria-live` 只宣告新頁序。紙張選項使用有標籤的 radio/segmented controls；每頁旋轉按鈕文字含目前角度。保持明確鍵盤順序，44px touch controls、焦點可見、錯誤文字、對比≥4.5:1、reduced-motion。整頁在 320 CSS px 和 200% zoom reflow；預覽容器可局部縮放／捲動，主要操作不被遮擋。

## FAQ

### 繁體中文

**圖片會被裁切或放大嗎？** 不會裁切；會縮小到頁面可列印範圍並置中，剩餘位置留白。  
**照片方向會照相機方向嗎？** 工具先讀支援的 EXIF 方向，再套用你選的旋轉；瀏覽器解碼方向不符時會停止，不輸出錯向文件。  
**PDF 會留下檔名或 GPS 資料嗎？** 不會；檔名只在目前頁面顯示，PDF 只含重新編碼的頁面影像。

### English

**Will images be cropped or enlarged?** Images are fitted and centered without cropping; unused page area remains white.  
**Does it use the camera’s orientation?** It applies supported EXIF orientation first, then your rotation. A decoder mismatch stops the export.  
**Will the PDF contain filenames or GPS data?** No. Filenames stay in the page UI; the PDF contains re-encoded page images only.

## Browser gate

Node can validate layout math, fake JPEG payload length, object offsets and xref. It cannot prove Canvas creates a real decodable JPEG, that EXIF orientation is visually correct, or that an actual browser PDF viewer accepts the document. Those gates are **NOT_RUN_USER_FOCUS_INCIDENT** pending the primary’s isolated-browser decision. Do not open OS print/save dialogs.
