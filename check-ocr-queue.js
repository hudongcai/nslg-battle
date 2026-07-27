const mysql = require('mysql2/promise');

async function checkOcrQueue() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== OCR队列状态检查 ===\n');

    // 1. 检查待处理任务数量
    const [pending] = await pool.query(
      "SELECT COUNT(*) as count FROM ocr_pending_tasks WHERE status = 'pending'"
    );
    console.log(`待处理任务: ${pending[0].count} 条`);

    // 2. 检查处理中任务数量
    const [processing] = await pool.query(
      "SELECT COUNT(*) as count FROM ocr_pending_tasks WHERE status = 'processing'"
    );
    console.log(`处理中任务: ${processing[0].count} 条`);

    // 3. 检查已完成任务数量
    const [completed] = await pool.query(
      "SELECT COUNT(*) as count FROM ocr_pending_tasks WHERE status = 'completed'"
    );
    console.log(`已完成任务: ${completed[0].count} 条`);

    // 4. 检查失败任务数量
    const [failed] = await pool.query(
      "SELECT COUNT(*) as count FROM ocr_pending_tasks WHERE status = 'failed'"
    );
    console.log(`失败任务: ${failed[0].count} 条`);

    // 5. 显示最近的几条任务
    console.log('\n=== 最近5条任务 ===');
    const [recent] = await pool.query(
      `SELECT id, user_id, project_id, status, image_name, helper_task_id,
              created_at, updated_at
       FROM ocr_pending_tasks
       ORDER BY created_at DESC
       LIMIT 5`
    );

    recent.forEach(task => {
      console.log(`\nID: ${task.id}`);
      console.log(`  状态: ${task.status}`);
      console.log(`  图片: ${task.image_name}`);
      console.log(`  helper_task_id: ${task.helper_task_id || '无'}`);
      console.log(`  创建时间: ${task.created_at}`);
      console.log(`  更新时间: ${task.updated_at}`);
    });

    // 6. 检查battle_records表中的记录数
    console.log('\n=== battle_records 数据表 ===');
    const [records] = await pool.query(
      "SELECT COUNT(*) as count FROM battle_records"
    );
    console.log(`总记录数: ${records[0].count} 条`);

    // 7. 检查最近解析的记录
    const [recentRecords] = await pool.query(
      `SELECT id, project_id, battle_time, attacker_name, defender_name,
              created_at
       FROM battle_records
       ORDER BY created_at DESC
       LIMIT 3`
    );

    if (recentRecords.length > 0) {
      console.log('\n最近3条解析记录:');
      recentRecords.forEach(rec => {
        console.log(`\nID: ${rec.id}`);
        console.log(`  项目: ${rec.project_id}`);
        console.log(`  战斗时间: ${rec.battle_time}`);
        console.log(`  攻击方: ${rec.attacker_name}`);
        console.log(`  防守方: ${rec.defender_name}`);
        console.log(`  创建时间: ${rec.created_at}`);
      });
    } else {
      console.log('\n暂无解析记录');
    }

  } catch (error) {
    console.error('检查失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkOcrQueue();
