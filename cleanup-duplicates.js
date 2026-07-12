const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    dateStrings: true
  });

  // 删除重复的已完成记录
  const [result] = await conn.query('DELETE FROM ocr_pending_tasks WHERE helper_task_id=12 AND status="done"');
  console.log('删除了', result.affectedRows, '条已完成的重复记录');

  // 查看剩余的待处理任务
  const [rows] = await conn.query('SELECT id, image_name, status FROM ocr_pending_tasks WHERE helper_task_id=12 AND status="pending" ORDER BY id');
  console.log('\n剩余待处理任务:', rows.length, '条');
  console.log(JSON.stringify(rows, null, 2));

  await conn.end();
})();
