-- 测试本地 D1 数据库读写

-- 插入测试项目
INSERT INTO projects (id, name, description, creator_phone, visibility, members, created_at, updated_at)
VALUES (
  'test-001',
  '本地测试项目',
  '验证D1读写功能',
  '13651810449',
  'private',
  '[]',
  1714766400,
  1714766400
);

-- 查询所有项目
SELECT * FROM projects;
