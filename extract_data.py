import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 提取 ALL_HEROES 数组
hero_start = content.find('const ALL_HEROES')
if hero_start == -1:
    print('未找到 ALL_HEROES')
else:
    # 找到数组开始位置
    array_start = content.find('[', hero_start)
    # 简单提取（找到匹配的右括号）
    depth = 0
    i = array_start
    while i < len(content):
        if content[i] == '[':
            depth += 1
        elif content[i] == ']':
            depth -= 1
            if depth == 0:
                hero_end = i + 1
                break
        i += 1
    heroes_str = content[array_start:hero_end]
    with open('data_heroes.js', 'w', encoding='utf-8') as f:
        f.write('const ALL_HEROES = ' + heroes_str + ';')
    print(f'已提取 ALL_HEROES 到 data_heroes.js ({len(heroes_str)} 字符)')

# 提取 ALL_TACTICS 数组
tactic_start = content.find('const ALL_TACTICS')
if tactic_start == -1:
    print('未找到 ALL_TACTICS')
else:
    array_start = content.find('[', tactic_start)
    depth = 0
    i = array_start
    while i < len(content):
        if content[i] == '[':
            depth += 1
        elif content[i] == ']':
            depth -= 1
            if depth == 0:
                tactic_end = i + 1
                break
        i += 1
    tactics_str = content[array_start:tactic_end]
    with open('data_tactics.js', 'w', encoding='utf-8') as f:
        f.write('const ALL_TACTICS = ' + tactics_str + ';')
    print(f'已提取 ALL_TACTICS 到 data_tactics.js ({len(tactics_str)} 字符)')

print('提取完成')
