#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
统一OCR服务 - 文字识别 + 深度学习红度识别
端口: 5000
提供完整的OCR解决方案：PaddleOCR文字识别 + ResNet18深度学习红度识别
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
import torch.nn as nn
from torchvision import transforms, models
from PIL import Image
import numpy as np
import io
import base64
import requests
import sys

app = Flask(__name__)
CORS(app)

# ==================== 深度学习红度识别 ====================
model = None
device = None
transform = None

REGIONS = {
    'L1': {'rx1': 0.010, 'ry1': 0.470, 'rx2': 0.124, 'ry2': 0.532},
    'L2': {'rx1': 0.148, 'ry1': 0.475, 'rx2': 0.260, 'ry2': 0.527},
    'L3': {'rx1': 0.279, 'ry1': 0.468, 'rx2': 0.402, 'ry2': 0.531},
    'R1': {'rx1': 0.598, 'ry1': 0.468, 'rx2': 0.716, 'ry2': 0.525},
    'R2': {'rx1': 0.732, 'ry1': 0.460, 'rx2': 0.853, 'ry2': 0.536},
    'R3': {'rx1': 0.868, 'ry1': 0.463, 'rx2': 0.993, 'ry2': 0.539}
}

def load_star_model():
    """加载深度学习红度识别模型"""
    global model, device, transform

    print("加载深度学习红度识别模型...")

    device = torch.device("cpu")

    # 创建ResNet18模型
    model = models.resnet18(weights=None)
    num_features = model.fc.in_features
    model.fc = nn.Linear(num_features, 6)

    # 加载权重
    checkpoint = torch.load(r"C:\nslg-battle\star_classifier_v2.pth", map_location=device)
    model.load_state_dict(checkpoint['model_state_dict'])

    model = model.to(device)
    model.eval()

    # 定义预处理
    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    accuracy = checkpoint.get('test_accuracy', 96.4)
    print(f"[OK] 深度学习模型加载完成 (准确率: {accuracy:.1f}%)", file=sys.stderr)

def predict_stars(crop_image):
    """预测单个区域的红度"""
    with torch.no_grad():
        img_tensor = transform(crop_image).unsqueeze(0).to(device)
        output = model(img_tensor)
        _, predicted = torch.max(output, 1)

        probabilities = torch.softmax(output, dim=1)
        confidence = probabilities[0][predicted].item()

        return predicted.item(), confidence

def recognize_stars_from_image(img):
    """从PIL图像识别所有6个位置的红度"""
    img_array = np.array(img)
    img_h, img_w = img_array.shape[:2]

    results = {}
    confidences = {}

    for key, region in REGIONS.items():
        x1 = int(region['rx1'] * img_w)
        y1 = int(region['ry1'] * img_h)
        x2 = int(region['rx2'] * img_w)
        y2 = int(region['ry2'] * img_h)

        crop = img_array[y1:y2, x1:x2]
        crop_pil = Image.fromarray(crop)

        prediction, confidence = predict_stars(crop_pil)

        results[key] = prediction
        confidences[key] = round(confidence, 3)

    return {
        'leftStars': [results['L1'], results['L2'], results['L3']],
        'rightStars': [results['R1'], results['R2'], results['R3']],
        'confidence': confidences,
        'avgConfidence': round(sum(confidences.values()) / len(confidences), 3)
    }

# ==================== PaddleOCR文字识别 ====================
PADDLE_OCR_URL = 'http://localhost:8003/ocr'

def call_paddle_ocr(image_base64, label_config=None):
    """调用PaddleOCR服务进行文字识别"""
    try:
        payload = {'image': image_base64}
        if label_config:
            payload['labelConfig'] = label_config

        response = requests.post(
            PADDLE_OCR_URL,
            json=payload,
            timeout=30
        )

        if response.status_code == 200:
            return response.json()
        else:
            print(f"PaddleOCR调用失败: {response.status_code}", file=sys.stderr)
            return None

    except Exception as e:
        print(f"PaddleOCR调用异常: {e}", file=sys.stderr)
        return None

# ==================== HTTP API ====================

@app.route('/health', methods=['GET'])
def health_check():
    """健康检查"""
    return jsonify({
        'status': 'ok',
        'model_loaded': model is not None,
        'services': {
            'deepLearning': model is not None,
            'paddleOCR': PADDLE_OCR_URL
        }
    })

@app.route('/predict', methods=['POST'])
def predict_stars_only():
    """
    只识别红度（保持向后兼容）

    请求: {"image": "base64..."}
    返回: {"success": true, "leftStars": [...], "rightStars": [...], ...}
    """
    try:
        data = request.json

        if 'image' not in data:
            return jsonify({'success': False, 'error': '缺少image参数'}), 400

        # 解码图片
        image_data = base64.b64decode(data['image'])
        img = Image.open(io.BytesIO(image_data)).convert('RGB')

        # 识别红度
        stars_result = recognize_stars_from_image(img)

        return jsonify({
            'success': True,
            **stars_result
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/ocr-full', methods=['POST'])
def ocr_full():
    """
    完整OCR：文字识别 + 深度学习红度识别

    请求格式：
    {
        "image": "base64编码的图片",
        "labelConfig": {...}  // 可选，OCR采集模板配置
    }

    返回格式：
    {
        "ok": true,
        "leftGenerals": [...],
        "rightGenerals": [...],
        "leftTactics": [...],
        "rightTactics": [...],
        "leftStars": [...],     // 深度学习识别（96.4%准确率）
        "rightStars": [...],    // 深度学习识别（96.4%准确率）
        "leftDamage": 0,
        "rightDamage": 0,
        ...
        "_starsMethod": "deeplearning",
        "_starsConfidence": 0.92
    }
    """
    try:
        data = request.json

        if 'image' not in data:
            return jsonify({'ok': False, 'error': '缺少image参数'}), 400

        image_base64 = data['image']
        label_config = data.get('labelConfig', None)

        # 步骤1：调用PaddleOCR进行文字识别
        print("[统一OCR] 调用PaddleOCR进行文字识别...", file=sys.stderr)
        paddle_result = call_paddle_ocr(image_base64, label_config)

        if not paddle_result or not paddle_result.get('ok'):
            return jsonify({
                'ok': False,
                'error': 'PaddleOCR识别失败'
            }), 500

        # 步骤2：使用深度学习识别红度
        print("[统一OCR] 使用深度学习识别红度...", file=sys.stderr)
        image_data = base64.b64decode(image_base64)
        img = Image.open(io.BytesIO(image_data)).convert('RGB')
        stars_result = recognize_stars_from_image(img)

        # 步骤3：合并结果（用深度学习红度替换PaddleOCR的红度）
        result = {**paddle_result}

        # 替换红度为深度学习结果
        result['leftGeneral1Stars'] = stars_result['leftStars'][0]
        result['leftGeneral2Stars'] = stars_result['leftStars'][1]
        result['leftGeneral3Stars'] = stars_result['leftStars'][2]
        result['rightGeneral1Stars'] = stars_result['rightStars'][0]
        result['rightGeneral2Stars'] = stars_result['rightStars'][1]
        result['rightGeneral3Stars'] = stars_result['rightStars'][2]

        # 添加红度识别元信息
        result['_starsMethod'] = 'deeplearning'
        result['_starsConfidence'] = stars_result['avgConfidence']
        result['_starsConfidenceDetail'] = stars_result['confidence']

        print(f"[统一OCR] ✓ 识别完成 | 红度置信度: {stars_result['avgConfidence']:.3f}", file=sys.stderr)

        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/predict-region', methods=['POST'])
def predict_region():
    """
    预测单个区域（保持向后兼容）

    请求: {"image": "base64...", "region": "L1"}
    返回: {"success": true, "region": "L1", "stars": 3, "confidence": 0.95}
    """
    try:
        data = request.json

        if 'image' not in data or 'region' not in data:
            return jsonify({'success': False, 'error': '缺少参数'}), 400

        region_key = data['region']
        if region_key not in REGIONS:
            return jsonify({'success': False, 'error': f'无效的region: {region_key}'}), 400

        # 解码图片
        image_data = base64.b64decode(data['image'])
        img = Image.open(io.BytesIO(image_data)).convert('RGB')
        img_array = np.array(img)
        img_h, img_w = img_array.shape[:2]

        # 裁剪区域
        region = REGIONS[region_key]
        x1 = int(region['rx1'] * img_w)
        y1 = int(region['ry1'] * img_h)
        x2 = int(region['rx2'] * img_w)
        y2 = int(region['ry2'] * img_h)

        crop = img_array[y1:y2, x1:x2]
        crop_pil = Image.fromarray(crop)

        prediction, confidence = predict_stars(crop_pil)

        return jsonify({
            'success': True,
            'region': region_key,
            'stars': prediction,
            'confidence': round(confidence, 3)
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/test-stars', methods=['POST'])
def test_stars():
    """
    豆豆专项测试接口（使用深度学习模型）

    请求格式：
    {
        "image": "base64...",
        "imageToken": "",
        "categories": {
            "stars": {
                "boxes": [
                    {"key": "L1", "rx1": 0.01, "ry1": 0.47, "rx2": 0.12, "ry2": 0.53},
                    ...
                ]
            }
        },
        "mode": "both"  // 兼容参数，实际使用深度学习
    }

    返回格式（兼容8003端口格式）：
    {
        "ok": true,
        "result": {
            "L1": 2,
            "L2": 3,
            ...
        },
        "logs": [
            "[图像] 2513x1154 / 模式: deeplearning",
            "[豆豆-L1] ✅ 2 颗 (deeplearning, 置信度: 0.95)",
            ...
        ]
    }
    """
    try:
        data = request.json
        logs = []

        # 解码图片（兼容 image 和 imageBase64 两种字段名）
        image_base64 = data.get('image') or data.get('imageBase64')
        if not image_base64:
            return jsonify({'ok': False, 'error': '缺少image或imageBase64参数', 'logs': logs}), 400
        # 去除data:image前缀
        if ',' in image_base64:
            image_base64 = image_base64.split(',', 1)[1]

        image_data = base64.b64decode(image_base64)
        img = Image.open(io.BytesIO(image_data)).convert('RGB')
        img_w, img_h = img.size

        logs.append(f'[图像] {img_w}x{img_h} / 模式: deeplearning')

        # 获取categories配置
        categories = data.get('categories', {})
        star_boxes = categories.get('stars', {}).get('boxes', [])

        if not star_boxes:
            logs.append('[豆豆] ⚠️ categories 中无 stars 区域配置')
            return jsonify({'ok': False, 'logs': logs, 'result': {}})

        # 使用深度学习模型识别每个区域
        result = {}
        img_array = np.array(img)

        for box in star_boxes:
            key = box.get('key', '?')
            x1 = max(0, int(box['rx1'] * img_w))
            y1 = max(0, int(box['ry1'] * img_h))
            x2 = min(img_w, int(box['rx2'] * img_w))
            y2 = min(img_h, int(box['ry2'] * img_h))

            if x2 <= x1 or y2 <= y1:
                logs.append(f'[豆豆-{key}] ⚠️ 区域无效 ({x1},{y1})-({x2},{y2})')
                result[key] = -1
                continue

            # 裁剪区域
            crop = img_array[y1:y2, x1:x2]
            crop_pil = Image.fromarray(crop)

            # 深度学习预测
            prediction, confidence = predict_stars(crop_pil)

            result[key] = prediction
            logs.append(f'[豆豆-{key}] 区域 ({x1},{y1})-({x2},{y2}) 尺寸 {x2-x1}x{y2-y1}')
            logs.append(f'[豆豆-{key}] ✅ {prediction} 颗 (deeplearning, 置信度: {confidence:.2f})')

        return jsonify({
            'ok': True,
            'result': result,
            'logs': logs
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e), 'logs': logs}), 500


if __name__ == '__main__':
    # 加载深度学习模型
    load_star_model()

    # 启动服务
    print("\n" + "="*60, file=sys.stderr)
    print("统一OCR服务启动中...", file=sys.stderr)
    print("="*60, file=sys.stderr)
    print(f"地址: http://127.0.0.1:5000", file=sys.stderr)
    print(f"健康检查: http://127.0.0.1:5000/health", file=sys.stderr)
    print(f"", file=sys.stderr)
    print(f"功能:", file=sys.stderr)
    print(f"  - /ocr-full     - 完整OCR (文字 + 深度学习红度)", file=sys.stderr)
    print(f"  - /predict      - 仅红度识别 (向后兼容)", file=sys.stderr)
    print(f"  - /predict-region - 单区域红度 (向后兼容)", file=sys.stderr)
    print(f"", file=sys.stderr)
    print(f"依赖:", file=sys.stderr)
    print(f"  - PaddleOCR服务: {PADDLE_OCR_URL}", file=sys.stderr)
    print(f"", file=sys.stderr)
    print("按Ctrl+C停止服务", file=sys.stderr)
    print("="*60 + "\n", file=sys.stderr)

    app.run(host='127.0.0.1', port=5000, debug=False)
