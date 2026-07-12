const mysql = require('mysql2/promise');
(async()=>{
  const pool = mysql.createPool({
    host:'localhost',
    user:'nslg-battle-server',
    password:'hu6956521',
    database:'nslg_battle',
    dateStrings:true
  });

  const [rows] = await pool.query('SELECT id, image_name, status, helper_task_id FROM ocr_pending_tasks WHERE project_id = 1778470540662 ORDER BY id DESC LIMIT 20');

  console.log('ocr_pending_tasks 记录（项目 1778470540662）:');
  rows.forEach(r => {
    console.log(`  ${r.id} - ${r.image_name} - ${r.status} - helper_task_id: ${r.helper_task_id}`);
  });

  await pool.end();
})();
