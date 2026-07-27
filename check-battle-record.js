const mysql = require('mysql2/promise');

async function checkBattleRecord() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 检查战报记录 ===\n');

    // 检查战报4740是否存在
    const [battle] = await pool.query(
      'SELECT id, attacker_name, enemy_name, result, created_at FROM battle_records WHERE id = 4740'
    );

    if (battle.length > 0) {
      console.log('✅ 战报4740存在:');
      console.log(`   攻击方: ${battle[0].attacker_name}`);
      console.log(`   防守方: ${battle[0].enemy_name}`);
      console.log(`   结果: ${battle[0].result}`);
      console.log(`   创建时间: ${battle[0].created_at}`);
    } else {
      console.log('❌ 战报4740不存在');
    }

    // 检查任务3474
    console.log('\n=== 检查任务3474 ===\n');
    const [task] = await pool.query(
      'SELECT id, status, battle_record_id, image_name, updated_at FROM ocr_pending_tasks WHERE id = 3474'
    );

    if (task.length > 0) {
      console.log(`状态: ${task[0].status}`);
      console.log(`关联战报ID: ${task[0].battle_record_id || 'NULL'}`);
      console.log(`图片: ${task[0].image_name}`);
      console.log(`更新时间: ${task[0].updated_at}`);
    }

    // 查看最新的battle_records
    console.log('\n=== 最新的5条战报 ===\n');
    const [recent] = await pool.query(
      'SELECT id, attacker_name, enemy_name, created_at FROM battle_records ORDER BY id DESC LIMIT 5'
    );

    recent.forEach(r => {
      console.log(`  ID=${r.id}, ${r.attacker_name} vs ${r.enemy_name}, ${r.created_at}`);
    });

  } catch (error) {
    console.error('检查失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkBattleRecord();
