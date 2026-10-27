# 必須由主代理補驗的真瀏覽器項目

本檔所有項目狀態皆為 **NOT_RUN_USER_FOCUS_INCIDENT**。本次未啟動 server/browser/CDP、未用 CUA/IAB/hidden tabs、未擷取螢幕、未控制 native dialogs／鍵鼠／焦點／IME／剪貼簿。Node fake DOM / fake bitmap / fake Canvas 與 offline handler tests 不等於瀏覽器證據。

主代理先確認不會取用使用者桌面輸入的隔離機制，才可另外執行以下 gates。本候選沒有豁免 gate，也未獲 M2 放行。

|必驗能力|獨立觀察／預期|狀態|
|---|---|---|
|Native JPEG/PNG decode 與 Canvas JPEG|產生小型 synthetic PNG/JPEG，實際 toBlob MIME=image/jpeg、FF D8/FF D9、再 decode 其 JPEG，尺寸和可見圖案正確|NOT_RUN_USER_FOCUS_INCIDENT|
|EXIF orientation 1–8|非對稱四角標記；檢查正常、鏡像、轉置／旋轉與額外 0/90/180/270°，不能只測寬高|NOT_RUN_USER_FOCUS_INCIDENT|
|透明 PNG 白底|透明像素輸出為白色；JPEG 成像可讀|NOT_RUN_USER_FOCUS_INCIDENT|
|Actual PDF viewer|原生 Canvas 生成 JPEG，再輸出兩來源兩頁 PDF。A4/Letter 直橫向皆無裁邊、順序／閱讀方向／留白正確；PDF viewer 真正開啟|NOT_RUN_USER_FOCUS_INCIDENT|
|取消／過期輸出／失敗恢復|在實際 decode/toBlob pending 時取消／變更設定／清除，不提供 partial 或舊 PDF；移除錯誤來源後可重試|NOT_RUN_USER_FOCUS_INCIDENT|
|下載／URL cleanup|只在明確按下載時產生 Blob URL；固定 images-document.pdf；更改即失效、60秒或 pagehide 撤銷；不觸發 OS print/save dialogs|NOT_RUN_USER_FOCUS_INCIDENT|
|鍵盤與朗讀|兩語皆能上移／下移／轉向／選紙張／取消／重試；焦點可見、順序合理，變動／錯誤正確宣告|NOT_RUN_USER_FOCUS_INCIDENT|
|320px／200% zoom／長檔名／reduced motion|主要操作可達，無全頁橫向溢出或遮擋，長譯文可換行，實際對比及目標尺寸符合契約|NOT_RUN_USER_FOCUS_INCIDENT|
|Network／Storage／headers|實際頁面無使用者內容外送、無儲存／service worker／外部字型／追蹤；實際載入 headers 與 CSP 正確。只看 source regex 不足|NOT_RUN_USER_FOCUS_INCIDENT|

真機手機、原生檔案選擇／儲存／列印對話框均未測；印表不屬產品範圍。不能使用本機輸入環境試驗隔離，亦不可自行安裝新服務或擴權。
