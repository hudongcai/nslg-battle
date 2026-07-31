/**
 * 使用正确的helper_task_id提交OCR任务，触发WebSocket推送
 */

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'nslg-battle-server',
  password: 'hu6956521',
  database: 'nslg_battle',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function triggerWithHelper() {
  console.log('=== WebSocket 推送测试（带 helper_task_id）===\n');

  try {
    // 1. 获取第一个helper_task
    console.log('1. 查询可用的 helper_task...');
    const [helpers] = await pool.query(`
      SELECT id, user_id, project_id
      FROM helper_configs
      LIMIT 1
    `);

    if (!helpers.length) {
      console.log('   ❌ 没有找到可用的 helper_task');
      return;
    }

    const helper = helpers[0];
    console.log(`   ✅ 找到 helper_task: ID=${helper.id}, user_id=${helper.user_id}, project_id=${helper.project_id}`);

    // 2. 插入OCR任务（带helper_task_id）
    console.log('\n2. 插入OCR任务...');
    const testImageName = 'websocket-test-' + Date.now() + '.png';
    const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const [insertResult] = await pool.query(`
      INSERT INTO ocr_pending_tasks
      (user_id, project_id, image_name, image_base64, helper_task_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', NOW(), NOW())
    `, [helper.user_id, helper.project_id, testImageName, testImageBase64, helper.id]);

    const taskId = insertResult.insertId;
    console.log(`   ✅ 任务已插入，ID: ${taskId}`);
    console.log(`   图片名称: ${testImageName}`);
    console.log(`   helper_task_id: ${helper.id}`);
    console.log(`   project_id: ${helper.project_id}`);

    // 3. 提示
    console.log('\n3. 观察 WebSocket 监控页面...');
    console.log('   📡 http://localhost:3000/websocket-monitor.html');
    console.log('   👀 应该会收到 task-update 事件');
    console.log(`   💡 监控页面需要加入项目房间: project-${helper.project_id}`);

    // 4. 跟踪任务状态
    console.log('\n4. 跟踪任务处理...');
    let previousStatus = 'pending';
    let checkCount = 0;
    const maxChecks = 20;

    while (checkCount < maxChecks) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      checkCount++;

      const [taskRows] = await pool.query(
        'SELECT status, error_message FROM ocr_pending_tasks WHERE id = ?',
        [taskId]
      );

      if (taskRows.length > 0) {
        const task = taskRows[0];

        if (task.status !== previousStatus) {
          console.log(`   [${checkCount}s] 状态变化: ${previousStatus} → ${task.status}`);
          previousStatus = task.status;

          if (task.status === 'done') {
            console.log('   ✅ 任务处理完成！');
            break;
          } else if (task.status === 'failed') {
            console.log(`   ❌ 任务失败: ${task.error_message}`);
            break;
          }
        } else {
          process.stdout.write(`   [${checkCount}s] ${task.status}...\r`);
        }
      }
    }

    console.log('\n\n=== 测试完成 ===');
    console.log('💡 检查 WebSocket 监控页面是否收到了实时更新');

  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

triggerWithHelper();
