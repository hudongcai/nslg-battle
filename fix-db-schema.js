const mysql = require('mysql2/promise');

async function fixSchema() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('检查 ocr_pending_tasks 表结构...');
    const [columns] = await pool.query(`SHOW COLUMNS FROM ocr_pending_tasks`);
    const hasLabelConfig = columns.some(col => col.Field === 'label_config');

    if (!hasLabelConfig) {
      console.log('添加 label_config 字段...');
      await pool.query(`
        ALTER TABLE ocr_pending_tasks
        ADD COLUMN label_config TEXT NULL
        AFTER helper_task_id
      `);
      console.log('✅ label_config 字段已添加');
    } else {
      console.log('✅ label_config 字段已存在');
    }

    // 显示表结构
    const [finalColumns] = await pool.query(`SHOW COLUMNS FROM ocr_pending_tasks`);
    console.log('\n表结构:');
    finalColumns.forEach(col => {
      console.log(`  ${col.Field} - ${col.Type} ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixSchema();
