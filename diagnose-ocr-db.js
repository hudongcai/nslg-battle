const mysql = require('mysql2/promise');
const fs = require('fs');

async function diagnose() {
  console.log('=== OCR队列诊断 ===\n');

  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    // 1. 检查表结构
    console.log('1. 检查 ocr_pending_tasks 表结构:');
    const [columns] = await pool.query("SHOW COLUMNS FROM ocr_pending_tasks");
    const hasLabelConfig = columns.some(col => col.Field === 'label_config');
    console.log(`   label_config 字段: ${hasLabelConfig ? '✅ 存在' : '❌ 不存在'}`);

    if (!hasLabelConfig) {
      console.log('\n   字段不存在，现在添加...');
      await pool.query(`ALTER TABLE ocr_pending_tasks ADD COLUMN label_config TEXT NULL AFTER helper_task_id`);
      console.log('   ✅ 字段已添加');
    }

    // 2. 关闭并重新创建连接池
    await pool.end();

    const pool2 = mysql.createPool({
      host: 'localhost',
      port: 3306,
      user: 'nslg-battle-server',
      password: 'hu6956521',
      database: 'nslg_battle',
      charset: 'utf8mb4'
    });

    // 3. 用新连接测试查询
    console.log('\n2. 测试查询（新连接）:');
    const [tasks] = await pool2.query(
      `SELECT id, user_id, project_id, image_name, helper_task_id, label_config
       FROM ocr_pending_tasks
       WHERE status = 'pending'
       LIMIT 1`
    );

    if (tasks.length > 0) {
      console.log(`   ✅ 查询成功! 任务ID=${tasks[0].id}, 图片=${tasks[0].image_name}`);
    } else {
      console.log('   无待处理任务');
    }

    await pool2.end();

    console.log('\n3. 建议:');
    console.log('   - 数据库字段已确认存在');
    console.log('   - 请重启后端服务以刷新连接池');

  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    console.error('   错误代码:', error.code);
  }
}

diagnose();
