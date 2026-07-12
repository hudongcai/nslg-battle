const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    dateStrings: true
  });

  console.log('=== OCR 待处理任务 ===');
  const [tasks] = await pool.query('SELECT id, user_id, project_id, status, image_name, created_at FROM ocr_pending_tasks ORDER BY created_at DESC LIMIT 10');
  console.table(tasks);

  console.log('\n=== 用户信息 ===');
  const [users] = await pool.query('SELECT id, phone, nickname FROM users WHERE phone = "13651810449"');
  console.table(users);

  await pool.end();
})();
