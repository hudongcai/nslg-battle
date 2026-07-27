const mysql = require('mysql2/promise');

async function checkLabelConfig() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 检查 ocr_pending_tasks 表结构 ===\n');

    // 查看表结构
    const [columns] = await pool.query("SHOW COLUMNS FROM ocr_pending_tasks");

    console.log('当前字段列表:');
    columns.forEach(col => {
      console.log(`  ${col.Field} - ${col.Type} - Null:${col.Null} - Key:${col.Key}`);
    });

    // 检查是否有 label_config
    const hasLabelConfig = columns.some(col => col.Field === 'label_config');

    console.log(`\nlabel_config 字段存在: ${hasLabelConfig}`);

    if (!hasLabelConfig) {
      console.log('\n添加 label_config 字段...');
      await pool.query(`
        ALTER TABLE ocr_pending_tasks
        ADD COLUMN label_config TEXT NULL
        AFTER helper_task_id
      `);
      console.log('✅ label_config 字段已添加');
    }

  } catch (error) {
    console.error('检查失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkLabelConfig();
