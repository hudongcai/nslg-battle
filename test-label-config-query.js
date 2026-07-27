const mysql = require('mysql2/promise');

async function testQuery() {
  // 创建新的连接池测试
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('测试查询 ocr_pending_tasks...\n');

    // 尝试执行与后端相同的查询
    const [tasks] = await pool.query(
      `SELECT id, user_id, project_id, image_base64, image_name,
              helper_task_id, label_config
       FROM ocr_pending_tasks
       WHERE status = 'pending'
       ORDER BY
         CASE WHEN helper_task_id IS NOT NULL THEN 0 ELSE 1 END,
         created_at ASC
       LIMIT 1`
    );

    if (tasks.length > 0) {
      console.log('✅ 查询成功！');
      console.log('第一条任务:');
      console.log(`  ID: ${tasks[0].id}`);
      console.log(`  图片: ${tasks[0].image_name}`);
      console.log(`  helper_task_id: ${tasks[0].helper_task_id}`);
      console.log(`  label_config: ${tasks[0].label_config || 'NULL'}`);
    } else {
      console.log('没有待处理任务');
    }

  } catch (error) {
    console.error('❌ 查询失败:', error.message);
    console.error('错误代码:', error.code);
  } finally {
    await pool.end();
  }
}

testQuery();
