-- OCR配置方案表：跨环境永久存储
CREATE TABLE IF NOT EXISTS ocr_schemes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL COMMENT '方案名称',
  user_phone VARCHAR(20) COMMENT '用户手机号',
  image_width INT COMMENT '参考图片宽度',
  image_height INT COMMENT '参考图片高度',
  boxes JSON COMMENT '框坐标数组 [{rx1,ry1,rx2,ry2},...]',
  test_alliance_slots JSON COMMENT '测试联盟槽位数据',
  test_player_names JSON COMMENT '测试玩家名称',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_name_user (name, user_phone),
  INDEX idx_user (user_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OCR配置方案表';
