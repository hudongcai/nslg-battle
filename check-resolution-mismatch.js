const mysql = require('mysql2/promise');

async function checkResolutionMismatch() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 检查配置分辨率不匹配问题 ===\n');

    // 获取全局配置的分辨率和区域坐标
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
    const actualWidth = 2513;  // 从你的截图看到的
    const actualHeight = 1154;

    console.log('1. 分辨率对比：');
    console.log(`  配置的分辨率: ${configWidth} x ${configHeight}`);
    console.log(`  实际图片分辨率: ${actualWidth} x ${actualHeight}`);
    console.log(`  宽度比例: ${(actualWidth / configWidth).toFixed(3)}`);
    console.log(`  高度比例: ${(actualHeight / configHeight).toFixed(3)}`);

    const widthDiff = Math.abs(actualWidth - configWidth);
    const heightDiff = Math.abs(actualHeight - configHeight);
    const widthDiffPercent = (widthDiff / configWidth * 100).toFixed(1);
    const heightDiffPercent = (heightDiff / configHeight * 100).toFixed(1);

    console.log(`  宽度差异: ${widthDiff}px (${widthDiffPercent}%)`);
    console.log(`  高度差异: ${heightDiff}px (${heightDiffPercent}%)`);

    if (widthDiff > 100 || heightDiff > 100) {
      console.log('\n  ⚠️ 分辨率差异较大，可能导致识别区域偏移！');
    }

    // 检查配置中的坐标
    console.log('\n2. 配置的识别区域示例：');
    try {
      const categories = JSON.parse(cfg.categories_json);

      // 显示豆豆配置
      if (categories.stars && categories.stars.boxes) {
        console.log('\n  豆豆(stars)区域：');
        categories.stars.boxes.forEach(box => {
          console.log(`    ${box.key || box.label}: rx1=${box.rx1.toFixed(3)}, ry1=${box.ry1.toFixed(3)}, rx2=${box.rx2.toFixed(3)}, ry2=${box.ry2.toFixed(3)}`);
          // 转换为绝对坐标
          const absX1 = Math.round(box.rx1 * configWidth);
          const absY1 = Math.round(box.ry1 * configHeight);
          const absX2 = Math.round(box.rx2 * configWidth);
          const absY2 = Math.round(box.ry2 * configHeight);
          console.log(`      配置图绝对坐标: (${absX1},${absY1}) - (${absX2},${absY2})`);

          // 如果应用到实际图片
          const actualX1 = Math.round(box.rx1 * actualWidth);
          const actualY1 = Math.round(box.ry1 * actualHeight);
          const actualX2 = Math.round(box.rx2 * actualWidth);
          const actualY2 = Math.round(box.ry2 * actualHeight);
          console.log(`      实际图绝对坐标: (${actualX1},${actualY1}) - (${actualX2},${actualY2})`);
        });
      }

      // 显示玩家名配置
      if (categories.playerNames && categories.playerNames.boxes) {
        console.log('\n  玩家名(playerNames)区域：');
        categories.playerNames.boxes.forEach(box => {
          console.log(`    ${box.key}: rx1=${box.rx1.toFixed(3)}, ry1=${box.ry1.toFixed(3)}, rx2=${box.rx2.toFixed(3)}, ry2=${box.ry2.toFixed(3)}`);
        });
      }

    } catch (e) {
      console.log(`  ⚠️ 配置解析失败: ${e.message}`);
    }

    console.log('\n3. 问题分析：');
    console.log('  根据你的测试截图：');
    console.log('    - 测试的是 [豆豆-L2] 单个字段');
    console.log('    - 结果显示 "no_match" 和 "所有字段均为空"');
    console.log('');
    console.log('  可能的原因：');
    console.log('    A. 配置的分辨率与实际图片不匹配');
    console.log('    B. 配置的区域坐标不准确，未覆盖到豆豆位置');
    console.log('    C. 测试时选择的方案与数据库中的配置不同步');
    console.log('');
    console.log('4. 解决方案：');
    console.log('  ① 在新环境中点击「🔄 从数据库还原」，将数据库配置还原为方案');
    console.log('  ② 上传一张 2513x1154 的实际战报图');
    console.log('  ③ 调整各区域的识别框位置，确保覆盖到对应字段');
    console.log('  ④ 点击「💾 保存配置」保存到方案');
    console.log('  ⑤ 点击「绑定生效」将方案写入数据库');
    console.log('  ⑥ 或者：使用原来的环境导出方案，在新环境导入');

  } catch (error) {
    console.error('检查失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkResolutionMismatch();
