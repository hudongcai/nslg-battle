@echo off
cd /d E:\nslg-battle
echo === Git Status ===
git status --porcelain
echo.
echo === Git Remote ===
git remote get-url origin
echo.
echo === Pushing ===
git push https://ghp_IW8PPN8U4Nq7o70bs81F5ghi1xpHly3Hej1y@github.com/hudongcai/nslg-battle.git main 2>&1
echo.
echo === Done ===
pause
