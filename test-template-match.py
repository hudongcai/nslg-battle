#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""测试模板匹配 - 诊断为什么 debug_crop_L1.png 识别不到星星"""

import cv2
import numpy as np
import os
import glob
import sys

# 设置UTF-8输出
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 加载裁剪图
crop_path = 'debug_crop_L1.png'
if not os.path.exists(crop_path):
    print(f'[X] 找不到: {crop_path}')
    exit(1)

crop = cv2.imread(crop_path)
print(f'[OK] 裁剪图: {crop.shape[1]}x{crop.shape[0]} 像素')

# 转灰度和CLAHE增强
crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
crop_clahe = clahe.apply(crop_gray)

# 保存增强后的图像，方便查看
cv2.imwrite('debug_crop_L1_clahe.png', crop_clahe)
print(f'[OK] CLAHE增强图: debug_crop_L1_clahe.png')

# 加载模板
tpl_dir = 'dot_templates_out'
if not os.path.isdir(tpl_dir):
    print(f'[X] 模板目录不存在: {tpl_dir}')
    exit(1)

ref_files = sorted(glob.glob(os.path.join(tpl_dir, '*_ref.png')))
print(f'\n[INFO] 找到 {len(ref_files)} 个模板')

# 测试参数
scales = [0.08, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20]
thresholds = [0.70, 0.60, 0.55, 0.50]

ch, cw = crop_gray.shape[:2]
print(f'裁剪图尺寸: {cw}x{ch}')

best_overall = None

for ref_path in ref_files[:5]:  # 只测试前5个模板
    name = os.path.basename(ref_path).replace('_ref.png', '')
    tpl_rgba = cv2.imread(ref_path, cv2.IMREAD_UNCHANGED)
    if tpl_rgba is None or len(tpl_rgba.shape) < 3 or tpl_rgba.shape[2] != 4:
        continue

    # 提取灰度模板
    alpha = tpl_rgba[:, :, 3].astype(np.float32) / 255.0
    bgr = tpl_rgba[:, :, :3].astype(np.float32)
    masked = bgr * alpha[:, :, np.newaxis] + 128.0 * (1.0 - alpha[:, :, np.newaxis])
    masked = masked.astype(np.uint8)
    tpl_gray = cv2.cvtColor(masked, cv2.COLOR_BGR2GRAY)

    th, tw = tpl_gray.shape[:2]
    print(f'\n[TEST] 测试模板: {name} ({tw}x{th})')

    best_for_tpl = {'scale': 0, 'th': 0, 'count': 0, 'max_score': 0}

    for threshold in thresholds:
        for scale in scales:
            sw = max(4, int(tw * scale))
            sh = max(4, int(th * scale))
            if sw >= cw or sh >= ch:
                continue

            tpl_s = cv2.resize(tpl_gray, (sw, sh), interpolation=cv2.INTER_AREA)

            # 在CLAHE增强图上匹配
            res = cv2.matchTemplate(crop_clahe, tpl_s, cv2.TM_CCOEFF_NORMED)
            ys, xs = np.where(res >= threshold)

            if len(xs) > 0:
                max_score = res[ys, xs].max()
                if len(xs) > best_for_tpl['count']:
                    best_for_tpl = {
                        'scale': scale,
                        'th': threshold,
                        'count': len(xs),
                        'max_score': max_score
                    }

    if best_for_tpl['count'] > 0:
        print(f'  [OK] 最佳匹配: scale={best_for_tpl["scale"]}, th={best_for_tpl["th"]}, '
              f'count={best_for_tpl["count"]}, max_score={best_for_tpl["max_score"]:.3f}')

        if best_overall is None or best_for_tpl['count'] > best_overall['count']:
            best_overall = best_for_tpl.copy()
            best_overall['name'] = name
    else:
        print(f'  [X] 无匹配')

print('\n' + '='*60)
if best_overall:
    print(f'[BEST] 最佳结果: {best_overall["name"]}')
    print(f'   scale={best_overall["scale"]}, threshold={best_overall["th"]}')
    print(f'   匹配点数={best_overall["count"]}, 最高分={best_overall["max_score"]:.3f}')
else:
    print('[X] 所有模板都无法匹配')
    print('\n[INFO] 可能原因:')
    print('   1. 阈值太高（当前最低0.50）')
    print('   2. 尺度范围不对（当前0.08-0.20）')
    print('   3. 模板和实际星星差异太大')
    print('   4. 需要使用颜色特征而不是灰度模板')

print('\n[INFO] 建议:')
print('   1. 查看 debug_crop_L1_clahe.png 看增强效果')
print('   2. 对比模板图 (dot_templates_out/*_ref.png)')
print('   3. 如果差异大，需要重新提取模板')
