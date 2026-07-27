const mysql = require('mysql2/promise');

async function createTable() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4',
  });

  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS ocr_schemes (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL COMMENT '方案名称',
        user_phone VARCHAR(20) COMMENT '用户手机号',
        image_width INT COMMENT '参考图片宽度',
        image_height INT COMMENT '参考图片高度',
        boxes JSON COMMENT '框坐标数组',
        test_alliance_slots JSON COMMENT '测试联盟槽位数据',
        test_player_names JSON COMMENT '测试玩家名称',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_name_user (name, user_phone),
        INDEX idx_user (user_phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OCR配置方案表'
    `;

    await pool.query(sql);
    console.log('✅ ocr_schemes 表创建成功');

    // 验证表结构
    const [rows] = await pool.query('SHOW TABLES LIKE "ocr_schemes"');
    console.log('✅ 表已存在:', rows.length > 0);

    await pool.end();
  } catch (err) {
    console.error('❌ 创建失败:', err.message);
    process.exit(1);
  }
}

createTable();
