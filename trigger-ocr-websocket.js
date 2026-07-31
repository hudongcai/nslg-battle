/**
 * 触发OCR任务并观察WebSocket推送
 * 用于测试WebSocket监控页面的实时更新功能
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

async function triggerOcrTask() {
  console.log('=== 触发OCR WebSocket推送测试 ===\n');

  try {
    // 1. 检查队列处理器状态
    console.log('1. 检查队列处理器状态...');
    const [queueStatus] = await pool.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM ocr_pending_tasks
      GROUP BY status
    `);
    console.log('   当前队列状态:');
    queueStatus.forEach(row => {
      console.log(`   - ${row.status}: ${row.count} 条`);
    });

    // 2. 插入测试任务
    console.log('\n2. 插入测试OCR任务...');
    const testImageName = 'websocket-test-' + Date.now() + '.png';
    const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; // 1x1透明图

    const [insertResult] = await pool.query(`
      INSERT INTO ocr_pending_tasks
      (user_id, project_id, image_name, image_base64, status, created_at, updated_at)
      VALUES (1, 1, ?, ?, 'pending', NOW(), NOW())
    `, [testImageName, testImageBase64]);

    const taskId = insertResult.insertId;
    console.log(`   ✅ 任务已插入，ID: ${taskId}`);
    console.log(`   图片名称: ${testImageName}`);

    // 3. 提示用户观察
    console.log('\n3. 观察WebSocket监控页面...');
    console.log('   📡 打开 http://localhost:3000/websocket-monitor.html');
    console.log('   👀 监控页面应该会显示:');
    console.log('      - 待处理数量增加');
    console.log('      - 当前处理文件名');
    console.log('      - 处理完成后数量变化');
    console.log('      - 实时WebSocket消息');

    // 4. 等待任务状态变化
    console.log('\n4. 跟踪任务状态变化...');
    let previousStatus = 'pending';
    let checkCount = 0;
    const maxChecks = 20; // 最多检查20次（20秒）

    while (checkCount < maxChecks) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      checkCount++;

      const [taskRows] = await pool.query(
        'SELECT status, error_message, updated_at FROM ocr_pending_tasks WHERE id = ?',
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
          process.stdout.write(`   [${checkCount}s] 等待中 (${task.status})...\r`);
        }
      }
    }

    // 5. 显示最终结果
    console.log('\n\n5. 最终任务状态:');
    const [finalTask] = await pool.query(
      'SELECT * FROM ocr_pending_tasks WHERE id = ?',
      [taskId]
    );
    if (finalTask.length > 0) {
      const task = finalTask[0];
      console.log(`   任务ID: ${task.id}`);
      console.log(`   状态: ${task.status}`);
      console.log(`   图片名称: ${task.image_name}`);
      console.log(`   创建时间: ${task.created_at}`);
      console.log(`   更新时间: ${task.updated_at}`);
      if (task.error_message) {
        console.log(`   错误信息: ${task.error_message}`);
      }
    }

    console.log('\n=== 测试完成 ===');
    console.log('💡 检查WebSocket监控页面是否收到了实时更新消息');

  } catch (error) {
    console.error('❌ 测试过程出错:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

triggerOcrTask();
