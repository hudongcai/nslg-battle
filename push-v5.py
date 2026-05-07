import subprocess, os

os.chdir('E:/nslg-battle')

# 临时禁用 SSL 验证（仅用于推送，推送后建议恢复）
env = os.environ.copy()
env['GIT_SSL_NO_VERIFY'] = 'true'

# 先 pull 一下避免冲突
print('=== git pull ===')
r = subprocess.run(['git', 'pull', 'origin', 'main'], 
                   capture_output=True, text=True, env=env)
print(r.stdout[:300])
print(r.stderr[:200])

# 推送
print('\n=== git push ===')
r = subprocess.run(['git', 'push', 'origin', 'main'],
                   capture_output=True, text=True, env=env)
print('returncode:', r.returncode)
print('stdout:', r.stdout[:500])
print('stderr:', r.stderr[:500])
print('=== DONE ===')
