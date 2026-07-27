const mysql = require('mysql2/promise');

async function fullDiagnosis() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('========================================');
    console.log('    OCR队列完整诊断报告');
    console.log('========================================\n');

    // 1. OCR任务队列状态
    console.log('【1】OCR任务队列状态:');
    const [stats] = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM ocr_pending_tasks
      GROUP BY status
    `);

    let pending = 0, processing = 0, done = 0, failed = 0;
    stats.forEach(row => {
      console.log(`   ${row.status}: ${row.count} 条`);
      if (row.status === 'pending') pending = row.count;
      else if (row.status === 'processing') processing = row.count;
      else if (row.status === 'done') done = row.count;
      else if (row.status === 'failed') failed = row.count;
    });

    // 2. 战报记录统计
    console.log('\n【2】战报记录总数:');
    const [battleCount] = await pool.query('SELECT COUNT(*) as total FROM battle_records');
    console.log(`   ${battleCount[0].total} 条`);

    // 3. 最近5分钟新增的战报
    console.log('\n【3】最近5分钟新增的战报:');
    const [recentBattles] = await pool.query(`
      SELECT id, attacker_name, enemy_name, created_at
      FROM battle_records
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
      ORDER BY id DESC
    `);

    if (recentBattles.length > 0) {
      recentBattles.forEach(b => {
        console.log(`   ID=${b.id}, ${b.attacker_name} vs ${b.enemy_name}, ${b.created_at}`);
      });
    } else {
      console.log('   无');
    }

    // 4. 正在处理的任务
    console.log('\n【4】正在处理的任务:');
    const [processingTasks] = await pool.query(`
      SELECT id, image_name, updated_at,
             TIMESTAMPDIFF(SECOND, updated_at, NOW()) as elapsed_seconds
      FROM ocr_pending_tasks
      WHERE status = 'processing'
      ORDER BY updated_at ASC
    `);

    if (processingTasks.length > 0) {
      processingTasks.forEach(t => {
        console.log(`   任务${t.id}: ${t.image_name}, 已处理${t.elapsed_seconds}秒`);
      });
    } else {
      console.log('   无');
    }

    // 5. 失败的任务
    console.log('\n【5】失败的任务:');
    const [failedTasks] = await pool.query(`
      SELECT id, image_name, error_message, updated_at
      FROM ocr_pending_tasks
      WHERE status = 'failed'
      ORDER BY updated_at DESC
      LIMIT 5
    `);

    if (failedTasks.length > 0) {
      failedTasks.forEach(t => {
        console.log(`   任务${t.id}: ${t.image_name}`);
        console.log(`      错误: ${t.error_message}`);
        console.log(`      时间: ${t.updated_at}`);
      });
    } else {
      console.log('   无');
    }

    // 6. 待处理任务的时间分布
    console.log('\n【6】待处理任务的创建时间:');
    const [pendingTime] = await pool.query(`
      SELECT
        MIN(created_at) as earliest,
        MAX(created_at) as latest,
        COUNT(*) as total
      FROM ocr_pending_tasks
      WHERE status = 'pending'
    `);

    if (pendingTime[0].total > 0) {
      console.log(`   最早: ${pendingTime[0].earliest}`);
      console.log(`   最晚: ${pendingTime[0].latest}`);
      console.log(`   总数: ${pendingTime[0].total}`);
    }

    // 7. 总结
    console.log('\n========================================');
    console.log('【总结】');
    console.log(`   待处理: ${pending} 条`);
    console.log(`   处理中: ${processing} 条`);
    console.log(`   已完成: ${done} 条`);
    console.log(`   失败: ${failed} 条`);
    console.log(`   战报总数: ${battleCount[0].total} 条`);

    if (processing > 0) {
      console.log('\n   ✅ OCR队列处理器正在运行');
    } else if (pending > 0) {
      console.log('\n   ⚠️  有待处理任务但没有正在处理的任务');
      console.log('      建议：检查后端日志和OCR服务状态');
    } else {
      console.log('\n   ✅ 所有任务已处理完成');
    }

    console.log('========================================\n');

  } catch (error) {
    console.error('诊断失败:', error.message);
  } finally {
    await pool.end();
  }
}

fullDiagnosis();
