import subprocess, sys, os

os.chdir('E:/nslg-battle')
token = 'ghp_IW8PPN8U4Nq7o70bs81F5ghi1xpHly3Hej1y'
repo = f'https://{token}@github.com/hudongcai/nslg-battle.git'

files = [
    'ocr-system.js',
    'cloud-sync.js',
    'index.html'
]

for f in files:
    r = subprocess.run(['git', 'add', f], capture_output=True, text=True)
    print(f'git add {f}: {r.returncode}')

msg = 'fix: cloudGetRecords路由修正/battles，字段映射云端→前端，OCR支持玩家名提取'
r = subprocess.run(['git', 'commit', '-m', msg], capture_output=True, text=True)
print('commit:', r.returncode, r.stdout[:200])

r = subprocess.run(['git', 'push', repo, 'main'], capture_output=True, text=True)
print('push:', r.returncode, r.stdout[:300], r.stderr[:200])
