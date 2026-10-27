# 結構測試產物

writer-structure-only.pdf 是本次 writer 實際輸出的 PDF 位元組，有兩頁和精確 xref/stream framing。內嵌的是兩段 6-byte opaque fake JPEG payload，不是可解碼圖片，不適合用來檢查照片或 viewer 相容性。不要以此檔代表 Canvas JPEG/PDF viewer PASS。

真 Canvas、EXIF 鏡像/旋轉、透明白底、實際 PDF viewer、下載與視覺/Network/Storage 驗收：NOT_RUN_USER_FOCUS_INCIDENT。結構與 hash 見 structure-report.json。
