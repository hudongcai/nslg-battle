const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    dateStrings: true
  });

  // 查询项目ID
  const [taskInfo] = await conn.query('SELECT project_id FROM ocr_watch_tasks WHERE id=12');
  const projectId = taskInfo[0]?.project_id;
  console.log('任务12的项目ID:', projectId);

  // 查询已成功解析的文件
  const [parsed] = await conn.query(`
    SELECT DISTINCT bg.original_name
    FROM battle_gallery bg
    INNER JOIN battle_records br ON bg.battle_id = br.id
    WHERE bg.project_id = ?
      AND bg.original_name != ''
      AND bg.status = 1
      AND br.left_general_1 IS NOT NULL
      AND br.left_general_1 != ''
  `, [projectId]);

  console.log('\n已成功解析的文件:', parsed.length, '个');
  parsed.forEach(r => console.log(' -', r.original_name));

  // 查询待处理任务
  const [pending] = await conn.query('SELECT image_name FROM ocr_pending_tasks WHERE helper_task_id=12 AND status="pending"');
  const pendingSet = new Set(pending.map(p => p.image_name));
  const parsedSet = new Set(parsed.map(p => p.original_name));

  console.log('\n待处理任务中已解析过的文件:');
  let duplicateCount = 0;
  pendingSet.forEach(name => {
    if (parsedSet.has(name)) {
      console.log(' -', name);
      duplicateCount++;
    }
  });
  console.log('重复数量:', duplicateCount);

  console.log('\n真正需要处理的新文件:');
  pendingSet.forEach(name => {
    if (!parsedSet.has(name)) {
      console.log(' -', name);
    }
  });

  await conn.end();
})();
