# 涓夎皨鎴樻姤绯荤粺 (nslg-battle) 鈥?椤圭洰涓婁笅鏂?
鍚姩锛歚node nslg-backend.js`锛堟垨 `./start-local.ps1` / `start-local.bat`锛? 
鎴浘宸ュ叿锛歚C:\AutoScreenshotTool2`锛堜笌鎴樻姤绯荤粺閰嶅锛屾埅鍥锯啋鍒嗘瀽锛屼竴閿敤 start-local 鍚屾椂鍚姩锛? 
璁块棶锛歨ttp://localhost:8080 | 瓒呯锛歚13651810449` / `hu6956521`

## 鏋舵瀯

```
鍓嶇锛圙itHub Pages: www.zhenwu.fun锛?  鈹斺攢 cloud-sync.js 鈫?API
        鈹溾攢 鏈湴: http://localhost:3000/api
        鈹斺攢 鐢熶骇: https://api.zhenwu.fun/api  鈫?Cloudflare 闅ч亾

鍚庣: nslg-backend.js (Express, port 3000)
  鈹斺攢 MySQL: localhost:3306 / nslg_battle锛堢敤鎴? nslg-battle-server / hu6956521锛?
Cloudflare 闅ч亾: bb55729a 鈫?api.zhenwu.fun 鈫?127.0.0.1:3000
hosts鏂囦欢: 127.0.0.1 api.zhenwu.fun锛堟湰鏈哄紑鍙戠粫杩囷級
```

## 鏁版嵁搴?
鍏抽敭琛細`users`(鍚?credit_balance 瀛楁), `roles`, `projects`, `battle_records`(鍚獼SON generals/tactics), `battle_gallery`, `ocr_tasks`  
娉ㄦ剰锛歚user_credits` 琛ㄥ凡搴熷純锛岀Н鍒嗗瓧娈靛湪 `users.credit_balance`銆? 
`battle_records` 鍙屾牸寮忓苟瀛橈細鏂扮増 JSON 瀛楁锛坄left_generals`/`right_generals`/`left_tactics` 绛夛級+ 鏃х増骞抽摵瀛楁锛坄left_general_1` 绛夛級銆?
## 鍏抽敭鏂囦欢

| 鏂囦欢 | 璇存槑 |
|---|---|
| `nslg-backend.js` | 瀹屾暣鍚庣锛屽惈璁よ瘉銆佹墍鏈堿PI |
| `cloud-sync.js` | 鍓嶇浜戠鍚屾锛屽惈 CLOUD_API_BASE 鍒ゆ柇 |
| `ocr-system.js` | OCR 鍓嶇瑙ｆ瀽閾捐矾 |
| `ocr_paddle_service.py` | PaddleOCR 鍚庣鏈嶅姟 |
| `data-system.js` | 鏁版嵁绠＄悊鍓嶇閫昏緫 |
| `user-system.js` | 鐢ㄦ埛绠＄悊鍓嶇閫昏緫 |

## API 鍝嶅簲鏍煎紡

鎵€鏈夋帴鍙ｇ粺涓€锛歚{ code: 200, data: [...] }`锛坉ata 鐩存帴鏄暟缁勶紝**涓嶆槸** `data.list`锛?
## 鈿狅笍 鍏抽敭绾︽潫锛堜慨鏀瑰墠蹇呰锛?
**OCR 瑙ｆ瀽**
- 鐜╁鍚嶄腑鐨?`|` 鏄悎娉曞垎闅旂锛堝"钄疯枃|浜戝垵鏈?锛夛紝**绂佹**鍦ㄤ换浣曞湴鏂?strip 鎴?split 瀹?- 鎴樻硶鍒楁槸鍥哄畾妲戒綅锛堟Ы1/妲?/妲?锛夛紝绌烘Ы蹇呴』淇濈暀浣嶇疆锛?*绂佹**鍘嬬缉绉讳綅
- OCR 璇嗗埆鍒扮殑姝﹀皢/鎴樻硶锛氬乏鍙充袱渚у垎寮€澶勭悊锛屽彸渚ф灏嗚瘑鍒€昏緫鐙珛锛?*涓嶅叡鐢?*宸︿晶閫昏緫

**鏁版嵁鍚屾**
- MySQL 鏄敮涓€鏁版嵁婧愶紝IndexedDB 鏄彧璇荤紦瀛橈紱鍚屾鏂瑰悜姘歌繙鏄?MySQL 鈫?IndexedDB锛?*绂佹鍙嶅悜鍐欏叆**
- 鍓嶇娓叉煋浼樺厛浣跨敤 cloudUsers锛圡ySQL 鏉ユ簮锛夛紝涓嶇粫閬?IndexedDB 缂撳瓨

**鏃ユ湡澶勭悊**
- MySQL 杩炴帴蹇呴』淇濇寔 `dateStrings: true`锛屽惁鍒?DATE/DATETIME 琚?JS Date 搴忓垪鍖栦负 UTC 瀵艰嚧鏃ユ湡鍋忕Щ
- 鍓嶇灞曠ず鏃ユ湡缁熶竴鐢?`created_at` 瀛楁锛?*涓嶇敤** `battleDate`

**鍚庣**
- 鍞竴鐢熶骇鍚庣鏄?`nslg-backend.js`锛宍server.js` 鏄?GitHub 灞曠ず鐢ㄧ殑绠€鍖栫増锛?*鍕跨敤浜庣敓浜?*
- PowerShell 涓嶆敮鎸?`<` 鏂囦欢閲嶅畾鍚戯紝鎵ц SQL 鏂囦欢鐢?Bash tool

## 寮€鏈鸿嚜鍚紙Windows 璁″垝浠诲姟锛?
- `nslg-battle-backend`锛氱櫥褰曟椂杩愯 `node nslg-backend.js`
- `nslg-battle-cloudflared`锛氱櫥褰曟椂杩愯 cloudflared 闅ч亾

## 鍙戝竷娴佺▼

```bash
git add <淇敼鐨勬枃浠?
git commit -m "鎻忚堪"
git push   # 瑙﹀彂 GitHub Actions 鑷姩閮ㄧ讲鍒?GitHub Pages
```

褰撳墠鐗堟湰 V1.7锛屽姛鑳藉畬鏁淬€?
## 宸ヤ綔瑙勮寖

**闇€姹傜‘璁?*
- 鏀跺埌鍔熻兘闇€姹傚悗锛屽厛涓庣敤鎴风‘璁ょ悊瑙ｆ槸鍚︽纭紝鍐嶅姩鎵嬪疄鐜?- 鏈夋涔夋垨璁捐閫夋嫨鏃讹紝鍒楀嚭鏂规璁╃敤鎴烽€夋嫨锛屼笉鑷鍐冲畾

