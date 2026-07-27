const mysql = require('mysql2/promise');

async function diagnoseIssue() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 诊断OCR配置方案问题 ===\n');

    // 1. 检查数据库中的配置方案
    console.log('1. 数据库中的配置方案：');
    const [configs] = await pool.query(`
      SELECT
        id,
        project_id,
        CHAR_LENGTH(categories_json) as json_length,
        updated_at
      FROM label_configs
      ORDER BY project_id
    `);

    configs.forEach(cfg => {
      console.log(`  - ID:${cfg.id}, 项目:${cfg.project_id === 0 ? '全局' : cfg.project_id}, 大小:${cfg.json_length}字符, 更新:${cfg.updated_at}`);
    });

    // 2. 检查最近的OCR任务使用的配置
    console.log('\n2. 最近OCR任务使用的配置：');
    const [tasks] = await pool.query(`
      SELECT
        id,
        project_id,
        status,
        CHAR_LENGTH(label_config) as config_length,
        LEFT(label_config, 100) as config_preview,
        created_at
      FROM ocr_pending_tasks
      ORDER BY id DESC
      LIMIT 10
    `);

    if (tasks.length === 0) {
      console.log('  ⚠️ 没有找到任何OCR任务');
    } else {
      tasks.forEach(task => {
        console.log(`  任务${task.id}: 项目${task.project_id || '未指定'}, 状态:${task.status}, 配置长度:${task.config_length || 0}, 时间:${task.created_at}`);
        if (task.config_length > 0) {
          console.log(`    配置预览: ${task.config_preview}...`);
        } else {
          console.log(`    ⚠️ 没有label_config数据`);
        }
      });
    }

    // 3. 问题分析
    console.log('\n3. 问题分析：');
    console.log('');

    const hasGlobalConfig = configs.some(c => c.project_id === 0);
    console.log(`  - 全局配置(project_id=0)是否存在: ${hasGlobalConfig ? '✅ 是' : '❌ 否'}`);

    if (hasGlobalConfig) {
      const globalConfig = configs.find(c => c.project_id === 0);
      console.log(`    全局配置大小: ${globalConfig.json_length} 字符`);
      console.log(`    全局配置更新时间: ${globalConfig.updated_at}`);
    }

    const hasTasksWithConfig = tasks.some(t => t.config_length > 0);
    console.log(`  - 最近任务是否携带label_config: ${hasTasksWithConfig ? '✅ 是' : '❌ 否'}`);

    console.log('\n4. 核心问题：');
    console.log('  配置方案存储在 localStorage (浏览器本地)');
    console.log('  换了登录环境/浏览器后，localStorage 数据不会同步');
    console.log('');
    console.log('  当前架构：');
    console.log('    - 配置方案列表：存在 localStorage (前端)');
    console.log('    - 实际生效配置：存在 label_configs 表 (数据库)');
    console.log('    - OCR识别时：使用 label_configs 表的数据');
    console.log('');
    console.log('  解决方案：');
    console.log('    方案A: 在新环境中重新创建/导入方案到 localStorage');
    console.log('    方案B: 将方案列表也迁移到数据库 (需要改造代码)');

    // 5. 检查ocr-system.js中的实际使用逻辑
    console.log('\n5. 需要检查的代码位置：');
    console.log('  - ocr-region-editor.js: 方案管理 (localStorage)');
    console.log('  - nslg-backend.js: /api/label-config 接口 (数据库读写)');
    console.log('  - ocr-system.js 或 local-helper.js: OCR任务创建时的配置获取');

  } catch (error) {
    console.error('诊断失败:', error.message);
  } finally {
    await pool.end();
  }
}

diagnoseIssue();
