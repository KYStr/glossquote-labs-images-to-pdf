# 驗收 oracle：多張圖片合成 PDF

狀態：規格，尚未實作。離線 writer tests 使用程式合成的 header 和 opaque fake image payload，真實 Canvas/decoder/PDF-viewer 效果另列 browser gate，不能混為一談。

## Node 可自動驗證的 oracle

1. **A01 FR-01 count boundary** — 20 合成檔通過數量 gate；21 檔 `TOO_MANY_FILES` 且解碼呼叫數為0。
2. **A02 FR-01 per-file size** — 8,388,608 bytes 接受 metadata preflight；8,388,609 `FILE_TOO_LARGE`，未 decode。
3. **A03 FR-01 total size** — 20 個合計 67,108,864 bytes 通過大小門；多1 byte `TOTAL_TOO_LARGE`。
4. **A04 FR-01 signature** — 合法 PNG signature+IHDR 與 JPEG SOI+bounded SOF 可讀 dimensions；`<svg>` 假裝 `.jpg` / `image/jpeg` 仍 `UNSUPPORTED_FORMAT`。
5. **A05 FR-01 APNG** — PNG chunks 有 `acTL`；`ANIMATED_PNG`，Canvas decode 呼叫數0。
6. **A06 FR-01 pixels** — 4000×4000 exactly 16,000,000 pixels passes; 4001×4000 rejects `PIXEL_LIMIT`; 8193×1 rejects `EDGE_LIMIT`。
7. **A07 FR-01 EXIF** — raw 4000×3000 orientation6 => visual 3000×4000；0、9、out-of-bounds IFD、bad endian reject `EXIF_INVALID`。
8. **A08 FR-02 ordering/rotation** — 3 source IDs `[A,B,C]` after move C up become `[A,C,B]`; C rotation 90→180; serialized page specs retain that exact order/turn count。
9. **A09 FR-03 A4 exact fit** — page 595.28×841.89pt, margin28.35; image1000×500 -> content538.58×785.19; scale0.53858; drawn538.58×269.29 at x28.35,y286.30 after 2-decimal emission.
10. **A10 FR-03 Letter landscape** — Letter portrait612×792 swapped => page792×612; 100×200 image fits in 735.30×555.30 content with computed contain scale and centered x/y; no negative coordinates.
11. **A11 FR-05 pages** — two fake page payloads -> Pages `/Count 2`, Kids `[3 0 R 6 0 R]`, two Page objects; order matches caller sequence.
12. **A12 FR-05 JPEG stream length** — fake binary payload `[FF,D8,00,0A,FF,D9]` embedded byte-for-byte; `/Length 6`; newline/zero bytes do not change object boundary. This verifies writer framing only, not a decodable JPEG.
13. **A13 FR-05 content length** — one page's ASCII stream `q\n538.58 0 0 269.29 28.35 286.30 cm\n/Im0 Do\nQ\n`; `/Length` equals exact ASCII encoded byte count.
14. **A14 FR-05 xref byte offsets** — insert fake JPEG containing non-ASCII bytes `FF D8 80 00 FF D9`; parse each xref offset and assert the referenced exact bytes are `${id} 0 obj`; offsets must not equal JS UTF-16 character counts.
15. **A15 FR-05 startxref** — decimal after `startxref` points to first byte of `xref`; trailer `/Size` is object count+1, `/Root 1 0 R`, last marker `%%EOF`.
16. **A16 FR-05 no source strings** — filename `secret-gps-name.jpg` and fake EXIF GPS payload never appear in PDF bytes; PDF only contains fixed names/numeric content and JPEG bytes.
17. **A17 FR-05 output cap** — final PDF exactly 67,108,864 bytes accepted; one more byte `OUTPUT_TOO_LARGE`, no download Blob.
18. **A18 FR-06 sequential bitmap lifetime** — three fake decode operations show max active=1; each bitmap `close()` and canvas reset happen before next decode starts.
19. **A19 FR-06 pending cancellation** — cancel during decode/toBlob; one in-flight operation settles, bitmap closes, no next file starts, partial jpeg pages are dropped and no PDF returns.
20. **A20 FR-06 stale generation** — change page orientation while old toBlob callback pending; late callback cannot overwrite current state or create a downloadable Blob URL.

## 必須真瀏覽器 gates：目前 NOT_RUN

產生小型 synthetic PNG/JPEG with Canvas，確認 `toBlob('image/jpeg',0.92)` 回 Blob MIME 和 JPEG signature、再用 `createImageBitmap` 驗其可解碼與尺寸。加入 orientation 1–8 asymmetric fixtures、旋轉、透明 PNG 白底、A4/Letter page order，確認實際 PDF 可由 browser viewer 開啟且所有頁面清晰完整。另驗取消/切設定競態、input ordering keyboard、320px/200% zoom、download、no outbound request。這組 **NOT_RUN_USER_FOCUS_INCIDENT**：不得用 fake JPEG Node writer tests 說明 Canvas/PDF browser PASS；不觸發 OS print/save dialog。
