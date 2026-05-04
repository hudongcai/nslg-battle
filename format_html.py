import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 在 >< 之间加换行（保留<script>内容）
lines = content.split('\n')
output = []
in_script = False
for line in lines:
    if '<script' in line and '</script>' not in line:
        in_script = True
    if not in_script:
        line = line.replace('><', '>\n<')
    output.append(line)
    if '</script>' in line:
        in_script = False

with open('index_new.html', 'w', encoding='utf-8') as f:
    f.write('\n'.join(output))

print('格式化完成 -> index_new.html')
