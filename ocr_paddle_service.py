#!/usr/bin/env python3
"""
战报 OCR 服务 v2（RapidOCR + 分区域增强识别 + 红度统计）
端口: 8003
启动: python ocr_paddle_service.py
"""

import json, base64, io, re, os, sys
import cv2
import numpy as np
from PIL import Image, ImageEnhance
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from rapidocr_onnxruntime import RapidOCR
from scipy.signal import find_peaks
from scipy.ndimage import gaussian_filter1d

# ── 调试日志 ──────────────────────────────────────────────────────────
_debug_log = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ocr_stars_debug.log')

def _debug_msg(msg: str):
    """写入星标检测专用调试日志"""
    import datetime as _dt
    ts = _dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    with open(_debug_log, 'a', encoding='utf-8') as f:
        f.write(f'[{ts}] {msg}\n')
    # 同时输出到 stderr 以便后台进程也能捕获
    print(f'[{ts}] {msg}', file=sys.stderr, flush=True)

# ── 加载游戏数据 ──────────────────────────────────────────────────────
_here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_here, 'game-data.json'), encoding='utf-8') as f:
    _gd = json.load(f)

HERO_NAMES  = _gd['heroNames']
ALL_TACTICS = _gd['allTactics']
FORMATIONS  = ['一字阵', '箕形阵', '雁形阵', '方圆阵', '锥形阵', '鱼鳞阵', '钩行阵', '偃月阵']
WINNERS     = {'胜', '败', '平'}
WINNER_MAP  = {'胜': 'left', '败': 'right', '平': 'draw'}

SCALE = 2  # 预处理放大倍数

# ── RapidOCR 初始化 ───────────────────────────────────────────────────
print('初始化 RapidOCR ...')
_ocr = RapidOCR()
print('RapidOCR ready')

app = FastAPI(title='战报 OCR 服务 v2')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])


# ── 字符串工具 ────────────────────────────────────────────────────────
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
    best, bd = '', 9999
    for c in candidates:
        d = levenshtein(text, c)
        if d < bd:
            bd, best = d, c
            if d == 0:
                break
    return best, bd

def match_hero(text: str):
    text = re.sub(r'^\d+', '', text).strip()
    if len(text) < 2 or len(text) > 5:
        return None
    name, dist = best_match(text, HERO_NAMES)
    threshold = 0 if len(text) == 2 else 1
    return name if dist <= threshold else None

# ── 战法识别噪音词（这些词在战法区域出现但无意义，直接忽略）──
_TACTIC_NOISE = {'影本', '缘分', '影', '本', '缘', '分', '副本', '限时', '活动', '任务',
                 '日常', '商店', '充值', '礼包', '招募', '赛季', '战令', '月卡', '通行证',
                 '演武', '试炼', '挑战', '排行', '好友', '军团', '邮件', '设置', '返回',
                 '确定', '取消', '确认', '关闭', '加载', '登录', '注册', '公告', '福利'}

def match_tactic(text: str):
    text = re.sub(r'^影本[·.•]', '', text).strip()
    text = re.sub(r'[×xX※]\d+.*$', '', text).strip()
    # 纯噪音词直接拒绝
    if text in _TACTIC_NOISE or len(text) < 2 or len(text) > 6:
        return None
    name, dist = best_match(text, ALL_TACTICS)
    threshold = 1 if len(name) <= 4 else 2
    return name if dist <= threshold else None

def match_formation(text: str):
    name, dist = best_match(text, FORMATIONS)
    return name if dist <= 1 else None


# ── 图像预处理 ────────────────────────────────────────────────────────
def preprocess_image(img_array: np.ndarray) -> np.ndarray:
    """2x放大 + 对比度增强 + 锐化"""
    img = Image.fromarray(img_array)
    img = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS)
    img = ImageEnhance.Contrast(img).enhance(1.8)
    img = ImageEnhance.Sharpness(img).enhance(1.5)
    return np.array(img)


# ── OCR 核心 ──────────────────────────────────────────────────────────
def _raw_ocr(img_array: np.ndarray) -> list:
    """在给定图像上运行 RapidOCR，返回原始块列表（坐标为该图像空间）"""
    result, _ = _ocr(img_array)
    blocks = []
    if not result:
        return blocks
    for line in result:
        bbox, text, conf = line
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        blocks.append({
            'text': str(text).strip(),
            'x': int(min(xs)), 'y': int(min(ys)),
            'w': max(1, int(max(xs) - min(xs))),
            'h': max(1, int(max(ys) - min(ys))),
            'conf': round(float(conf), 3),
        })
    return blocks

def run_ocr_full(img_array: np.ndarray) -> list:
    """全图预处理后OCR，坐标转回原始图像空间"""
    processed = preprocess_image(img_array)
    raw = _raw_ocr(processed)
    return [{**b,
             'x': b['x'] // SCALE, 'y': b['y'] // SCALE,
             'w': max(1, b['w'] // SCALE), 'h': max(1, b['h'] // SCALE)}
            for b in raw]

def ocr_region(img_array: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> list:
    """裁剪区域 + 预处理 + OCR，坐标转回原始图像空间"""
    h, w = img_array.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1:
        return []
    crop = img_array[y1:y2, x1:x2]
    raw = _raw_ocr(preprocess_image(crop))
    return [{**b,
             'x': b['x'] // SCALE + x1, 'y': b['y'] // SCALE + y1,
             'w': max(1, b['w'] // SCALE), 'h': max(1, b['h'] // SCALE)}
            for b in raw]


# ── 豆豆模板匹配 ─────────────────────────────────────────────────────────
_DOT_TPL_GRAY: np.ndarray = None  # type: ignore    # 原始主模板 (向后兼容)
_DOT_TPL_EDGE: np.ndarray = None  # type: ignore
_DOT_TPL_LIST: list = []  # [(label, gray_tpl, edge_tpl), ...] 多模板列表

def _process_template_rgba(tpl_rgba: np.ndarray):
    """从 RGBA 模板提取 grayscale 和 edge 特征"""
    if tpl_rgba is None or tpl_rgba.shape[2] != 4:
        return None, None
    alpha = tpl_rgba[:, :, 3].astype(np.float32) / 255.0
    bgr = tpl_rgba[:, :, :3].astype(np.float32)
    masked = bgr * alpha[:, :, np.newaxis] + 128.0 * (1.0 - alpha[:, :, np.newaxis])
    masked = masked.astype(np.uint8)
    gray = cv2.cvtColor(masked, cv2.COLOR_BGR2GRAY)
    edge = cv2.Canny(gray, 50, 150)
    return gray, edge

def _load_dot_template():
    """加载所有豆豆模板（原始 + 从样本提取的暗/亮模板）"""
    global _DOT_TPL_GRAY, _DOT_TPL_EDGE, _DOT_TPL_LIST

    # 1) 加载原始主模板
    tpl_path = os.path.join(_here, 'dot_template.png')
    tpl_rgba = cv2.imread(tpl_path, cv2.IMREAD_UNCHANGED)
    if tpl_rgba is None:
        raise RuntimeError('豆豆模板加载失败: ' + tpl_path)
    if tpl_rgba.shape[2] != 4:
        raise RuntimeError('豆豆模板缺少 alpha 通道')
    _DOT_TPL_GRAY, _DOT_TPL_EDGE = _process_template_rgba(tpl_rgba)
    _DOT_TPL_LIST.append(('original', _DOT_TPL_GRAY, _DOT_TPL_EDGE))

    # 2) 加载额外模板 (从样本提取的)
    tpl_dir = os.path.join(_here, 'dot_templates_out')
    if os.path.isdir(tpl_dir):
        import glob as _glob
        ref_files = sorted(_glob.glob(os.path.join(tpl_dir, '*_ref.png')))
        loaded = 0
        for ref_path in ref_files:
            name = os.path.basename(ref_path).replace('_ref.png', '')
            tpl_rgba = cv2.imread(ref_path, cv2.IMREAD_UNCHANGED)
            if tpl_rgba is None or tpl_rgba.shape[2] != 4:
                continue
            gray, edge = _process_template_rgba(tpl_rgba)
            if gray is not None:
                _DOT_TPL_LIST.append((name, gray, edge))
                loaded += 1
        _debug_msg('加载额外模板: %d 个 (total=%d)' % (loaded, len(_DOT_TPL_LIST)))
    else:
        _debug_msg('模板目录不存在: %s, 仅使用原始模板' % tpl_dir)

    _debug_msg('豆豆模板: %dx%d alpha=%.1f%% edge=%d (total_templates=%d)' % (
        _DOT_TPL_GRAY.shape[1], _DOT_TPL_GRAY.shape[0],
        100.0 * np.count_nonzero(tpl_rgba[:,:,3] > 0.5) / tpl_rgba[:,:,3].size,
        np.count_nonzero(_DOT_TPL_EDGE),
        len(_DOT_TPL_LIST)))

_load_dot_template()


def _dot_nms(pts_scores: list, min_dist: int) -> list:
    """按置信度从高到低 NMS，水平距离 < min_dist 视为同一豆豆"""
    kept = []
    suppressed = set()
    for i, (x, y, s) in enumerate(pts_scores):
        if i in suppressed: continue
        kept.append((x, y, s))
        for j in range(i + 1, len(pts_scores)):
            if j not in suppressed and abs(pts_scores[j][0] - x) < min_dist:
                suppressed.add(j)
    return kept


def _match_one(crop_feat: np.ndarray, tpl: np.ndarray,
               scales: list, th: int, tw: int,
               threshold: float, cw: int, ch: int) -> tuple:
    """单特征多尺度模板匹配，返回 (count, info)"""
    best_count = 0
    best_info = 'no_match'
    for scale in scales:
        sw = max(4, int(tw * scale))
        sh = max(4, int(th * scale))
        if sw >= cw or sh >= ch: continue
        tpl_s = cv2.resize(tpl, (sw, sh), interpolation=cv2.INTER_AREA)
        res = cv2.matchTemplate(crop_feat, tpl_s, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(res >= threshold)
        if len(xs) == 0: continue
        scores = res[ys, xs]
        pts = sorted(zip(xs.tolist(), ys.tolist(), scores.tolist()),
                     key=lambda p: p[2], reverse=True)
        nms_dist = max(14, int(sw * 0.40))
        kept = _dot_nms(pts, min_dist=nms_dist)
        count = min(5, len(kept))
        if count > best_count:
            best_count = count
            best_info = 's=%.2f sw=%d raw=%d->nms=%d top=%.3f' % (
                scale, sw, len(pts), len(kept), kept[0][2] if kept else 0)
    return best_count, best_info


def _match_all_templates(crop_feat: np.ndarray, tpl_list: list,
                         scales: list, ref_h: int, ref_w: int,
                         threshold: float, cw: int, ch: int,
                         feat_label: str) -> tuple:
    """对特征图尝试所有模板，返回最佳 (count, info)"""
    best_count = 0
    best_info = 'no_match'
    for tpl_label, tpl_gray, tpl_edge in tpl_list:
        # 根据特征类型选择模板
        if feat_label in ('gray', 'clahe', 'raw', 'lo'):
            tpl = tpl_gray
        else:
            tpl = tpl_edge
        if tpl is None:
            continue
        th, tw = tpl.shape[:2]
        count, info = _match_one(crop_feat, tpl, scales, th, tw, threshold, cw, ch)
        if count > best_count:
            best_count = count
            best_info = '%s[%s]_%s' % (feat_label, tpl_label.split('_')[0], info)
    return best_count, best_info


def _count_stars_by_color(crop_rgb: np.ndarray) -> int:
    """用橙红火焰色统计亮豆豆数量（主方法）。
    亮豆豆：HSV H<25°, S>80, V>150（来自 doudou/ 样本校准）
    暗豆豆：V<130，不计入。
    """
    ch, cw = crop_rgb.shape[:2]
    if cw < 8 or ch < 4:
        return 0
    bgr = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    # 亮橙红掩码（含 H≈0/180 两端红色）
    m1 = cv2.inRange(hsv, np.array([0, 80, 150]), np.array([25, 255, 255]))
    m2 = cv2.inRange(hsv, np.array([160, 80, 150]), np.array([180, 255, 255]))
    mask = cv2.bitwise_or(m1, m2)

    # 形态学膨胀，连通同一豆豆内的碎片
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.dilate(mask, k, iterations=1)

    # 水平投影：每列的亮像素数
    proj = np.sum(mask > 0, axis=0).astype(float)

    # 平滑后找峰值，最少间距 = 区域宽度 / 8（5个豆豆中最小间距）
    from scipy.signal import find_peaks
    from scipy.ndimage import gaussian_filter1d
    proj_smooth = gaussian_filter1d(proj, sigma=3)
    min_dist = max(8, cw // 8)
    threshold = max(2.0, proj_smooth.max() * 0.25)
    peaks, _ = find_peaks(proj_smooth, height=threshold, distance=min_dist)
    return min(5, len(peaks))


def count_stars(img_array: np.ndarray, x1: int, y1: int, x2: int, y2: int, debug_label: str = '') -> int:
    """统计豆豆数量（0-5）。主方法：橙红色像素水平投影计峰值。"""
    h, w = img_array.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1:
        return 0

    crop_rgb = img_array[y1:y2, x1:x2]
    ch, cw = crop_rgb.shape[:2]

    # 主方法：橙红色像素水平投影（由 doudou/ 样本校准）
    color_count = _count_stars_by_color(crop_rgb)
    if color_count > 0:
        _debug_msg('count_stars %s -> %d | color' % (debug_label, color_count))
        return color_count

    # 兜底：模板匹配（图像颜色偏差时备用）
    crop_bgr = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR)
    crop_gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    crop_clahe = clahe.apply(crop_gray)
    ref_h, ref_w = _DOT_TPL_GRAY.shape[:2]
    scales = [0.08, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20] if w <= 2000 else \
             [0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.25, 0.28]
    best_count, best_info = 0, 'no_match'
    for feat, feat_name, th in [
        (crop_clahe, 'clahe', 0.70),
        (crop_gray,  'raw',   0.70),
        (crop_clahe, 'lo',    0.55),
    ]:
        count, info = _match_all_templates(feat, _DOT_TPL_LIST, scales, ref_h, ref_w, th, cw, ch, feat_name)
        if count > best_count:
            best_count, best_info = count, info
        if best_count >= 5:
            break

    _debug_msg('count_stars %s -> %d | tpl:%s' % (debug_label, best_count, best_info))
    return best_count


# ── 坐标辅助 ──────────────────────────────────────────────────────────
def cx(b): return b['x'] + b['w'] // 2
def cy(b): return b['y'] + b['h'] // 2


# ── 字段提取辅助 ──────────────────────────────────────────────────────
def find_number_near(blocks, label, max_dx=300, max_dy=25):
    for b in blocks:
        m = re.search(re.escape(label) + r'[：:]\s*(\d+)', b['text'])
        if m:
            return int(m.group(1))
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
    for b in blocks:
        m = re.search(r'(\d{1,6})/(\d{1,6})', b['text'])
        if m:
            return max(int(m.group(1)), int(m.group(2)))
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

def extract_player_alliance(blocks, side, img_h):
    """从顶部区域提取玩家名和同盟名"""
    # 先尝试标签格式
    player   = next((re.search(r'(?:玩家|player)[：:]\s*(.+)', b['text'], re.I) for b in blocks
                     if re.search(r'(?:玩家|player)[：:]', b['text'], re.I)), None)
    alliance = next((re.search(r'(?:同盟|alliance)[：:]\s*(.+)', b['text'], re.I) for b in blocks
                     if re.search(r'(?:同盟|alliance)[：:]', b['text'], re.I)), None)
    player   = player.group(1).strip()   if player   else ''
    alliance = alliance.group(1).strip() if alliance else ''

    if not player:
        top_texts = sorted(
            [b for b in blocks
             if b['y'] < img_h * 0.35
             and not match_hero(b['text'])
             and not match_tactic(b['text'])
             and not match_formation(b['text'])
             and b['text'] not in WINNERS
             and not re.match(r'^[\d×/：:]+$', b['text'])
             and not re.search(r'战损|总兵|补给|战果|统计|战报', b['text'])
             and not re.match(r'^S\d+$', b['text'], re.IGNORECASE)
             and not re.match(r'^[.。…·]+$', b['text'])  # 过滤阵型比较点("...")
             and 2 <= len(b['text']) <= 12],
            key=lambda b: b['x']
        )
        if side == 'left':
            if len(top_texts) >= 1: player   = top_texts[0]['text']
            if len(top_texts) >= 2: alliance = top_texts[-1]['text']
        else:
            if len(top_texts) >= 1: player   = top_texts[-1]['text']
            if len(top_texts) >= 2: alliance = top_texts[0]['text']
    return player, alliance


# ── 单侧处理（核心）─────────────────────────────────────────────────
def process_side(img_array: np.ndarray, blocks: list, side: str, img_w: int, img_h: int) -> dict:
    """
    处理战报单侧，返回结构化字段。
    策略：
    1. 全图 OCR 结果中提取锚点（武将名位置）
    2. 按列 x-范围 + 战法 y-区间，逐列单独 OCR 提取战法
    3. 红心区域颜色分析统计红度
    """

    # ── 阵型 / 兵力 / 玩家名 ─────────────────────────────────────
    formation = '未知'
    for b in blocks:
        fm = match_formation(b['text'])
        if fm:
            formation = fm
            break

    damage = find_number_near(blocks, '战损', 300, 30)
    troops = extract_troops(blocks)
    player, alliance = extract_player_alliance(blocks, side, img_h)

    # ── 武将名检测 ───────────────────────────────────────────────
    hero_blocks = []
    seen = []
    for b in sorted(blocks, key=lambda b: b['x']):
        hero = match_hero(b['text'])
        if not hero:
            continue
        if any(abs(cx(b) - cx(sh)) < 40 and hero == sh['matched'] for sh in seen):
            continue
        hero_blocks.append({**b, 'matched': hero})
        seen.append({**b, 'matched': hero})
    hero_blocks = hero_blocks[:3]

    generals = [h['matched'] for h in hero_blocks]
    hero_xs  = [cx(h) for h in hero_blocks]
    hero_ys  = [cy(h) for h in hero_blocks]
    hero_y   = int(np.median(hero_ys)) if hero_ys else int(img_h * 0.50)

    # ── 缺失武将：按区域重跑 OCR 补全 ───────────────────────────
    if len(hero_xs) < 3:
        # 如果一个武将都没找到，用默认位置填充
        if len(hero_xs) == 0:
            default_xs = [int(img_w * 0.18), int(img_w * 0.34), int(img_w * 0.50)]
            default_xs = default_xs if side == 'left' else [int(img_w * 0.60), int(img_w * 0.76), int(img_w * 0.92)]
            hero_xs = default_xs
            generals = ['未知', '未知', '未知']
        else:
            # 推算缺失位置
            while len(hero_xs) < 3:
                spacing = (hero_xs[-1] - hero_xs[-2]) if len(hero_xs) >= 2 else int(img_w * 0.13)
                est_x = hero_xs[-1] + spacing
            # 边界检查：防止估算位置出界（导致 col_hw 异常膨胀）
            est_x = max(int(img_w * 0.05), min(est_x, img_w - int(img_w * 0.05)))
            col_hw = max(int(img_w * 0.08), spacing // 2)
            # 对估算位置单独 OCR
            region_blocks = ocr_region(
                img_array,
                est_x - col_hw, hero_y - int(img_h * 0.05),
                est_x + col_hw, hero_y + int(img_h * 0.05)
            )
            found = None
            for rb in sorted(region_blocks, key=lambda b: b['conf'], reverse=True):
                h = match_hero(rb['text'])
                if h and h not in generals:
                    found = h
                    break
            generals.append(found or '未知')
            hero_xs.append(est_x)

    # 确保恰好 3 个
    generals = generals[:3]
    hero_xs  = hero_xs[:3]

    # 列宽估算
    if len(hero_xs) >= 2:
        spacings = [hero_xs[i+1] - hero_xs[i] for i in range(len(hero_xs)-1)]
        col_hw = max(int(np.mean(spacings) * 0.45), int(img_w * 0.05))
        col_hw = min(col_hw, int(img_w * 0.11))  # 上限：避免列间大量重叠
    else:
        col_hw = int(img_w * 0.09)

    # ── 战法：逐列扫描 ───────────────────────────────────────────
    # tactic_y_range：武将名下方 10%~50% 的 img_h 为战法区
    tac_y1 = hero_y + int(img_h * 0.10)
    tac_y2 = min(img_h, hero_y + int(img_h * 0.50))

    tactics = []  # 格式：[h1t1, h1t2, h1t3, h2t1, h2t2, h2t3, h3t1, h3t2, h3t3]
    for hx in hero_xs:
        cx1 = max(0, hx - col_hw)
        cx2 = min(img_w, hx + col_hw)
        col_blocks = ocr_region(img_array, cx1, tac_y1, cx2, tac_y2)
        matched = []
        seen_tac = set()
        for b in sorted(col_blocks, key=lambda b: b['y']):
            t = match_tactic(b['text'])
            if t and t not in seen_tac:
                matched.append(t)
                seen_tac.add(t)
        # 补足 3 个（slot1=自带, slot2=传承1, slot3=传承2）
        while len(matched) < 3:
            matched.append('未知')
        # 以 [slot1, slot2, slot3] 格式追加（与 setFlat 索引对齐）
        tactics.extend([matched[0], matched[1], matched[2]])

    # ── 红度统计：武将名正上方窄带扫红心（排除头像区杂色） ──
    # 豆豆位于武将名上方约 5%-13% img_h 处
    heart_y2 = max(0, hero_y)                           # 武将名位置
    heart_y1 = max(0, hero_y - int(img_h * 0.13))       # 往上 ~13%（覆盖不同布局）

    _debug_msg(f'process_side {side} hero_y={hero_y} heart_y1={heart_y1} heart_y2={heart_y2} col_hw={col_hw} hero_xs={hero_xs} img_w={img_w} img_h={img_h}')
    stars = []
    for i, hx in enumerate(hero_xs):
        x1 = max(0, hx - col_hw)
        x2 = min(img_w, hx + col_hw)
        label = f'{side}_hero{i+1}({x1},{heart_y1},{x2},{heart_y2})'
        n = count_stars(img_array, x1, heart_y1, x2, heart_y2, label)
        # 如果没找到且区域可能偏了，向下扩展搜索
        if n == 0:
            heart_y1b = max(0, hero_y - int(img_h * 0.06))
            n = count_stars(img_array, x1, heart_y1b, x2, heart_y2, label + '_v2')
        stars.append(n)

    return {
        f'{side}Generals':  generals,
        f'{side}Tactics':   tactics,   # 9元素
        f'{side}Stars':     stars,     # 3元素
        f'{side}Damage':    damage,
        f'{side}Troops':    troops,
        f'{side}Formation': formation,
        f'{side}Player':    player,
        f'{side}Alliance':  alliance,
    }


# ── 主分析 ────────────────────────────────────────────────────────────
def analyze_battle(img_array: np.ndarray, img_w: int, img_h: int) -> dict:
    # 1. 全图增强 OCR（用于锚点检测）
    blocks = run_ocr_full(img_array)

    # 2. 找胜负字符定中线
    center_x = img_w / 2
    winner = 'unknown'
    for b in blocks:
        if b['text'] in WINNERS:
            winner   = WINNER_MAP[b['text']]
            center_x = cx(b)
            break

    margin       = img_w * 0.06
    left_blocks  = [b for b in blocks if cx(b) < center_x - margin]
    right_blocks = [b for b in blocks if cx(b) > center_x + margin]

    left  = process_side(img_array, left_blocks,  'left',  img_w, img_h)
    right = process_side(img_array, right_blocks, 'right', img_w, img_h)

    # 3. 日期
    battle_date = ''
    for b in blocks:
        m = re.search(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}', b['text'])
        if m:
            battle_date = m.group(0)
            break

    return {**left, **right, 'winner': winner, 'battleDate': battle_date}


# ── 标注配置驱动提取 ─────────────────────────────────────────────────
def extract_with_config(img_array: np.ndarray, img_w: int, img_h: int,
                        label_config: dict) -> dict:
    """
    使用手动标注的区域配置提取所有字段。
    label_config 格式（来自 /api/label-config）:
    {
      "stars": {"boxes": [{key, rx1, ry1, rx2, ry2, value}, ...]},
      "heroNames": {"boxes": [...]},
      "playerNames": {"boxes": [...]},
      ...
    }
    返回与 process_side 兼容的结构。
    """
    result = {
        'leftGenerals': ['', '', ''], 'rightGenerals': ['', '', ''],
        'leftTactics': ['']*9, 'rightTactics': ['']*9,
        'leftStars': [0, 0, 0], 'rightStars': [0, 0, 0],
        'leftDamage': 0, 'rightDamage': 0,
        'leftTroops': 0, 'rightTroops': 0,
        'leftFormation': '', 'rightFormation': '',
        'leftPlayer': '', 'rightPlayer': '',
        'leftAlliance': '', 'rightAlliance': '',
    }

    def to_abs(rx, ry):
        return int(rx * img_w), int(ry * img_h)

    def ocr_box(box):
        """对单个标注框执行 OCR，返回识别文本列表"""
        x1, y1 = to_abs(box['rx1'], box['ry1'])
        x2, y2 = to_abs(box['rx2'], box['ry2'])
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(img_w, x2), min(img_h, y2)
        if x2 <= x1 or y2 <= y1:
            return []
        blocks = ocr_region(img_array, x1, y1, x2, y2)
        return [b['text'] for b in blocks]

    # ── 豆豆（红度）─ 模板匹配 ──
    if 'stars' in label_config:
        for box in label_config['stars'].get('boxes', []):
            key = box.get('key', '')
            x1, y1 = to_abs(box['rx1'], box['ry1'])
            x2, y2 = to_abs(box['rx2'], box['ry2'])
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(img_w, x2), min(img_h, y2)
            if x2 <= x1 or y2 <= y1:
                continue
            n = count_stars(img_array, x1, y1, x2, y2, key)
            if key == 'L1': result['leftStars'][0] = n
            elif key == 'L2': result['leftStars'][1] = n
            elif key == 'L3': result['leftStars'][2] = n
            elif key == 'R1': result['rightStars'][0] = n
            elif key == 'R2': result['rightStars'][1] = n
            elif key == 'R3': result['rightStars'][2] = n

    # ── 武将名 ──
    if 'heroNames' in label_config:
        for box in label_config['heroNames'].get('boxes', []):
            key = box.get('key', '')
            texts = ocr_box(box)
            hero = None
            for t in texts:
                h = match_hero(t)
                if h: hero = h; break
            if not hero:
                hero = '未知'  # 识别失败统一返回未知，避免单字母残缺值污染合并结果
            side, idx = key[0], int(key[1]) - 1  # e.g. 'L1' -> side='L', idx=0
            if side == 'L':
                result['leftGenerals'][idx] = hero
            else:
                result['rightGenerals'][idx] = hero

    # ── 角色名称（玩家名）──
    if 'playerNames' in label_config:
        for box in label_config['playerNames'].get('boxes', []):
            key = box.get('key', '')
            texts = ocr_box(box)
            name = texts[0] if texts else ''
            if key == 'left':
                result['leftPlayer'] = name
            else:
                result['rightPlayer'] = name

    # ── 同盟名称 ──
    if 'alliances' in label_config:
        for box in label_config['alliances'].get('boxes', []):
            key = box.get('key', '')
            texts = ocr_box(box)
            name = texts[0] if texts else ''
            if key == 'left':
                result['leftAlliance'] = name
            else:
                result['rightAlliance'] = name

    # ── 战损数值 ──
    if 'damages' in label_config:
        for box in label_config['damages'].get('boxes', []):
            key = box.get('key', '')
            texts = ocr_box(box)
            num = 0
            for t in texts:
                m = re.search(r'(\d[\d,]*)', t)
                if m:
                    num = int(m.group(1).replace(',', ''))
                    break
            if key == 'left':
                result['leftDamage'] = num
            else:
                result['rightDamage'] = num

    # ── 兵力数值 ──
    if 'troops' in label_config:
        for box in label_config['troops'].get('boxes', []):
            key = box.get('key', '')
            texts = ocr_box(box)
            num = 0
            for t in texts:
                m = re.search(r'(\d[\d,]*)', t)
                if m:
                    num = int(m.group(1).replace(',', ''))
                    break
            if key == 'left':
                result['leftTroops'] = num
            else:
                result['rightTroops'] = num

    # ── 阵型 ──
    if 'formations' in label_config:
        for box in label_config['formations'].get('boxes', []):
            key = box.get('key', '')
            texts = ocr_box(box)
            fm = '未知'
            for t in texts:
                mf = match_formation(t)
                if mf: fm = mf; break
            if key == 'left':
                result['leftFormation'] = fm
            else:
                result['rightFormation'] = fm

    # ── 战法名 ──
    if 'tactics' in label_config:
        for box in label_config['tactics'].get('boxes', []):
            key = box.get('key', '')  # e.g. 'L1_2' -> side L, hero 1, slot 2
            texts = ocr_box(box)
            tac = '未知'
            for t in texts:
                mt = match_tactic(t)
                if mt: tac = mt; break
            if not tac or tac == '未知':
                # 兜底：取第一个非噪音文本，全是噪音则保持"未知"
                for t in texts:
                    if t and t not in _TACTIC_NOISE and len(t) >= 2:
                        tac = t
                        break
                if not tac or tac in _TACTIC_NOISE:
                    tac = '未知'
            # key 格式: 'L1_1' → heroKey='L1', slot='1'
            parts = key.split('_')
            hero_key = parts[0]   # 'L1','L2','L3','R1','R2','R3'
            side = hero_key[0]    # 'L' or 'R'
            hero_idx = int(hero_key[1]) - 1  # 0,1,2
            slot_idx = int(parts[1]) - 1     # 0,1,2
            arr = result['leftTactics'] if side == 'L' else result['rightTactics']
            arr[hero_idx * 3 + slot_idx] = tac

    return result


# ── API ──────────────────────────────────────────────────────────────
class OcrRequest(BaseModel):
    image: str = ''       # base64
    labelConfig: dict = None  # 可选的标注区域配置

@app.get('/health')
def health():
    return {'status': 'ok', 'engine': 'rapidocr-onnxruntime-v2'}

@app.post('/ocr')
def paddle_ocr(req: OcrRequest):
    try:
        b64      = re.sub(r'^data:[^;]+;base64,', '', req.image)
        img_bytes = base64.b64decode(b64)
        img      = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        img_arr  = np.array(img)

        # 如果有标注配置，使用区域提取 + 自动检测兜底
        if req.labelConfig and isinstance(req.labelConfig, dict) and len(req.labelConfig) > 0:
            labeled = None
            try:
                labeled = extract_with_config(img_arr, img.width, img.height, req.labelConfig)
            except Exception as e:
                print(f'[label-config] 区域提取失败: {e}', file=sys.stderr, flush=True)
            auto = analyze_battle(img_arr, img.width, img.height)
            if labeled:
                # 合并：标注结果优先，空位用自动检测补充
                record = {}
                for k in auto:
                    lv = labeled.get(k)
                    is_empty = (lv is None or lv == '' or lv == 0 or lv == [] or
                               (isinstance(lv, list) and all(v == '' or v == 0 or v == '未知' for v in lv)))
                    record[k] = lv if not is_empty else auto.get(k, lv)
                # 武将名逐位验证：labeled 给出的名字必须是有效武将名，否则用 auto 补充
                for side in ['left', 'right']:
                    gk = f'{side}Generals'
                    l_gens = labeled.get(gk, ['未知'] * 3)
                    a_gens = auto.get(gk, ['未知'] * 3)
                    merged = []
                    for lg, ag in zip(l_gens, a_gens):
                        if lg and lg != '未知' and match_hero(lg):
                            merged.append(lg)   # labeled 识别出有效名字，采用
                        elif ag and ag != '未知':
                            merged.append(ag)   # labeled 无效，用 auto 补
                        else:
                            merged.append('未知')
                    record[gk] = merged
                for side in ['left', 'right']:
                    tk = f'{side}Tactics'
                    lt = labeled.get(tk, [])
                    if all(t == '' or t == '未知' for t in lt):
                        record[tk] = auto.get(tk, lt)
            else:
                record = auto
        else:
            record = analyze_battle(img_arr, img.width, img.height)

        import time as _time
        log_entry = {
            'ts': _time.strftime('%Y-%m-%d %H:%M:%S'),
            'w': img.width, 'h': img.height,
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
