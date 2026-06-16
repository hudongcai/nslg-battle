#!/usr/bin/env python3
"""
战报 OCR 服务（基于 RapidOCR ONNX，Python 3.12 兼容）
端口: 8003
启动: python ocr_paddle_service.py
"""

import json, base64, io, re, os
import numpy as np
from PIL import Image
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from rapidocr_onnxruntime import RapidOCR

# ── 加载游戏数据 ──────────────────────────────────────────────────────
_here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_here, 'game-data.json'), encoding='utf-8') as f:
    _gd = json.load(f)

HERO_NAMES   = _gd['heroNames']    # 108 武将名
ALL_TACTICS  = _gd['allTactics']   # 238 合法战法名
FORMATIONS   = ['一字阵','箕形阵','雁形阵','方圆阵','锥形阵','鱼鳞阵','钩行阵','偃月阵']
WINNERS      = {'胜', '败', '平'}
WINNER_MAP   = {'胜': 'left', '败': 'right', '平': 'draw'}

# ── RapidOCR 初始化 ───────────────────────────────────────────────────
print("初始化 RapidOCR ...")
_ocr = RapidOCR()
print("✅ RapidOCR 就绪")

app = FastAPI(title="战报 OCR 服务")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── 编辑距离 ─────────────────────────────────────────────────────────
def levenshtein(a: str, b: str) -> int:
    m, n = len(a), len(b)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            temp = dp[j]
            dp[j] = prev if a[i-1] == b[j-1] else 1 + min(prev, dp[j], dp[j-1])
            prev = temp
    return dp[n]

def best_match(text: str, candidates: list):
    """返回 (最佳匹配词, 编辑距离)"""
    best, bd = '', 9999
    for c in candidates:
        d = levenshtein(text, c)
        if d < bd:
            bd, best = d, c
            if d == 0:
                break
    return best, bd

def match_hero(text: str):
    text = re.sub(r'^\d+', '', text).strip()   # 去掉前缀等级数字
    if len(text) < 2 or len(text) > 5:
        return None
    name, dist = best_match(text, HERO_NAMES)
    # 2字名要求完全匹配，防止同盟短码（如"逸云"）被误识别为武将（如"赵云"）
    threshold = 0 if len(text) == 2 else 1
    return name if dist <= threshold else None

def match_tactic(text: str):
    text = re.sub(r'^影本[·.•]', '', text).strip()      # 去影本·前缀
    text = re.sub(r'[×xX※]\d+.*$', '', text).strip()   # 去×N/XN/※N触发次数后缀
    if len(text) < 2 or len(text) > 6:
        return None
    name, dist = best_match(text, ALL_TACTICS)
    threshold = 1 if len(name) <= 4 else 2
    return name if dist <= threshold else None

def match_formation(text: str):
    name, dist = best_match(text, FORMATIONS)
    return name if dist <= 1 else None


# ── OCR ──────────────────────────────────────────────────────────────
def run_ocr(img_array):
    """运行 RapidOCR，返回带坐标文字块列表"""
    result, _ = _ocr(img_array)
    blocks = []
    if not result:
        return blocks
    for line in result:
        bbox, text, conf = line
        # bbox: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        x1, y1, x2, y2 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
        blocks.append({
            'text': str(text).strip(),
            'x': x1, 'y': y1,
            'w': max(1, x2 - x1),
            'h': max(1, y2 - y1),
            'conf': round(float(conf), 3),
        })
    return blocks

def cx(b): return b['x'] + b['w'] // 2
def cy(b): return b['y'] + b['h'] // 2


# ── 布局分析 ─────────────────────────────────────────────────────────
def extract_labeled(blocks, label):
    """从'标签：值'格式块提取值"""
    for b in blocks:
        m = re.search(re.escape(label) + r'[：:]\s*(.+)', b['text'])
        if m:
            return m.group(1).strip()
    return ''

def find_number_near(blocks, label, max_dx=300, max_dy=25):
    """在 label 锚点右侧/下方找最近纯整数"""
    # 先尝试同块内 "标签：N" 格式
    for b in blocks:
        m = re.search(re.escape(label) + r'[：:]\s*(\d+)', b['text'])
        if m:
            return int(m.group(1))
    # 再找锚点块 + 临近数字块
    anchor = next((b for b in blocks if label in b['text']), None)
    if not anchor:
        return 0
    ax, ay = cx(anchor), cy(anchor)
    best, bd = 0, 9999
    for b in blocks:
        if not re.match(r'^\d{2,6}$', b['text']):
            continue
        bx_, by_ = cx(b), cy(b)
        if bx_ <= ax:
            continue
        dx, dy = bx_ - ax, abs(by_ - ay)
        if dx <= max_dx and dy <= max_dy:
            d = dx + dy * 3
            if d < bd:
                bd, best = d, int(b['text'])
    return best

def extract_troops(blocks):
    """总兵力：左侧格式=总兵/剩余，右侧格式=剩余/总兵，两边取较大值均得总兵"""
    # 1. 整块含斜杠，两种格式均取较大值
    for b in blocks:
        m = re.search(r'(\d{1,6})/(\d{1,6})', b['text'])
        if m:
            return max(int(m.group(1)), int(m.group(2)))
    # 2. OCR 分成两块：同行紧邻数对，取较大值
    num_blocks = sorted(
        [b for b in blocks if re.match(r'^\d{1,6}$', b['text'])],
        key=lambda b: (b['y'], b['x'])
    )
    for i in range(len(num_blocks) - 1):
        a, nb = num_blocks[i], num_blocks[i + 1]
        gap = nb['x'] - (a['x'] + a['w'])
        if abs(cy(a) - cy(nb)) < 25 and 0 <= gap < 120:
            return max(int(a['text']), int(nb['text']))
    return 0

def assign_to_columns(tac_blocks, hero_xs):
    """按 x 距离将战法归属到最近的武将列，每列按 y 排序。
    如果英雄列分配不均衡（某列为空），则回退到 x 聚类分配。"""
    cols = [[] for _ in hero_xs]
    for tb in tac_blocks:
        col = min(range(len(hero_xs)), key=lambda i: abs(cx(tb) - hero_xs[i]))
        cols[col].append(tb)

    # 检测分配质量：如果某列为空而其他列溢出，说明 hero_xs 不准，回退聚类
    col_lens = [len(c) for c in cols]
    if any(cl == 0 for cl in col_lens) and len(tac_blocks) >= 3:
        # 用战术块 x 坐标做 3-means 聚类
        xs = sorted([cx(tb) for tb in tac_blocks])
        # 简单分位数分割
        n = len(xs)
        cuts = [xs[int(n * 1/6)], xs[int(n * 3/6)], xs[int(n * 5/6)]]
        cols = [[] for _ in range(3)]
        for tb in tac_blocks:
            col = min(range(3), key=lambda i: abs(cx(tb) - cuts[i]))
            cols[col].append(tb)

    result = []
    for col in cols:
        col.sort(key=lambda b: b['y'])
        result.append([t['matched'] for t in col[:3]])
    return result

def process_side(blocks, side, img_h):
    """处理单侧所有文字块，返回该侧结构化数据"""
    hero_blocks, tac_blocks = [], []
    formation = '未知'

    for b in blocks:
        text = b['text'].strip()
        if not text:
            continue
        if text in WINNERS:
            continue

        # 阵型
        fm = match_formation(text)
        if fm:
            formation = fm
            continue

        # 武将（上半区优先，但下半区也接受，防止漏检）
        hero = match_hero(text)
        if hero:
            hero_blocks.append({**b, 'matched': hero})
            continue

        # 战法（去除×统计后再匹配）
        tac = match_tactic(text)
        if tac:
            tac_blocks.append({**b, 'matched': tac})

    # 武将：按 x 排序，取最左3个
    hero_blocks.sort(key=lambda b: b['x'])
    # 去重：同一位置可能重复识别到同一名字
    seen_heroes = []
    for hb in hero_blocks:
        if not any(abs(cx(hb) - cx(sh)) < 40 and hb['matched'] == sh['matched'] for sh in seen_heroes):
            seen_heroes.append(hb)
    hero_blocks = seen_heroes[:3]

    generals = [h['matched'] for h in hero_blocks]
    hero_xs  = [cx(h) for h in hero_blocks]

    # 补足3个武将（未知占位）
    while len(generals) < 3:
        gap = hero_xs[-1] + 120 if hero_xs else 120
        generals.append('未知')
        hero_xs.append(gap)

    # 战法：去重后分列
    seen_tacs = []
    for tb in tac_blocks:
        if not any(abs(cy(tb) - cy(st)) < 15 and tb['matched'] == st['matched'] for st in seen_tacs):
            seen_tacs.append(tb)
    cols = assign_to_columns(seen_tacs, hero_xs)

    tactics = []
    for col in cols:
        padded = col[:3]
        while len(padded) < 3:
            padded.append('未知')
        tactics.extend(padded)

    # 数值字段
    damage = find_number_near(blocks, '战损', 300, 30)
    troops = extract_troops(blocks)

    # 玩家名 / 同盟名：尝试标签格式，再按位置猜测
    player   = extract_labeled(blocks, '玩家') or extract_labeled(blocks, 'player')
    alliance = extract_labeled(blocks, '同盟') or extract_labeled(blocks, 'alliance')
    if not player:
        # 取上方区域（y < 35%）非已分类文字，按 x 排序
        # 左侧：玩家在左（x小），同盟在右（x大）
        # 右侧：同盟在左（x小），玩家在右（x大）
        top_texts = sorted(
            [b for b in blocks
             if b['y'] < img_h * 0.35
             and not match_hero(b['text'])
             and not match_tactic(b['text'])
             and not match_formation(b['text'])
             and b['text'] not in WINNERS
             and not re.match(r'^[\d×/：:]+$', b['text'])
             and not re.search(r'战损|总兵|补给|战果|图表|统计|详情|战报', b['text'])
             and not re.match(r'^S\d+$', b['text'], re.IGNORECASE)
             and 2 <= len(b['text']) <= 12],
            key=lambda b: b['x']
        )
        print(f"[DEBUG {side}] top_texts: {[b['text'] for b in top_texts]}")
        if side == 'left':
            if len(top_texts) >= 1: player   = top_texts[0]['text']    # 最左 = 玩家
            if len(top_texts) >= 2: alliance = top_texts[-1]['text']   # 最右 = 同盟全名（跳过中间短码）
        else:
            if len(top_texts) >= 1: player   = top_texts[-1]['text']  # 最右 = 玩家
            if len(top_texts) >= 2: alliance = top_texts[0]['text']   # 最左 = 同盟

    return {
        f'{side}Generals':  generals,
        f'{side}Tactics':   tactics,
        f'{side}Damage':    damage,
        f'{side}Troops':    troops,
        f'{side}Formation': formation,
        f'{side}Player':    player,
        f'{side}Alliance':  alliance,
    }

def analyze_battle(blocks, img_w, img_h):
    # 找胜负字符定中线
    center_x = img_w / 2
    winner   = 'unknown'
    for b in blocks:
        if b['text'] in WINNERS:
            winner   = WINNER_MAP[b['text']]
            center_x = cx(b)
            break

    margin      = img_w * 0.06
    left_blocks  = [b for b in blocks if cx(b) < center_x - margin]
    right_blocks = [b for b in blocks if cx(b) > center_x + margin]

    left  = process_side(left_blocks,  'left',  img_h)
    right = process_side(right_blocks, 'right', img_h)

    # 日期
    battle_date = ''
    for b in blocks:
        m = re.search(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}', b['text'])
        if m:
            battle_date = m.group(0)
            break

    return {**left, **right, 'winner': winner, 'battleDate': battle_date}


# ── API ──────────────────────────────────────────────────────────────
class OcrRequest(BaseModel):
    image: str  # base64（不含 data:xxx;base64, 前缀）

@app.get('/health')
def health():
    return {'status': 'ok', 'engine': 'rapidocr-onnxruntime'}

@app.post('/ocr')
def paddle_ocr(req: OcrRequest):
    try:
        # 兼容带 data:url 前缀的 base64
        b64 = re.sub(r'^data:[^;]+;base64,', '', req.image)
        img_bytes = base64.b64decode(b64)
        img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        img_arr = np.array(img)

        blocks = run_ocr(img_arr)
        record = analyze_battle(blocks, img.width, img.height)

        # 始终记录调试日志（开发阶段）
        import time as _time
        log_entry = {
            'ts': _time.strftime('%Y-%m-%d %H:%M:%S'),
            'w': img.width, 'h': img.height,
            'blocks': blocks,
            'result': record
        }
        log_path = os.path.join(_here, 'ocr_debug.log')
        with open(log_path, 'a', encoding='utf-8') as lf:
            lf.write(json.dumps(log_entry, ensure_ascii=False) + '\n')

        return {'ok': True, **record}
    except Exception as e:
        import traceback
        return {'ok': False, 'error': str(e), 'trace': traceback.format_exc()}


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8003, log_level='warning')
