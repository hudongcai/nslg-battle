const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    dateStrings: true
  });

  console.log('=== 检查所有用户的待处理任务 ===');
  const [all] = await pool.query(
    'SELECT user_id, project_id, COUNT(*) as count, GROUP_CONCAT(DISTINCT status) as statuses FROM ocr_pending_tasks GROUP BY user_id, project_id'
  );
  console.table(all);

  console.log('\n=== 检查是否有其他项目的任务 ===');
  const [tasks] = await pool.query(
    'SELECT id, user_id, project_id, status, image_name, created_at FROM ocr_pending_tasks ORDER BY created_at DESC LIMIT 20'
  );
  console.table(tasks);

  await pool.end();
})();
