#!/usr/bin/env python3
"""
战报 OCR 服务 v2（PaddleOCR PP-OCRv5 + 分区域增强识别 + 红度统计）
端口: 8003
启动: python ocr_paddle_service.py
"""

import json, base64, io, re, os, sys, gc, threading, time
import cv2
import numpy as np
from PIL import Image, ImageEnhance
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from paddleocr import PaddleOCR
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
FORMATIONS  = _gd.get('formations', ['一字阵', '箕形阵', '雁形阵', '方圆阵', '锥形阵', '鱼鳞阵', '钩行阵', '偃月阵'])
WINNERS     = {'胜', '败', '平'}
WINNER_MAP  = {'胜': 'left', '败': 'right', '平': 'draw'}

SCALE = 2  # 预处理放大倍数

# ── PaddleOCR 初始化 ──────────────────────────────────────────────────
print('初始化 PaddleOCR (PP-OCRv5) ...')
_ocr = PaddleOCR(lang='ch', use_angle_cls=True, use_gpu=False, show_log=False)
print('PaddleOCR ready')

# 🔥 模型预热：用小图推理一次，确保模型完全加载到内存
print('模型预热中...')
try:
    _warmup_img = np.zeros((100, 100, 3), dtype=np.uint8)
    _ocr.ocr(_warmup_img)
    print('✅ 模型预热完成')
except Exception as e:
    print(f'⚠️  模型预热失败: {e}', file=sys.stderr, flush=True)

# ── 长时间运行稳定性 ─────────────────────────────────────────────────
_request_count = 0
_GC_INTERVAL = 1           # 每 N 次请求执行一次 gc.collect()（改为每次都GC）
_MEM_RESTART_PCT = 95      # 系统内存使用率超过此值时主动重启（调高到95%，避免过于频繁重启）
_LOG_MAX_MB = 10           # 日志文件上限 MB
_LOG_BACKUPS = 3           # 保留备份数

import ctypes

class _MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ('dwLength',                ctypes.c_ulong),
        ('dwMemoryLoad',            ctypes.c_ulong),
        ('ullTotalPhys',            ctypes.c_ulonglong),
        ('ullAvailPhys',            ctypes.c_ulonglong),
        ('ullTotalPageFile',        ctypes.c_ulonglong),
        ('ullAvailPageFile',        ctypes.c_ulonglong),
        ('ullTotalVirtual',         ctypes.c_ulonglong),
        ('ullAvailVirtual',         ctypes.c_ulonglong),
        ('ullAvailExtendedVirtual', ctypes.c_ulonglong),
    ]

def _sys_mem_pct() -> int:
    """返回系统内存使用百分比（Windows GlobalMemoryStatusEx）"""
    try:
        stat = _MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        return int(stat.dwMemoryLoad)
    except Exception:
        return 0

def _rotate_log_if_needed(path):
    """日志文件超过上限时自动轮转"""
    if not os.path.exists(path):
        return
    size_mb = os.path.getsize(path) / (1024 * 1024)
    if size_mb < _LOG_MAX_MB:
        return
    try:
        for i in range(_LOG_BACKUPS - 1, -1, -1):
            old = path + (f'.{i}' if i > 0 else '')
            new = path + f'.{i + 1}'
            if os.path.exists(old):
                if i >= _LOG_BACKUPS - 1:
                    os.remove(old)
                else:
                    os.rename(old, new)
        os.rename(path, path + '.1')
        print(f'[日志轮转] {path} 已轮转', file=sys.stderr, flush=True)
    except Exception as e:
        print(f'[日志轮转] {path} 轮转失败: {e}', file=sys.stderr, flush=True)

def _maybe_gc():
    """每 N 次请求执行垃圾回收；系统内存超阈值时主动退出让 watchdog 重启"""
    global _request_count
    _request_count += 1
    if _request_count % _GC_INTERVAL == 0:
        collected = gc.collect()
        mem_pct = _sys_mem_pct()
        print(f'[GC] #{_request_count} gc.collect() 回收 {collected} 个对象, 系统内存={mem_pct}%', file=sys.stderr, flush=True)
        if mem_pct >= _MEM_RESTART_PCT:
            print(f'[RESTART] 系统内存 {mem_pct}% >= {_MEM_RESTART_PCT}%，主动退出(42)让 watchdog 重启', file=sys.stderr, flush=True)
            sys.exit(42)

# ── 图片缓存（避免重复传输大图）────────────────────────────────────────
_img_cache: dict = {}  # token -> (img_arr, img_w, img_h)
_IMG_CACHE_MAX = 5     # 最多缓存5张图

app = FastAPI(title='战报 OCR 服务 v2')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])


# ── 武将名形近字 OCR 纠正表（在距离匹配前预处理，避免因形近字导致误读）──
# 只纠正在武将名中不会出现的字形（右侧为正确字，左侧为 OCR 常见误读）
_HERO_CHAR_FIX = {
    '不': '丕',   # 曹丕（丕下方多一横，OCR 易丢）
    '叺': '丕',
    '巳': '己',   # 己/巳 常混
    '己': '已',
}

def _fix_hero_chars(text: str) -> str:
    """对武将名应用形近字纠正；仅当纠正后与原文不同时使用。"""
    return ''.join(_HERO_CHAR_FIX.get(c, c) for c in text)

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
    # 含数字的文本作为噪音去除（与战法噪音处理思路一致）
    if re.search(r'\d', text):
        return None
    if len(text) < 2 or len(text) > 5:
        return None
    fixed = _fix_hero_chars(text)
    name, dist = best_match(fixed, HERO_NAMES)
    threshold = 1  # PaddleOCR 更准确，允许 1 字差兜底（截断/形近字）
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
    threshold = 2  # 统一阈值，兼容 OCR 形近字双错误
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
    """在给定图像上运行 PaddleOCR，返回原始块列表（坐标为该图像空间）"""
    result = _ocr.ocr(img_array)
    blocks = []
    if not result or not result[0]:
        return blocks
    for line in result[0]:
        if line is None:
            continue
        bbox, (text, conf) = line
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        blocks.append({
            'text': str(text).strip(),
            'x': int(min(xs)), 'y': int(min(ys)),
            'w': max(1, int(max(xs) - min(xs))),
            'h': max(1, int(max(ys) - min(ys))),
            'conf': round(float(conf), 3),
        })
    # 🔥 释放OCR结果对象，避免累积
    del result
    return blocks

def run_ocr_full(img_array: np.ndarray) -> list:
    """全图预处理后OCR，坐标转回原始图像空间"""
    processed = preprocess_image(img_array)
    raw = _raw_ocr(processed)
    result = [{**b,
             'x': b['x'] // SCALE, 'y': b['y'] // SCALE,
             'w': max(1, b['w'] // SCALE), 'h': max(1, b['h'] // SCALE)}
            for b in raw]
    # 🔥 释放预处理后的大图
    del processed
    return result

def ocr_region(img_array: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> list:
    """裁剪区域 + 预处理 + OCR，坐标转回原始图像空间"""
    import time as _t
    h, w = img_array.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1:
        return []
    crop = img_array[y1:y2, x1:x2]
    _ta = _t.time()
    processed = preprocess_image(crop)
    _tb = _t.time()
    raw = _raw_ocr(processed)
    _tc = _t.time()
    print(f'  [ocr_region] 区域{crop.shape[:2]} 预处理{(_tb-_ta)*1000:.0f}ms OCR推理{(_tc-_tb)*1000:.0f}ms')
    result = [{**b,
             'x': b['x'] // SCALE + x1, 'y': b['y'] // SCALE + y1,
             'w': max(1, b['w'] // SCALE), 'h': max(1, b['h'] // SCALE)}
            for b in raw]
    # 🔥 释放裁剪和预处理后的图像
    del crop, processed
    return result


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
    """加载单豆模板（暗色和亮色各一个）"""
    global _DOT_TPL_GRAY, _DOT_TPL_EDGE, _DOT_TPL_LIST

    # 1) 加载暗色和亮色单豆模板（从专用目录）
    template_dir = os.path.join(_here, 'dot_templates')
    dark_path = os.path.join(template_dir, 'dot_dark.png')
    light_path = os.path.join(template_dir, 'dot_light.png')

    main_loaded = False

    # 加载暗色模板
    if os.path.exists(dark_path):
        dark_rgba = cv2.imread(dark_path, cv2.IMREAD_UNCHANGED)
        if dark_rgba is not None and len(dark_rgba.shape) == 3 and dark_rgba.shape[2] == 4:
            dark_gray, dark_edge = _process_template_rgba(dark_rgba)
            _DOT_TPL_LIST.append(('dark', dark_gray, dark_edge))
            if not main_loaded:
                _DOT_TPL_GRAY, _DOT_TPL_EDGE = dark_gray, dark_edge
                main_loaded = True
            _debug_msg('加载暗色单豆模板: ' + dark_path)
        else:
            _debug_msg('暗色模板加载失败（格式错误）: ' + dark_path)
    else:
        _debug_msg('暗色模板不存在: ' + dark_path)

    # 加载亮色模板
    if os.path.exists(light_path):
        light_rgba = cv2.imread(light_path, cv2.IMREAD_UNCHANGED)
        if light_rgba is not None and len(light_rgba.shape) == 3 and light_rgba.shape[2] == 4:
            light_gray, light_edge = _process_template_rgba(light_rgba)
            _DOT_TPL_LIST.append(('light', light_gray, light_edge))
            if not main_loaded:
                _DOT_TPL_GRAY, _DOT_TPL_EDGE = light_gray, light_edge
                main_loaded = True
            _debug_msg('加载亮色单豆模板: ' + light_path)
        else:
            _debug_msg('亮色模板加载失败（格式错误）: ' + light_path)
    else:
        _debug_msg('亮色模板不存在: ' + light_path)

    # 最终检查：确保至少加载了一个模板
    if not main_loaded or _DOT_TPL_GRAY is None:
        raise RuntimeError('无法加载任何豆豆模板，请检查 dot_templates/dot_dark.png 和 dot_light.png')

    _debug_msg('豆豆模板: %dx%d edge=%d (total_templates=%d)' % (
        _DOT_TPL_GRAY.shape[1], _DOT_TPL_GRAY.shape[0],
        np.count_nonzero(_DOT_TPL_EDGE),
        len(_DOT_TPL_LIST)))

_load_dot_template()

# ── 整体豆豆模板（亮/暗 × 1-5颗）──────────────────────────────────────
_COUNT_TPLS: list = []  # [(count, label, gray, mask_uint8), ...]

def _load_count_templates():
    global _COUNT_TPLS
    # 优先从doudou目录加载
    tpl_dir = os.path.join(_here, 'doudou')
    if not os.path.isdir(tpl_dir):
        # 回退到字典库目录
        tpl_dir = os.path.join(_here, '字典库', '02-豆豆')
    if not os.path.isdir(tpl_dir):
        _debug_msg('整体豆豆模板目录不存在: ' + tpl_dir)
        return
    from PIL import Image as _PILImage
    for variant in ['亮', '暗']:
        for n in range(1, 6):
            path = os.path.join(tpl_dir, f'{variant}{n}.png')
            if not os.path.isfile(path):
                continue
            pil_img = _PILImage.open(path).convert('RGBA')
            img = np.array(pil_img)          # shape: (H, W, 4) RGBA uint8
            alpha = img[:, :, 3]
            rgb   = img[:, :, :3].astype(np.float32)
            a_f   = alpha.astype(np.float32) / 255.0
            blended = rgb * a_f[:, :, np.newaxis] + 128.0 * (1 - a_f[:, :, np.newaxis])
            gray  = cv2.cvtColor(blended.astype(np.uint8), cv2.COLOR_RGB2GRAY)
            _COUNT_TPLS.append((n, f'{variant}{n}', gray, alpha))
    _debug_msg(f'整体豆豆模板: {len(_COUNT_TPLS)} 个 (from {tpl_dir})')

_load_count_templates()

def _count_stars_holistic(crop_gray: np.ndarray) -> tuple:
    """整体匹配：把裁剪区域缩放到与每张模板相同尺寸做一对一比较，返回 (count, score, label, all_scores)"""
    if not _COUNT_TPLS:
        return 0, -1.0, 'no_tpl', {}
    ch, cw = crop_gray.shape[:2]
    best_count, best_score, best_label = 0, -1.0, 'no_match'
    all_scores: dict = {}
    for count, label, tpl, mask in _COUNT_TPLS:
        th, tw = tpl.shape[:2]
        # 把裁剪拉伸到模板尺寸，做一对一整体比较
        crop_s = cv2.resize(crop_gray, (tw, th))
        try:
            if mask is not None:
                res = cv2.matchTemplate(crop_s, tpl, cv2.TM_CCOEFF_NORMED, mask=mask)
            else:
                res = cv2.matchTemplate(crop_s, tpl, cv2.TM_CCOEFF_NORMED)
            score = float(res.max())
        except Exception:
            score = -1.0
        all_scores[label] = round(score, 3)
        if score > best_score:
            best_score, best_count, best_label = score, count, label
    return best_count, best_score, best_label, all_scores


def _count_stars_projection(crop_gray: np.ndarray, cw: int, ch: int) -> int:
    """投影峰值法：统计水平亮度曲线的峰值数量（与颜色无关）"""
    try:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
        enhanced = clahe.apply(crop_gray)
        # 列方向取最大值，形成水平投影曲线
        proj = enhanced.max(axis=0).astype(float)
        # 归一化
        pmin, pmax = proj.min(), proj.max()
        if pmax - pmin < 10:
            return 0
        proj_n = (proj - pmin) / (pmax - pmin)
        # 平滑
        proj_s = gaussian_filter1d(proj_n, sigma=max(1.5, cw / 80))
        # 峰值检测：高于 0.5 的局部极大值，间距至少 cw//8
        min_dist_px = max(6, cw // 8)
        peaks, _ = find_peaks(proj_s, height=0.5, distance=min_dist_px)
        return min(5, len(peaks))
    except Exception:
        return 0


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
        nms_dist = max(10, int(sw * 0.35))
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


def _count_stars_by_color(crop_rgb: np.ndarray, debug_label: str = '') -> tuple:
    """用橙红火焰色统计豆豆数量（优化版）。

    检测亮豆豆和暗豆豆，通过水平投影计数。
    返回 (count, debug_info)
    """
    ch, cw = crop_rgb.shape[:2]
    if cw < 8 or ch < 4:
        return 0, 'too_small'
    bgr = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    # 平衡的颜色阈值
    # 亮豆豆：高饱和度+高亮度
    m1 = cv2.inRange(hsv, np.array([0, 110, 190]), np.array([30, 255, 255]))
    m2 = cv2.inRange(hsv, np.array([155, 110, 190]), np.array([180, 255, 255]))

    # 暗豆豆：中等饱和度+中等亮度
    m3 = cv2.inRange(hsv, np.array([0, 75, 65]), np.array([35, 255, 190]))
    m4 = cv2.inRange(hsv, np.array([150, 75, 65]), np.array([180, 255, 190]))

    # 合并所有掩码
    mask = cv2.bitwise_or(cv2.bitwise_or(m1, m2), cv2.bitwise_or(m3, m4))

    # 形态学操作：先开运算去除小噪点，再闭运算填充豆豆内部
    k_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k_small, iterations=1)

    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=1)

    # 水平投影：每列的亮像素数
    proj = np.sum(mask > 0, axis=0).astype(float)

    # 平滑后找峰值
    from scipy.signal import find_peaks
    from scipy.ndimage import gaussian_filter1d
    proj_smooth = gaussian_filter1d(proj, sigma=3.2)

    # 平衡的峰值检测参数
    min_dist = max(13, cw // 6)  # 适中的最小间距
    threshold = max(6.0, proj_smooth.max() * 0.25)  # 降低到25%阈值

    # 降低峰值显著性要求
    peaks, properties = find_peaks(proj_smooth, height=threshold, distance=min_dist, prominence=threshold * 0.20)

    count = min(5, len(peaks))

    # 构建调试信息
    mask_pixels = np.count_nonzero(mask)
    debug_info = f'peaks={len(peaks)} mask_px={mask_pixels} th={threshold:.1f} dist={min_dist}'

    return count, debug_info


def _count_stars_by_contours(crop_rgb: np.ndarray, debug_label: str = '') -> tuple:
    """基于连通域+面积估算的豆豆计数。

    检测橙红色区域，用连通域分析统计独立的豆豆数量。
    对于连接在一起的大区域，使用面积估算。
    返回 (count, debug_info)
    """
    ch, cw = crop_rgb.shape[:2]
    if cw < 8 or ch < 4:
        return 0, 'too_small'

    bgr = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    # 检测橙红色豆豆（亮+暗）
    m1 = cv2.inRange(hsv, np.array([0, 100, 160]), np.array([30, 255, 255]))
    m2 = cv2.inRange(hsv, np.array([155, 100, 160]), np.array([180, 255, 255]))
    m3 = cv2.inRange(hsv, np.array([0, 70, 60]), np.array([35, 255, 160]))
    m4 = cv2.inRange(hsv, np.array([150, 70, 60]), np.array([180, 255, 160]))

    mask = cv2.bitwise_or(cv2.bitwise_or(m1, m2), cv2.bitwise_or(m3, m4))

    # 轻度形态学操作
    k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k_open, iterations=1)

    # 查找连通域
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # 分析每个连通域
    valid_regions = []
    # 根据区域宽度估算单豆的平均面积（更准确）
    # 假设5个豆豆水平排列，每个豆豆宽度约为 cw/5，面积约为 (cw/5)*(ch*0.8)
    single_bean_area = (cw / 5.0) * (ch * 0.8) * 0.6  # 0.6是豆豆的填充率

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < single_bean_area * 0.2:  # 太小，噪音
            continue

        x, y, w, h = cv2.boundingRect(cnt)
        aspect_ratio = float(w) / h if h > 0 else 0

        # 判断是否是单个豆豆
        if area <= single_bean_area * 1.8 and 0.2 <= aspect_ratio <= 2.5:
            # 单个豆豆，直接计数
            valid_regions.append((x, 1, area))
        else:
            # 可能是多个豆豆连接在一起
            # 根据宽度估算更准确：宽度 / (区域宽度/5)
            estimated_by_width = max(1, min(5, int(round(w / (cw / 5.0)))))
            # 根据面积估算
            estimated_by_area = max(1, min(5, int(round(area / single_bean_area))))
            # 取两者的平均值（四舍五入）
            estimated_count = max(1, min(5, int(round((estimated_by_width + estimated_by_area) / 2.0))))
            valid_regions.append((x, estimated_count, area))

    # 按x坐标排序
    valid_regions.sort(key=lambda r: r[0])

    # 计算总数
    total_count = sum(r[1] for r in valid_regions)
    count = min(5, total_count)

    # 构建调试信息
    mask_pixels = np.count_nonzero(mask)
    region_info = [f"{r[1]}豆a{int(r[2])}" for r in valid_regions[:5]]
    debug_info = f'regions={len(valid_regions)} total={count} sba={int(single_bean_area)} [{",".join(region_info)}]'

    return count, debug_info
    """用橙红火焰色统计豆豆数量（优化版）。

    检测亮豆豆和暗豆豆，通过水平投影计数。
    返回 (count, debug_info)
    """
    ch, cw = crop_rgb.shape[:2]
    if cw < 8 or ch < 4:
        return 0, 'too_small'
    bgr = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    # 平衡的颜色阈值
    # 亮豆豆：高饱和度+高亮度
    m1 = cv2.inRange(hsv, np.array([0, 110, 190]), np.array([30, 255, 255]))
    m2 = cv2.inRange(hsv, np.array([155, 110, 190]), np.array([180, 255, 255]))

    # 暗豆豆：中等饱和度+中等亮度
    m3 = cv2.inRange(hsv, np.array([0, 75, 65]), np.array([35, 255, 190]))
    m4 = cv2.inRange(hsv, np.array([150, 75, 65]), np.array([180, 255, 190]))

    # 合并所有掩码
    mask = cv2.bitwise_or(m1, m2)
    mask = cv2.bitwise_or(mask, m3)
    mask = cv2.bitwise_or(mask, m4)

    # 形态学操作：先开运算去除小噪点，再闭运算填充豆豆内部
    k_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k_small, iterations=1)

    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=1)

    # 水平投影：每列的亮像素数
    proj = np.sum(mask > 0, axis=0).astype(float)

    # 平滑后找峰值
    from scipy.signal import find_peaks
    from scipy.ndimage import gaussian_filter1d
    proj_smooth = gaussian_filter1d(proj, sigma=3.2)

    # 平衡的峰值检测参数
    min_dist = max(13, cw // 6)  # 适中的最小间距
    threshold = max(6.0, proj_smooth.max() * 0.25)  # 降低到25%阈值

    # 降低峰值显著性要求
    peaks, properties = find_peaks(proj_smooth, height=threshold, distance=min_dist, prominence=threshold * 0.20)

    count = min(5, len(peaks))

    # 构建调试信息
    mask_pixels = np.count_nonzero(mask)
    debug_info = f'peaks={len(peaks)} mask_px={mask_pixels} th={threshold:.1f} dist={min_dist}'

    return count, debug_info


def _count_stars_sliding_window(crop_rgb: np.ndarray, debug_label: str = '') -> tuple:
    """单豆滑窗法统计豆豆数量。

    用单个豆豆模板在区域内滑动匹配，通过NMS去重后统计数量。
    返回 (count, debug_info)
    """
    ch, cw = crop_rgb.shape[:2]
    if cw < 8 or ch < 4:
        return 0, 'too_small'

    crop_bgr = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR)
    crop_gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)

    # 对比度增强
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    crop_enhanced = clahe.apply(crop_gray)

    # 使用两个单豆模板（暗色和亮色）
    if not _DOT_TPL_LIST or len(_DOT_TPL_LIST) < 2:
        return 0, 'no_templates'

    all_matches = []

    # 对每个模板进行多尺度滑窗匹配
    for tpl_name, tpl_gray, tpl_edge in _DOT_TPL_LIST[:2]:  # 只用暗色和亮色
        tpl_h, tpl_w = tpl_gray.shape[:2]

        # 多尺度：根据区域大小动态调整
        base_scale = min(cw / (tpl_w * 5), ch / tpl_h)  # 假设5个豆豆水平排列
        scales = [base_scale * r for r in [0.7, 0.85, 1.0, 1.15, 1.3]]

        for scale in scales:
            if scale < 0.5 or scale > 2.0:
                continue

            # 缩放模板
            new_w = max(5, int(tpl_w * scale))
            new_h = max(5, int(tpl_h * scale))
            if new_w >= cw or new_h >= ch:
                continue

            tpl_resized = cv2.resize(tpl_gray, (new_w, new_h), interpolation=cv2.INTER_AREA)

            # 模板匹配
            result = cv2.matchTemplate(crop_enhanced, tpl_resized, cv2.TM_CCOEFF_NORMED)

            # 找到所有高于阈值的匹配
            threshold = 0.55  # 降低阈值，提高灵敏度
            locations = np.where(result >= threshold)

            for pt in zip(*locations[::-1]):  # (x, y)
                score = result[pt[1], pt[0]]
                # 记录匹配位置、尺寸、分数
                all_matches.append({
                    'x': pt[0],
                    'y': pt[1],
                    'w': new_w,
                    'h': new_h,
                    'score': score,
                    'cx': pt[0] + new_w // 2,  # 中心点
                    'cy': pt[1] + new_h // 2
                })

    if len(all_matches) == 0:
        return 0, 'no_matches'

    # 自适应阈值过滤：只保留分数较高的匹配
    # 如果有很多低分匹配，提高阈值；如果匹配很少，降低阈值
    scores = [m['score'] for m in all_matches]
    max_score = max(scores)
    mean_score = sum(scores) / len(scores)

    # 动态阈值：介于mean和max之间，降低过滤强度
    adaptive_threshold = mean_score + (max_score - mean_score) * 0.25  # 进一步降低到0.25
    adaptive_threshold = max(0.50, min(0.60, adaptive_threshold))  # 限制在0.50-0.60之间

    # 过滤低分匹配
    filtered_matches = [m for m in all_matches if m['score'] >= adaptive_threshold]

    if len(filtered_matches) == 0:
        return 0, f'filtered_all raw={len(all_matches)} th={adaptive_threshold:.3f}'

    all_matches = filtered_matches

    # NMS (非极大值抑制) 去除重叠的匹配
    # 按分数降序排序
    all_matches.sort(key=lambda m: m['score'], reverse=True)

    final_matches = []
    # 估算单豆的平均宽度
    estimated_single_width = cw / 5.0  # 假设5个豆豆水平排列

    for match in all_matches:
        # 检查是否与已选择的匹配重叠
        overlap = False
        for selected in final_matches:
            # 计算中心点距离
            dist = ((match['cx'] - selected['cx'])**2 + (match['cy'] - selected['cy'])**2)**0.5
            # 最小距离：使用估算的单豆宽度的60%
            min_dist = estimated_single_width * 0.6

            if dist < min_dist:
                overlap = True
                break

        if not overlap:
            final_matches.append(match)

    count = min(5, len(final_matches))

    # 构建调试信息
    avg_score = sum(m['score'] for m in final_matches[:5]) / max(1, len(final_matches[:5]))
    debug_info = f'raw={len(all_matches)} nms={len(final_matches)} avg_score={avg_score:.3f}'

    return count, debug_info


def count_stars(img_array: np.ndarray, x1: int, y1: int, x2: int, y2: int, debug_label: str = '') -> int:
    """混合方法统计豆豆数量（0-5）。

    优先使用整体模板匹配，置信度低时fallback到单豆滑窗法。
    """
    h, w = img_array.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1:
        return 0

    crop_rgb = img_array[y1:y2, x1:x2]
    crop_bgr = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR)
    crop_gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)

    # 方法1：整体模板匹配
    holistic_count, holistic_score, holistic_label, all_scores = _count_stars_holistic(crop_gray)

    # 如果整体匹配置信度非常高，直接采用
    if holistic_count > 0 and holistic_score >= 0.55:  # 提高阈值到0.55，只有非常确定时才用
        msg = 'count_stars %s -> %d | holistic_%s=%.3f' % (debug_label, holistic_count, holistic_label, holistic_score)
        _debug_msg(msg)
        count_stars._last_info = 'holistic_%s=%.3f' % (holistic_label, holistic_score)
        return holistic_count

    # 方法2：单豆滑窗法（fallback）
    sliding_count, sliding_info = _count_stars_sliding_window(crop_rgb, debug_label)

    # 如果两种方法都有结果，选择置信度更高的
    if holistic_count > 0 and sliding_count > 0:
        # 比较置信度
        # 整体模板的置信度已经低于0.45，滑窗法优先
        msg = 'count_stars %s -> %d | sliding(%s) vs holistic_%s=%.3f' % (
            debug_label, sliding_count, sliding_info, holistic_label, holistic_score
        )
        _debug_msg(msg)
        count_stars._last_info = 'sliding_preferred'
        return sliding_count

    # 只有一种方法有结果
    if sliding_count > 0:
        msg = 'count_stars %s -> %d | sliding_only(%s)' % (debug_label, sliding_count, sliding_info)
        _debug_msg(msg)
        count_stars._last_info = 'sliding_only'
        return sliding_count

    if holistic_count > 0:
        msg = 'count_stars %s -> %d | holistic_only_%s=%.3f' % (debug_label, holistic_count, holistic_label, holistic_score)
        _debug_msg(msg)
        count_stars._last_info = 'holistic_only'
        return holistic_count

    # 两种方法都没检测到
    msg = 'count_stars %s -> 0 | both_failed' % debug_label
    _debug_msg(msg)
    count_stars._last_info = 'both_failed'
    return 0


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

def extract_player_alliance(blocks, side, img_h, img_array=None, img_w=0):
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

        # 🔥 新增：如果右侧顶部文本太少，说明OCR漏识别了，需要针对性补扫
        if side == 'right' and len(top_texts) < 2 and img_array is not None and img_w > 0:
            print(f'[补扫] 右侧顶部文本不足({len(top_texts)}个)，启动补扫...', file=sys.stderr, flush=True)
            # 右侧顶部联盟名区域通常在 x: 50%-75%, y: 5%-25%
            x1 = int(img_w * 0.50)
            x2 = int(img_w * 0.75)
            y1 = int(img_h * 0.05)
            y2 = int(img_h * 0.25)
            print(f'[补扫] 扫描区域: ({x1},{y1})-({x2},{y2})', file=sys.stderr, flush=True)
            # 对右侧顶部区域单独OCR（提高识别率）
            extra_blocks = ocr_region(img_array, x1, y1, x2, y2)
            print(f'[补扫] 识别到 {len(extra_blocks)} 个文本块', file=sys.stderr, flush=True)
            for b in extra_blocks:
                text = b['text']
                # 过滤掉明显不是玩家名/联盟名的文本
                if (2 <= len(text) <= 12
                    and not match_hero(text)
                    and not match_tactic(text)
                    and not match_formation(text)
                    and text not in WINNERS
                    and not re.match(r'^[\d×/：:]+$', text)
                    and not re.search(r'战损|总兵|补给|战果|统计|战报', text)
                    and not re.match(r'^S\d+$', text, re.IGNORECASE)
                    and not re.match(r'^[.。…·]+$', text)):
                    # 检查是否已存在
                    if not any(abs(b['x'] - t['x']) < 50 for t in top_texts):
                        print(f'[补扫] 添加文本: "{text}" at x={b["x"]}', file=sys.stderr, flush=True)
                        top_texts.append(b)
                    else:
                        print(f'[补扫] 跳过重复文本: "{text}"', file=sys.stderr, flush=True)
            top_texts = sorted(top_texts, key=lambda b: b['x'])
            print(f'[补扫] 补扫后共 {len(top_texts)} 个文本', file=sys.stderr, flush=True)

        if side == 'left':
            if len(top_texts) >= 1: player   = top_texts[0]['text']
            if len(top_texts) >= 2: alliance = top_texts[-1]['text']
        else:
            # 右侧：最右边是玩家名，左边是联盟名
            if len(top_texts) >= 1:
                player = top_texts[-1]['text']
            if len(top_texts) >= 2:
                alliance = top_texts[0]['text']
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
    player, alliance = extract_player_alliance(blocks, side, img_h, img_array, img_w)

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
                        label_config: dict,
                        hero_names: list = None,
                        tactic_names: list = None,
                        player_names: list = None,
                        alliance_names: list = None) -> dict:
    """
    使用手动标注的区域配置提取所有字段。
    hero_names / tactic_names：来自 ocr_hero_dict / ocr_tactic_dict，
    player_names / alliance_names：来自 project_player_dict，
    传入则优先使用，不传则回退全局列表或纯启发式匹配。
    返回与 process_side 兼容的结构。
    """
    _hero_names     = hero_names     if hero_names     else HERO_NAMES
    _tactic_names   = tactic_names   if tactic_names   else ALL_TACTICS
    _player_names   = player_names   if player_names   else []
    _alliance_names = alliance_names if alliance_names else []

    def _match_hero_local(text: str):
        # 与 match_hero() 完全一致的逻辑：先 strip leading digits，再检查残留数字
        cleaned = re.sub(r'^\d+', '', text).strip()
        if re.search(r'\d', cleaned):
            return None
        if len(cleaned) < 2 or len(cleaned) > 5:
            return None
        fixed = _fix_hero_chars(cleaned)
        name, dist = best_match(fixed, _hero_names)
        # 允许 dist=1：截断/形近字（如"葛亮"→"诸葛亮"、"甘夫"→"甘夫人"）
        threshold = 1
        return name if dist <= threshold else None

    def _match_tactic_local(text: str):
        cleaned = re.sub(r'^影本[·.•]', '', text).strip()
        cleaned = re.sub(r'[×xX※]\d+.*$', '', cleaned).strip()
        if cleaned in _TACTIC_NOISE or len(cleaned) < 2 or len(cleaned) > 6:
            return None
        name, dist = best_match(cleaned, _tactic_names)
        threshold = 2  # 统一阈值，兼容 OCR 形近字双错误
        return name if dist <= threshold else None
    result = {
        'leftGenerals': ['', '', ''], 'rightGenerals': ['', '', ''],
        'leftTactics': ['']*9, 'rightTactics': ['']*9,
        'leftStars': [0, 0, 0], 'rightStars': [0, 0, 0],
        'leftDamage': 0, 'rightDamage': 0,
        'leftTroops': 0, 'rightTroops': 0,
        'leftFormation': '', 'rightFormation': '',
        'leftPlayer': '', 'rightPlayer': '',
        'leftAlliance': '', 'rightAlliance': '',
        'winner': 'unknown',
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

    # ── 胜负 ──
    if 'winner' in label_config:
        for box in label_config['winner'].get('boxes', []):
            texts = ocr_box(box)
            for t in texts:
                if t in WINNERS:
                    result['winner'] = WINNER_MAP.get(t, 'unknown')
                    break

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
            hero = ''
            for t in texts:
                h = _match_hero_local(t)
                if h: hero = h; break
            # 单字被切开时尝试拼接重试
            if not hero and len(texts) > 1:
                parts = [re.sub(r'^\d+', '', t).strip() for t in texts]
                for i in range(len(parts) - 1):
                    h = _match_hero_local(parts[i] + parts[i + 1])
                    if h: hero = h; break
                if not hero:
                    h = _match_hero_local(''.join(parts))
                    if h: hero = h
            side, idx = key[0], int(key[1]) - 1
            if side == 'L':
                result['leftGenerals'][idx] = hero
            else:
                result['rightGenerals'][idx] = hero

    # ── 角色名称（玩家名）──
    def _best_name_local(texts, candidates, label_hint=''):
        """与 /test 路径 _best_name_from_dict 逻辑一致：模糊匹配字典或取最长有效文本"""
        def _is_hero_name_local(t):
            if not _hero_names: return False
            c = re.sub(r'^\d+', '', t).strip()
            if len(c) < 2 or len(c) > 5: return False
            _, d = best_match(c, _hero_names)
            return d <= (0 if len(c) == 2 else 1)
        def _is_tactic_name_local(t):
            if not _tactic_names: return False
            c = re.sub(r'^影本[·.•]', '', t).strip()
            if c in _TACTIC_NOISE or len(c) < 2 or len(c) > 6: return False
            nm, d = best_match(c, _tactic_names)
            return d <= (1 if len(nm) <= 4 else 2)
        valid = [t for t in texts if t and 2 <= len(t) <= 15
                 and not re.match(r'^[\d\s,./\\:：·•…×xX※\-_=+]+$', t)
                 and t not in WINNERS and t not in _TACTIC_NOISE
                 and not _is_hero_name_local(t) and not _is_tactic_name_local(t)]
        raw = max(valid, key=len) if valid else (texts[0] if texts else '')
        if not candidates or not raw:
            return raw
        name, dist = best_match(raw, candidates)
        threshold = 1 if len(raw) <= 4 else (2 if len(raw) <= 8 else 3)
        return name if dist <= threshold else raw

    if 'playerNames' in label_config:
        for box in label_config['playerNames'].get('boxes', []):
            key = box.get('key', '')
            texts = ocr_box(box)
            name = _best_name_local(texts, _player_names, f'玩家名-{key}')
            if key == 'left':
                result['leftPlayer'] = name
            else:
                result['rightPlayer'] = name

    # ── 同盟名称 ──
    if 'alliances' in label_config:
        for box in label_config['alliances'].get('boxes', []):
            key = box.get('key', '')
            texts = ocr_box(box)
            name = _best_name_local(texts, _alliance_names, f'同盟名-{key}')
            if key == 'left':
                result['leftAlliance'] = name
            else:
                result['rightAlliance'] = name

    # ── 战损数值 ──
    def _ocr_clean(t):
        """清理常见 OCR 数字混淆"""
        for old, new in [('O', '0'), ('o', '0'), ('l', '1'), ('I', '1'),
                         ('S', '5'), ('B', '8'), ('Z', '2'), ('g', '9')]:
            t = t.replace(old, new)
        return t

    def _extract_damage(texts):
        """提取战损数值：取"战损："冒号后的数字"""
        joined = ''.join(texts)
        cleaned = _ocr_clean(joined)
        # 优先：战损：<数字>
        m = re.search(r'战损[：:]\s*(\d[\d,]*)', cleaned)
        if m:
            return int(m.group(1).replace(',', ''))
        # 兜底：区域内第一个数字
        m = re.search(r'(\d[\d,]*)', cleaned)
        if m:
            return int(m.group(1).replace(',', ''))
        return 0

    def _extract_troops(texts):
        """提取兵力数值：取 XX/XX 斜杠右侧的数字（即最后一个数字）"""
        joined = ''.join(texts)
        cleaned = _ocr_clean(joined)
        # 优先：斜杠右侧数字（兼容斜杠被 OCR 误读为 l/1/| 等）
        m = re.search(r'\d[\d,]*\s*[/|\\l]\s*(\d[\d,]*)', cleaned)
        if m:
            return int(m.group(1).replace(',', ''))
        # 次选：取最后一个数字（XX/XX 中右侧总在最后）
        all_nums = re.findall(r'\d[\d,]*', cleaned)
        if len(all_nums) >= 2:
            return int(all_nums[-1].replace(',', ''))
        if all_nums:
            return int(all_nums[-1].replace(',', ''))
        return 0

    if 'damages' in label_config:
        for box in label_config['damages'].get('boxes', []):
            key = box.get('key', '')
            texts = ocr_box(box)
            num = _extract_damage(texts)
            if key == 'left':
                result['leftDamage'] = num
            else:
                result['rightDamage'] = num

    # ── 兵力数值 ──
    if 'troops' in label_config:
        for box in label_config['troops'].get('boxes', []):
            key = box.get('key', '')
            texts = ocr_box(box)
            num = _extract_troops(texts)
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
            if fm == '未知' and len(texts) > 1:
                mf = match_formation(''.join(texts))
                if mf: fm = mf
            # 兜底：宽松匹配（允许 2 字编辑距离）
            if fm == '未知':
                for t in texts:
                    if len(t) >= 2:
                        name, dist = best_match(t, FORMATIONS)
                        if dist <= 2:
                            fm = name
                            break
            if key == 'left':
                result['leftFormation'] = fm
            else:
                result['rightFormation'] = fm

    # ── 战法名 ──
    if 'tactics' in label_config:
        for box in label_config['tactics'].get('boxes', []):
            key = box.get('key', '')  # e.g. 'L1_2' -> side L, hero 1, slot 2
            texts = ocr_box(box)
            tac = ''
            for t in texts:
                matched = _match_tactic_local(t)
                if matched:
                    tac = matched
                    break
                # 文本有效但字典未命中 → 标记待确认
                cleaned = re.sub(r'^影本[·.•]', '', t).strip()
                cleaned = re.sub(r'[×xX※]\d+.*$', '', cleaned).strip()
                # 含数字的文本作为噪音跳过（与 match_hero / match_tactic 噪音处理一致）
                if re.search(r'\d', cleaned):
                    continue
                if cleaned and cleaned not in _TACTIC_NOISE and 2 <= len(cleaned) <= 6:
                    tac = '待确认:' + cleaned
                    break
            # key 格式: 'L1_1' → heroKey='L1', slot='1'
            parts = key.split('_')
            hero_key = parts[0]
            side = hero_key[0]
            hero_idx = int(hero_key[1]) - 1
            slot_idx = int(parts[1]) - 1
            arr = result['leftTactics'] if side == 'L' else result['rightTactics']
            arr[hero_idx * 3 + slot_idx] = tac

    return result


# ── API ──────────────────────────────────────────────────────────────
class OcrRequest(BaseModel):
    image: str = ''
    labelConfig: dict = None  # 标注区域配置（必须提供才能精确识别）
    heroNames: list = []      # 来自 ocr_hero_dict
    tacticNames: list = []    # 来自 ocr_tactic_dict
    playerNames: list = []    # 来自 project_player_dict.player_name
    allianceNames: list = []  # 来自 project_player_dict.alliance_name（去重）

@app.get('/health')
def health():
    return {'status': 'ok', 'engine': 'paddleocr-ppocrv5-v2'}

@app.post('/ocr')
def paddle_ocr(req: OcrRequest):
    img_arr = None
    b64 = None
    img_bytes = None
    img = None
    try:
        _maybe_gc()

        b64      = re.sub(r'^data:[^;]+;base64,', '', req.image)
        img_bytes = base64.b64decode(b64)
        img      = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        img_arr  = np.array(img)

        # 有标注配置：只用 extract_with_config，不再合并 analyze_battle
        if req.labelConfig and isinstance(req.labelConfig, dict) and len(req.labelConfig) > 0:
            h_names = req.heroNames if req.heroNames else None
            t_names = req.tacticNames if req.tacticNames else None
            p_names = req.playerNames if req.playerNames else None
            a_names = req.allianceNames if req.allianceNames else None
            record = extract_with_config(
                img_arr, img.width, img.height,
                req.labelConfig,
                hero_names=h_names,
                tactic_names=t_names,
                player_names=p_names,
                alliance_names=a_names,
            )
            # 日期由服务器 Node.js 设置，这里不填
            record['battleDate'] = ''
        else:
            # 无配置：回退旧版自动检测（兼容旧流程）
            record = analyze_battle(img_arr, img.width, img.height)

        import time as _time
        log_entry = {
            'ts': _time.strftime('%Y-%m-%d %H:%M:%S'),
            'w': img.width, 'h': img.height,
            'result': record
        }
        log_path = os.path.join(_here, 'ocr_debug.log')
        _rotate_log_if_needed(log_path)
        _rotate_log_if_needed(_debug_log)
        with open(log_path, 'a', encoding='utf-8') as lf:
            lf.write(json.dumps(log_entry, ensure_ascii=False) + '\n')

        return {'ok': True, **record}
    except Exception as e:
        import traceback
        return {'ok': False, 'error': str(e), 'trace': traceback.format_exc()}
    finally:
        # 显式释放大对象，辅助 GC
        if img_arr is not None:
            del img_arr
        if img is not None:
            del img
        if img_bytes is not None:
            del img_bytes
        if b64 is not None:
            del b64
        # 🔥 强制GC：每张图处理完立即释放内存
        import gc
        gc.collect()
        gc.collect()  # 二次GC确保循环引用被清理
        # 输出内存状态用于监控
        mem_pct = _sys_mem_pct()
        if mem_pct >= 85:
            print(f'[MEM-WARN] 处理完成后内存={mem_pct}%，接近阈值', file=sys.stderr, flush=True)


# ── 图片预上传缓存接口 ─────────────────────────────────────────────
class CacheImageRequest(BaseModel):
    image: str
    token: str = ''

@app.post('/cache-image')
def cache_image(req: CacheImageRequest):
    import time as _time, hashlib
    b64 = re.sub(r'^data:[^;]+;base64,', '', req.image)
    img_bytes = base64.b64decode(b64)
    token = req.token or hashlib.md5(img_bytes[:1024]).hexdigest()[:12]
    if token not in _img_cache:
        img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        img_arr = np.array(img)
        if len(_img_cache) >= _IMG_CACHE_MAX:
            oldest = next(iter(_img_cache))
            del _img_cache[oldest]
        _img_cache[token] = (img_arr, img.width, img.height)
        print(f'[缓存] 新增 token={token} {img.width}x{img.height}')
    else:
        print(f'[缓存] 命中 token={token}')
    return {'ok': True, 'token': token}


# ── 测试识别接口（不入库、不扣积分）─────────────────────────────────
class TestOcrRequest(BaseModel):
    image: str = ''
    imageToken: str = ''   # 已缓存图片的 token，有则跳过图片传输
    categories: dict = {}
    heroNames: list = []
    tacticNames: list = []
    playerNames: list = []   # 来自 project_player_dict.player_name
    allianceNames: list = [] # 来自 project_player_dict.alliance_name（去重）

@app.post('/test')
def test_ocr(req: TestOcrRequest):
    """逐字段识别并返回详细日志，用于调试区域配置"""
    logs = []

    def log(msg: str):
        logs.append(msg)

    try:
        import time as _time
        _t0 = _time.time()
        if req.imageToken and req.imageToken in _img_cache:
            img_arr, img_w, img_h = _img_cache[req.imageToken]
            log(f'[图像] {img_w}x{img_h} 像素  [缓存命中 token={req.imageToken}]')
        else:
            b64 = re.sub(r'^data:[^;]+;base64,', '', req.image)
            img_bytes = base64.b64decode(b64)
            _t_decode = _time.time()
            img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
            img_arr = np.array(img)
            img_w, img_h = img.width, img.height
            _t_img = _time.time()
            log(f'[图像] {img_w}x{img_h} 像素  [解码:{(_t_decode-_t0)*1000:.0f}ms 打开:{(_t_img-_t_decode)*1000:.0f}ms]')

        cats = req.categories
        if not cats:
            log('[配置] ⚠️ 未传入 categories，无法识别')
            return {'ok': False, 'logs': logs, 'result': {}}

        needs_dict = 'heroNames' in cats or 'tactics' in cats
        if needs_dict:
            h_names = req.heroNames if req.heroNames else HERO_NAMES
            t_names = req.tacticNames if req.tacticNames else ALL_TACTICS
            log(f'[字典] 武将 {len(h_names)} 条 / 战法 {len(t_names)} 条')
        else:
            h_names = []
            t_names = []

        p_names = req.playerNames if req.playerNames else []
        a_names = req.allianceNames if req.allianceNames else []
        if p_names or a_names:
            log(f'[名单] 玩家 {len(p_names)} 条 / 同盟 {len(a_names)} 条')

        def _best_name_from_dict(texts, candidates, label):
            """模糊匹配：有字典则查，无字典则取最长有效文本（排除武将名/战法名）"""
            def _is_hero_name(t):
                if not h_names: return False
                c = re.sub(r'^\d+', '', t).strip()
                if len(c) < 2 or len(c) > 5: return False
                _, d = best_match(c, h_names)
                return d <= (0 if len(c) == 2 else 1)
            def _is_tactic_name(t):
                if not t_names: return False
                c = re.sub(r'^影本[·.•]', '', t).strip()
                if c in _TACTIC_NOISE or len(c) < 2 or len(c) > 6: return False
                nm, d = best_match(c, t_names)
                return d <= (1 if len(nm) <= 4 else 2)
            valid = [t for t in texts if t and 2 <= len(t) <= 15
                     and not re.match(r'^[\d\s,./\\:：·•…×xX※\-_=+]+$', t)
                     and t not in WINNERS and t not in _TACTIC_NOISE
                     and not _is_hero_name(t) and not _is_tactic_name(t)]
            raw = max(valid, key=len) if valid else (texts[0] if texts else '')
            if not candidates or not raw:
                return raw
            name, dist = best_match(raw, candidates)
            # 容错阈值随长度增大：≤4字→1，≤8字→2，更长→3
            threshold = 1 if len(raw) <= 4 else (2 if len(raw) <= 8 else 3)
            if dist <= threshold:
                if dist > 0:
                    log(f'[{label}] ✅ "{raw}" → 字典匹配 "{name}" (距离{dist})')
                return name
            else:
                log(f'[{label}] ⚠️ "{raw}" 无字典匹配 (最近:"{name}" 距离{dist}) → 保留原文')
                return raw

        result = {}

        def to_abs(rx, ry):
            return int(rx * img_w), int(ry * img_h)

        def ocr_box_v(box, label):
            x1, y1 = to_abs(box['rx1'], box['ry1'])
            x2, y2 = to_abs(box['rx2'], box['ry2'])
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(img_w, x2), min(img_h, y2)
            if x2 <= x1 or y2 <= y1:
                log(f'[{label}] ⚠️ 区域无效 ({x1},{y1})-({x2},{y2})')
                return []
            blocks = ocr_region(img_arr, x1, y1, x2, y2)
            texts = [b['text'] for b in blocks]
            log(f'[{label}] 区域 ({x1},{y1})-({x2},{y2}) → OCR: {texts}')
            return texts

        def _best_hero(texts, label):
            # 生成候选：原始各文本 + 两两拼接 + 全部拼接（处理单字被切开的情况）
            # 预处理：先去掉前导数字（如"50 司马懿"→"司马懿"），再过滤仍含数字的噪音
            texts = [re.sub(r'^\d+\s*', '', t).strip() for t in texts]
            texts = [t for t in texts if t and not re.search(r'\d', t)]
            candidates = list(texts)
            if len(texts) > 1:
                for i in range(len(texts) - 1):
                    pair = texts[i] + texts[i + 1]
                    if pair not in candidates:
                        candidates.append(pair)
                full = ''.join(texts)
                if full not in candidates:
                    candidates.append(full)
            for t in candidates:
                if len(t) < 2 or len(t) > 5:
                    continue
                fixed = _fix_hero_chars(t)
                name, dist = best_match(fixed, h_names)
                threshold = 1  # 允许截断/形近字（如"葛亮"→"诸葛亮"）
                if dist <= threshold:
                    log(f'[{label}] ✅ "{t}" → 字典匹配 "{name}" (距离{dist})')
                    return name
                else:
                    log(f'[{label}] ❌ "{t}" → 最近 "{name}" 距离{dist} (超阈值)')
            return ''

        def _best_tactic(texts, label):
            for t in texts:
                cleaned = re.sub(r'^影本[·.•]', '', t).strip()
                cleaned = re.sub(r'[×xX※]\d+.*$', '', cleaned).strip()
                if cleaned in _TACTIC_NOISE or len(cleaned) < 2 or len(cleaned) > 6:
                    log(f'[{label}] ⏭️ 跳过噪音: "{t}"')
                    continue
                name, dist = best_match(cleaned, t_names)
                threshold = 2  # 统一阈值，兼容 OCR 形近字双错误
                if dist <= threshold:
                    log(f'[{label}] ✅ "{cleaned}" → 字典匹配 "{name}" (距离{dist})')
                    return name
                else:
                    log(f'[{label}] ❓ "{cleaned}" → 最近 "{name}" 距离{dist} (未命中字典，标记待确认)')
                    return '待确认:' + cleaned
            return ''

        def _ocr_clean_v(t):
            for old, new_c in [('O','0'),('o','0'),('l','1'),('I','1'),('S','5'),('B','8'),('Z','2'),('g','9')]:
                t = t.replace(old, new_c)
            return t

        def _extract_damage_v(texts, label):
            """提取战损数值：取"战损："冒号后的数字"""
            joined = _ocr_clean_v(''.join(texts))
            m = re.search(r'战损[：:]\s*(\d[\d,]*)', joined)
            if m:
                n = int(m.group(1).replace(',', ''))
                log(f'[{label}] 战损冒号后: "{m.group(0)}" → {n} ✅')
                return n
            m = re.search(r'(\d[\d,]*)', joined)
            if m:
                n = int(m.group(1).replace(',', ''))
                log(f'[{label}] 兜底数字: {n}')
                return n
            log(f'[{label}] ❌ 未找到数字: {texts}')
            return 0

        def _extract_troops_v(texts, label):
            """提取兵力数值：取 XX/XX 斜杠右侧的数字（即最后一个数字）"""
            joined = _ocr_clean_v(''.join(texts))
            # 优先：斜杠右侧数字（兼容斜杠被 OCR 误读为 l/1/| 等）
            m = re.search(r'\d[\d,]*\s*[/|\\l]\s*(\d[\d,]*)', joined)
            if m:
                n = int(m.group(1).replace(',', ''))
                log(f'[{label}] 斜杠右侧: "{m.group(0)}" → {n} ✅')
                return n
            # 次选：取最后一个数字（XX/XX 中右侧总在最后）
            all_nums = re.findall(r'\d[\d,]*', joined)
            if len(all_nums) >= 2:
                n = int(all_nums[-1].replace(',', ''))
                log(f'[{label}] 最后数字(共{len(all_nums)}个): {n} ✅')
                return n
            if all_nums:
                n = int(all_nums[-1].replace(',', ''))
                log(f'[{label}] 兜底数字: {n}')
                return n
            log(f'[{label}] ❌ 未找到数字: {texts}')
            return 0

        # ── 胜负 ──
        if 'winner' in cats:
            for box in cats['winner'].get('boxes', []):
                texts = ocr_box_v(box, '胜负')
                for t in texts:
                    if t in WINNERS:
                        result['winner'] = WINNER_MAP.get(t, t)
                        log(f'[胜负] ✅ 识别: "{t}" → {result["winner"]}')
                        break
                else:
                    log(f'[胜负] ❌ 未匹配胜/败/平: {texts}')

        # ── 玩家名 ──
        if 'playerNames' in cats:
            for box in cats['playerNames'].get('boxes', []):
                key = box.get('key', '')
                texts = ocr_box_v(box, f'玩家名-{key}')
                name = _best_name_from_dict(texts, p_names, f'玩家名-{key}')
                if key == 'left': result['leftPlayer'] = name
                else: result['rightPlayer'] = name
                log(f'[玩家名-{key}] → "{name}"')

        # ── 同盟名 ──
        if 'alliances' in cats:
            for box in cats['alliances'].get('boxes', []):
                key = box.get('key', '')
                texts = ocr_box_v(box, f'同盟名-{key}')
                name = _best_name_from_dict(texts, a_names, f'同盟名-{key}')
                if key == 'left': result['leftAlliance'] = name
                else: result['rightAlliance'] = name
                log(f'[同盟名-{key}] → "{name}"')

        # ── 阵型 ──
        if 'formations' in cats:
            for box in cats['formations'].get('boxes', []):
                key = box.get('key', '')
                texts = ocr_box_v(box, f'阵型-{key}')
                fm = ''
                for t in texts:
                    mf = match_formation(t)
                    if mf:
                        fm = mf
                        log(f'[阵型-{key}] ✅ "{t}" → "{fm}"')
                        break
                if not fm and len(texts) > 1:
                    concat = ''.join(texts)
                    mf = match_formation(concat)
                    if mf:
                        fm = mf
                        log(f'[阵型-{key}] ✅ 拼接"{concat}" → "{fm}"')
                if not fm:
                    log(f'[阵型-{key}] ❌ 未匹配: {texts}')
                if key == 'left': result['leftFormation'] = fm
                else: result['rightFormation'] = fm

        # ── 武将名 ──
        left_generals = ['', '', '']
        right_generals = ['', '', '']
        if 'heroNames' in cats:
            for box in cats['heroNames'].get('boxes', []):
                key = box.get('key', '')
                texts = ocr_box_v(box, f'武将-{key}')
                hero = _best_hero(texts, f'武将-{key}')
                side, idx = key[0], int(key[1]) - 1
                if side == 'L': left_generals[idx] = hero
                else: right_generals[idx] = hero
        if 'heroNames' in cats:
            result['leftGenerals'] = left_generals
            result['rightGenerals'] = right_generals

        # ── 豆豆（双校验）──
        stars_result = {}  # 单框测试：只返回实际识别的框
        if 'stars' in cats:
            for box in cats['stars'].get('boxes', []):
                key = box.get('key', '')
                x1, y1 = to_abs(box['rx1'], box['ry1'])
                x2, y2 = to_abs(box['rx2'], box['ry2'])
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(img_w, x2), min(img_h, y2)
                if x2 <= x1 or y2 <= y1:
                    log(f'[豆豆-{key}] ⚠️ 区域无效')
                    continue
                crop = img_arr[y1:y2, x1:x2]
                ch2, cw2 = crop.shape[:2]

                # 调试：保存裁剪区域到磁盘
                debug_crop_path = os.path.join(_here, f'debug_crop_{key}.png')
                crop_bgr_for_save = cv2.cvtColor(crop, cv2.COLOR_RGB2BGR)
                cv2.imwrite(debug_crop_path, crop_bgr_for_save)
                log(f'[豆豆-{key}] 裁剪区域: ({x1},{y1})-({x2},{y2}) {cw2}x{ch2}px → {debug_crop_path}')

                crop_bgr2 = cv2.cvtColor(crop, cv2.COLOR_RGB2BGR)
                crop_gray2 = cv2.cvtColor(crop_bgr2, cv2.COLOR_BGR2GRAY)
                clahe2 = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                crop_clahe2 = clahe2.apply(crop_gray2)
                # 直接调用统一的 count_stars() 函数
                tpl_n = count_stars(img_arr, x1, y1, x2, y2, key)
                # 获取详细信息用于前端日志
                tpl_info2 = getattr(count_stars, '_last_info', 'no_info')
                if tpl_n > 0:
                    log(f'[豆豆-{key}] ✅ {tpl_n} 颗 ({tpl_info2})')
                else:
                    log(f'[豆豆-{key}] ❌ 未匹配 ({tpl_info2})')
                # 单框模式：按key单独返回，不汇总成数组
                stars_result[key] = tpl_n
        if stars_result:
            result['stars'] = stars_result

        # ── 战损 ──
        if 'damages' in cats:
            for box in cats['damages'].get('boxes', []):
                key = box.get('key', '')
                texts = ocr_box_v(box, f'战损-{key}')
                n = _extract_damage_v(texts, f'战损-{key}')
                if key == 'left': result['leftDamage'] = n
                else: result['rightDamage'] = n

        # ── 兵力 ──
        if 'troops' in cats:
            for box in cats['troops'].get('boxes', []):
                key = box.get('key', '')
                texts = ocr_box_v(box, f'兵力-{key}')
                n = _extract_troops_v(texts, f'兵力-{key}')
                if key == 'left': result['leftTroops'] = n
                else: result['rightTroops'] = n

        # ── 战法 ──
        left_tactics = [''] * 9
        right_tactics = [''] * 9
        if 'tactics' in cats:
            for box in cats['tactics'].get('boxes', []):
                key = box.get('key', '')  # e.g. 'L1_2'
                texts = ocr_box_v(box, f'战法-{key}')
                tac = _best_tactic(texts, f'战法-{key}')
                parts = key.split('_')
                hero_key = parts[0]  # 'L1'
                slot = int(parts[1]) - 1 if len(parts) > 1 else 0
                side3 = hero_key[0]
                hidx = int(hero_key[1]) - 1
                arr = left_tactics if side3 == 'L' else right_tactics
                arr[hidx * 3 + slot] = tac
        if 'tactics' in cats:
            result['leftTactics'] = left_tactics
            result['rightTactics'] = right_tactics

        summary_parts = []
        for k, v in result.items():
            if v is None or v == '' or v == 0 or v == [] or v == ['', '', ''] or v == [''] * 9 or v == [0, 0, 0] or v == [0] * 9:
                continue
            summary_parts.append(f'{k}={v}')
        if summary_parts:
            log(f'[结果] ' + ' | '.join(summary_parts))
        else:
            log('[结果] ⚠️ 所有字段均为空，请检查区域坐标或图片')
        _elapsed = _time.time() - _t0
        log(f'[耗时] {_elapsed:.2f}s（共 {len(cats)} 个category）')
        return {'ok': True, 'result': result, 'logs': logs}

    except Exception as e:
        import traceback
        logs.append(f'[错误] {str(e)}')
        return {'ok': False, 'error': str(e), 'logs': logs, 'trace': traceback.format_exc()}


class TestStarsRequest(BaseModel):
    image: str = ''
    imageToken: str = ''
    categories: dict = {}
    mode: str = 'both'  # 'color' | 'template' | 'both'

@app.post('/test-stars')
def test_stars(req: TestStarsRequest):
    """豆豆专项测试：支持颜色法单独 / 模板法单独 / 双校验整体"""
    logs = []

    def log(msg: str):
        logs.append(msg)

    try:
        if req.imageToken and req.imageToken in _img_cache:
            img_arr, img_w, img_h = _img_cache[req.imageToken]
            log(f'[图像] {img_w}x{img_h} / 模式: {req.mode} [缓存命中 token={req.imageToken}]')
        elif req.image:
            # 从base64加载图像
            b64 = re.sub(r'^data:[^;]+;base64,', '', req.image)
            img_bytes = base64.b64decode(b64)
            img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
            img_arr = np.array(img)
            img_w, img_h = img.width, img.height
            log(f'[图像] {img_w}x{img_h} / 模式: {req.mode}')
            # 如果有token，缓存图像以便下次使用
            if req.imageToken:
                _img_cache[req.imageToken] = (img_arr, img_w, img_h)
                log(f'[缓存] 已缓存图像 token={req.imageToken}')
        else:
            log('[错误] 缺少图像数据：imageToken缓存未命中且未提供image base64')
            return {'ok': False, 'error': '缺少图像数据', 'logs': logs}

        cats = req.categories
        star_boxes = cats.get('stars', {}).get('boxes', [])
        if not star_boxes:
            log('[豆豆] ⚠️ categories 中无 stars 区域配置')
            return {'ok': False, 'logs': logs, 'result': {}}

        result = {}
        for box in star_boxes:
            key = box.get('key', '?')
            x1 = max(0, int(box['rx1'] * img_w))
            y1 = max(0, int(box['ry1'] * img_h))
            x2 = min(img_w, int(box['rx2'] * img_w))
            y2 = min(img_h, int(box['ry2'] * img_h))
            if x2 <= x1 or y2 <= y1:
                log(f'[豆豆-{key}] ⚠️ 区域无效 ({x1},{y1})-({x2},{y2})')
                result[key] = {'color': -1, 'template': -1, 'final': -1}
                continue

            w = x2 - x1
            h = y2 - y1
            log(f'[豆豆-{key}] 区域 ({x1},{y1})-({x2},{y2}) 尺寸 {w}x{h}')

            # 使用统一的 count_stars 函数（HSV颜色投影法）
            final = count_stars(img_arr, x1, y1, x2, y2, key)

            if final > 0:
                log(f'[豆豆-{key}] ✅ {final} 颗 ({count_stars._last_info})')
            else:
                log(f'[豆豆-{key}] ❌ 未匹配 ({count_stars._last_info})')

            result[key] = {'color': final, 'template': final, 'final': final}

        return {'ok': True, 'result': result, 'logs': logs}

    except Exception as e:
        import traceback
        logs.append(f'[错误] {str(e)}')
        return {'ok': False, 'error': str(e), 'logs': logs, 'trace': traceback.format_exc()}


def _mem_watchdog_thread():
    """后台线程：每 30s 主动检查系统内存，超过阈值时强制重启，不依赖请求触发"""
    CHECK_INTERVAL = 30
    while True:
        time.sleep(CHECK_INTERVAL)
        mem_pct = _sys_mem_pct()
        if mem_pct >= _MEM_RESTART_PCT:
            print(f'[MEM-WATCHDOG] 系统内存 {mem_pct}% >= {_MEM_RESTART_PCT}%，主动退出(42)让 watchdog 重启',
                  file=sys.stderr, flush=True)
            os._exit(42)  # 强制退出，不等待 uvicorn 优雅关闭（内存已告急）

if __name__ == '__main__':
    t = threading.Thread(target=_mem_watchdog_thread, daemon=True, name='mem-watchdog')
    t.start()
    print(f'[MEM-WATCHDOG] 后台内存监控已启动，阈值={_MEM_RESTART_PCT}%，检查间隔=30s', file=sys.stderr, flush=True)
    uvicorn.run(app, host='127.0.0.1', port=8003, log_level='warning')
