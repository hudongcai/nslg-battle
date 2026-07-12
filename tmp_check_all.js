const mysql = require('mysql2/promise');
(async()=>{
  const pool = mysql.createPool({
    host:'localhost',
    user:'nslg-battle-server',
    password:'hu6956521',
    database:'nslg_battle',
    dateStrings:true
  });

  const [rows] = await pool.query(
    'SELECT id, image_name, status, helper_task_id, created_at FROM ocr_pending_tasks WHERE helper_task_id = 12 ORDER BY id DESC LIMIT 20'
  );

  console.log('task 12的所有记录:');
  rows.forEach(r => {
    console.log(`  ${r.id} - ${r.image_name} - ${r.status} - ${r.created_at}`);
  });

  await pool.end();
})();
