import subprocess, time, sys, os

os.chdir('E:/nslg-battle')

def run_git(args, desc, retries=3):
    env = os.environ.copy()
    env['GIT_SSL_NO_VERIFY'] = 'true'
    env['GIT_TERMINAL_PROMPT'] = '0'
    for i in range(retries):
        print(f'[{desc}] 尝试 {i+1}/{retries}...')
        r = subprocess.run(
            ['git'] + args,
            capture_output=True, text=True,
            env=env
        )
        if r.returncode == 0:
            print(f'[{desc}] 成功!')
            print(r.stdout[:300])
            return True
        else:
            print(f'[{desc}] 失败 (code {r.returncode}):')
            print(r.stderr[:400])
            if i < retries - 1:
                wait = 3 * (i+1)
                print(f'等待 {wait}s 后重试...')
                time.sleep(wait)
    return False

# pull 最新
run_git(['pull', 'origin', 'main'], 'git pull')

# push
ok = run_git(['push', 'origin', 'main'], 'git push')
print('最终结果:', '成功' if ok else '失败')
