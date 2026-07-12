const mysql = require('mysql2/promise');
(async()=>{
  const pool = mysql.createPool({
    host:'localhost',
    user:'nslg-battle-server',
    password:'hu6956521',
    database:'nslg_battle',
    dateStrings:true
  });

  const files = [
    'shot_20260612_232446.png',
    'shot_20260612_232455.png',
    'shot_20260612_232506.png',
    'test_new_1.png',
    'test_new_2.png',
    'test_new_3.png',
    'test_new_4.png',
    'test_new_5.png'
  ];

  console.log('文件在数据库中的状态:');
  for (const file of files) {
    const [rows] = await pool.query(
      'SELECT id, status FROM ocr_pending_tasks WHERE project_id = 1778470540662 AND image_name = ? ORDER BY id DESC LIMIT 1',
      [file]
    );

    if (rows.length > 0) {
      console.log(`  ${file}: ${rows[0].status} (id: ${rows[0].id})`);
    } else {
      console.log(`  ${file}: 未上传`);
    }
  }

  await pool.end();
})();
