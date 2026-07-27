const mysql = require('mysql2/promise');

async function testStatusUpdate() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 测试任务状态更新 ===\n');

    // 查看任务3474的当前状态
    console.log('1. 任务3474当前状态:');
    const [before] = await pool.query(
      'SELECT id, status, battle_record_id, updated_at FROM ocr_pending_tasks WHERE id = 3474'
    );
    console.log(`   状态: ${before[0].status}`);
    console.log(`   战报ID: ${before[0].battle_record_id || 'NULL'}`);
    console.log(`   更新时间: ${before[0].updated_at}`);

    // 尝试手动更新状态
    console.log('\n2. 尝试手动更新状态为done...');
    const [result] = await pool.query(
      `UPDATE ocr_pending_tasks
       SET status = 'done',
           battle_record_id = 4740,
           image_base64 = NULL,
           updated_at = NOW()
       WHERE id = 3474`,
      []
    );

    console.log(`   受影响的行数: ${result.affectedRows}`);
    console.log(`   修改的行数: ${result.changedRows}`);

    // 验证更新结果
    console.log('\n3. 验证更新后的状态:');
    const [after] = await pool.query(
      'SELECT id, status, battle_record_id, updated_at FROM ocr_pending_tasks WHERE id = 3474'
    );
    console.log(`   状态: ${after[0].status}`);
    console.log(`   战报ID: ${after[0].battle_record_id || 'NULL'}`);
    console.log(`   更新时间: ${after[0].updated_at}`);

    if (after[0].status === 'done') {
      console.log('\n✅ 更新成功！');
    } else {
      console.log('\n❌ 更新失败！');
    }

  } catch (error) {
    console.error('测试失败:', error.message);
    console.error('SQL错误:', error.sqlMessage);
  } finally {
    await pool.end();
  }
}

testStatusUpdate();
