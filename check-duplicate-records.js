/**
 * 检查战报记录是否重复
 */

const mysql = require('mysql2/promise');
const fs = require('fs');

// 读取后端配置获取数据库密码
let dbPassword = 'hu6956521';

(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: dbPassword,
    database: 'nslg_battle',
    waitForConnections: true,
    connectionLimit: 10
  });

  try {
    const projectId = 1778470540662;

    console.log('========== 数据库记录检查 ==========');
    const [rows] = await pool.query(
      'SELECT id, project_id, attacker_name, enemy_name, left_general_1, right_general_1, created_at FROM battle_records WHERE project_id = ? ORDER BY id',
      [projectId]
    );

    console.log(`\n数据库中 project_id = ${projectId} 的记录数: ${rows.length}`);
    console.log('\n详细记录：');
    console.table(rows.map(r => ({
      id: r.id,
      attacker: r.attacker_name || '(空)',
      enemy: r.enemy_name || '(空)',
      left_gen: r.left_general_1 || '(空)',
      right_gen: r.right_general_1 || '(空)',
      created_at: r.created_at
    })));

    // 检查是否有重复的 id
    const ids = rows.map(r => r.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      console.log('\n⚠️ 警告：数据库中存在重复的 ID！');
    } else {
      console.log('\n✅ 数据库中没有重复的 ID');
    }

    // 检查是否有相同战损的记录（可能是真实重复）
    const lossMap = {};
    rows.forEach(r => {
      const key = `${r.left_loss || 0}-${r.right_loss || 0}`;
      if (!lossMap[key]) lossMap[key] = [];
      lossMap[key].push(r.id);
    });

    const duplicates = Object.entries(lossMap).filter(([k, ids]) => ids.length > 1);
    if (duplicates.length > 0) {
      console.log('\n⚠️ 发现可能的重复战报（相同战损）：');
      duplicates.forEach(([loss, ids]) => {
        console.log(`  战损 ${loss}: IDs ${ids.join(', ')}`);
      });
    }

  } catch (e) {
    console.error('查询失败:', e.message);
  } finally {
    await pool.end();
  }
})();
