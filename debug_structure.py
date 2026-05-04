# Read HTML and find structure
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()
    lines = content.split('\n')

# Find key lines
for i, line in enumerate(lines):
    stripped = line.strip()
    if any(k in line for k in ['tab-datamgmt', 'tab-rolemanage', 'tab-dataperm', '关闭 card', '关闭 padding', '关闭 tab-datamgmt', '关闭 mainApp', 'loginOverlay', 'mainApp', 'padding:0 40px', 'padding:20px']):
        print(f"Line {i+1}: {repr(line)}")
