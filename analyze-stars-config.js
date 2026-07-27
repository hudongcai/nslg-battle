const mysql = require('mysql2/promise');

async function analyzStarsConfig() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 豆豆识别问题诊断 ===\n');

    // 获取全局配置
    const [globalConfig] = await pool.query(
      'SELECT image_width, image_height, categories_json FROM label_configs WHERE project_id = 0 LIMIT 1'
    );

    if (globalConfig.length === 0) {
      console.log('❌ 没有全局配置');
      return;
    }

    const cfg = globalConfig[0];
    const configWidth = cfg.image_width;
    const configHeight = cfg.image_height;
    const testWidth = 2513;
    const testHeight = 1154;

    console.log('1. 配置信息：');
    console.log(`  配置基准分辨率: ${configWidth} x ${configHeight}`);
    console.log(`  测试图片分辨率: ${testWidth} x ${testHeight}`);
    console.log(`  比例: ${(testWidth/configWidth).toFixed(4)} x ${(testHeight/configHeight).toFixed(4)}`);
    console.log('');

    const categories = JSON.parse(cfg.categories_json);

    if (!categories.stars) {
      console.log('❌ 配置中没有 stars (豆豆) 字段！');
      return;
    }

    console.log('2. 全局配置中的豆豆区域（相对坐标）：');
    console.log('');

    const starsBoxes = categories.stars.boxes || [];
    starsBoxes.forEach((box, idx) => {
      console.log(`【${box.key || box.label}】`);
      console.log(`  相对坐标: rx1=${box.rx1.toFixed(4)}, ry1=${box.ry1.toFixed(4)}, rx2=${box.rx2.toFixed(4)}, ry2=${box.ry2.toFixed(4)}`);

      // 应用到测试图片的绝对坐标
      const x1 = Math.round(box.rx1 * testWidth);
      const y1 = Math.round(box.ry1 * testHeight);
      const x2 = Math.round(box.rx2 * testWidth);
      const y2 = Math.round(box.ry2 * testHeight);
      const width = x2 - x1;
      const height = y2 - y1;

      console.log(`  在测试图(${testWidth}x${testHeight})上的绝对坐标: (${x1}, ${y1}) → (${x2}, ${y2})`);
      console.log(`  区域大小: ${width}px × ${height}px`);

      // 检查区域是否合理
      if (width < 50 || height < 50) {
        console.log(`  ⚠️ 警告：区域太小，可能无法识别`);
      }
      if (x1 < 0 || y1 < 0 || x2 > testWidth || y2 > testHeight) {
        console.log(`  ❌ 错误：区域超出图片范围！`);
      }
      console.log('');
    });

    // 检查配置中是否有其他豆豆相关配置
    console.log('3. 豆豆识别配置详情：');
    if (categories.stars.name) {
      console.log(`  名称: ${categories.stars.name}`);
    }
    if (categories.stars.icon) {
      console.log(`  图标: ${categories.stars.icon}`);
    }
    if (categories.stars.color) {
      console.log(`  颜色: ${categories.stars.color}`);
    }
    console.log(`  区域数量: ${starsBoxes.length}`);
    console.log('');

    // 检查Python OCR服务的豆豆识别逻辑
    console.log('4. 问题分析：');
    console.log('  根据你的测试结果：');
    console.log('    - 图片已成功解码和打开');
    console.log('    - 但豆豆-L2 返回 "no_match"');
    console.log('    - 耗时 0.86s，说明有执行识别流程');
    console.log('');
    console.log('  可能的原因：');
    console.log('    A. 配置的区域坐标不准确，未覆盖到豆豆位置');
    console.log('    B. 测试时前端传递的配置与数据库不一致');
    console.log('    C. Python OCR服务的豆豆识别算法有问题');
    console.log('    D. 测试图片中该位置确实没有豆豆（或豆豆显示异常）');
    console.log('');

    console.log('5. 验证步骤：');
    console.log('  ① 在浏览器中打开测试图片');
    console.log('  ② 用截图工具测量"我方豆豆2"的实际像素位置');
    console.log('  ③ 对比上面显示的"在测试图上的绝对坐标"');
    console.log('  ④ 如果坐标不匹配，需要调整配置');
    console.log('');
    console.log('  ⑤ 前端测试时，确认：');
    console.log('     - "所需引用方案的项目"选择的是"全局配置"');
    console.log('     - "OCR图片信息采集方案配置"下拉框有选择方案');
    console.log('     - 点击过"绑定生效"按钮');
    console.log('');

    console.log('6. 快速修复建议：');
    console.log('  如果你之前的配置是正常的，最直接的方法：');
    console.log('  ① 在旧环境（能正常识别的环境）导出方案');
    console.log('  ② 在新环境导入方案');
    console.log('  ③ 重新"绑定生效"到全局配置');
    console.log('  ④ 清除浏览器缓存，刷新页面重新测试');

  } catch (error) {
    console.error('分析失败:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

analyzStarsConfig();
