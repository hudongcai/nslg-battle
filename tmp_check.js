const mysql = require('mysql2/promise');
(async()=>{
  const pool = mysql.createPool({
    host:'localhost',
    user:'nslg-battle-server',
    password:'hu6956521',
    database:'nslg_battle',
    dateStrings:true
  });

  const [task] = await pool.query('SELECT id, project_id, folder_path, status, pending_count, processed_count FROM ocr_watch_tasks WHERE id = 12');
  const [pending] = await pool.query('SELECT COUNT(*) as count FROM ocr_pending_tasks WHERE project_id = 1778470540662 AND status = "pending"');

  console.log('task 12状态:');
  console.log(JSON.stringify(task[0], null, 2));
  console.log('ocr_pending_tasks待处理:', pending[0].count);

  await pool.end();
})();
