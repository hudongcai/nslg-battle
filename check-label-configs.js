const mysql = require('mysql2/promise');

async function checkLabelConfigs() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 检查 label_configs 配置方案 ===\n');

    // 查询所有配置方案
    const [rows] = await pool.query(`
      SELECT
        id,
        project_id,
        CHAR_LENGTH(categories_json) as json_length,
        LEFT(categories_json, 200) as json_preview,
        updated_at
      FROM label_configs
      ORDER BY project_id
    `);

    console.log(`找到 ${rows.length} 个配置方案:\n`);

    rows.forEach(row => {
      console.log(`ID: ${row.id}`);
      console.log(`  项目ID: ${row.project_id} ${row.project_id === 0 ? '(全局配置)' : ''}`);
      console.log(`  配置大小: ${row.json_length} 字符`);
      console.log(`  配置预览: ${row.json_preview}...`);
      console.log(`  更新时间: ${row.updated_at}`);
      console.log('');
    });

    // 检查 ocr_pending_tasks 表是否有 label_config 字段
    console.log('=== 检查 ocr_pending_tasks 表结构 ===\n');
    const [columns] = await pool.query("SHOW COLUMNS FROM ocr_pending_tasks");
    const hasLabelConfig = columns.some(col => col.Field === 'label_config');
    console.log(`label_config 字段存在: ${hasLabelConfig}`);

    if (hasLabelConfig) {
      // 查看最近的任务是否有 label_config
      const [tasks] = await pool.query(`
        SELECT
          id,
          project_id,
          status,
          CHAR_LENGTH(label_config) as config_length,
          created_at
        FROM ocr_pending_tasks
        ORDER BY id DESC
        LIMIT 5
      `);

      console.log('\n最近5条OCR任务:\n');
      tasks.forEach(task => {
        console.log(`任务ID: ${task.id}, 项目: ${task.project_id}, 状态: ${task.status}, label_config长度: ${task.config_length || 0}, 时间: ${task.created_at}`);
      });
    }

  } catch (error) {
    console.error('检查失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkLabelConfigs();
