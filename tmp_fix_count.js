const mysql = require('mysql2/promise');
(async()=>{
  const pool = mysql.createPool({
    host:'localhost',
    user:'nslg-battle-server',
    password:'hu6956521',
    database:'nslg_battle',
    dateStrings:true
  });

  // 手动更新 pending_count
  await pool.query(`
    UPDATE ocr_watch_tasks
    SET pending_count = (SELECT COUNT(*) FROM ocr_pending_tasks WHERE helper_task_id = 12 AND status = 'pending')
    WHERE id = 12
  `);

  const [task] = await pool.query('SELECT pending_count FROM ocr_watch_tasks WHERE id = 12');
  console.log('手动更新后 pending_count:', task[0].pending_count);

  await pool.end();
})();
