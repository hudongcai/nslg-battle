const mysql = require('mysql2/promise');

async function analyzeDataStructure() {
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
    console.log('    数据关系分析');
    console.log('========================================\n');

    // 监听任务ID=4的统计
    const helperTaskId = 4;

    // 1. OCR任务队列统计（这是"自动战报解析"的数据源）
    console.log('【1】OCR任务队列 (ocr_pending_tasks) - 监听任务4:');
    const [ocrStats] = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
        COUNT(CASE WHEN status = 'done' THEN 1 END) as done,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
      FROM ocr_pending_tasks
      WHERE helper_task_id = ?
    `, [helperTaskId]);

    const ocr = ocrStats[0];
    console.log(`   总任务数: ${ocr.total}`);
    console.log(`   待处理: ${ocr.pending}`);
    console.log(`   处理中: ${ocr.processing}`);
    console.log(`   已处理(done): ${ocr.done}`);
    console.log(`   失败: ${ocr.failed}`);
    console.log(`   计算: ${ocr.pending} + ${ocr.processing} + ${ocr.done} + ${ocr.failed} = ${ocr.pending + ocr.processing + ocr.done + ocr.failed}`);

    // 2. 已完成任务关联的战报（这些战报是从OCR识别出来的）
    console.log('\n【2】OCR任务关联的战报:');
    const [ocrBattles] = await pool.query(`
      SELECT COUNT(DISTINCT battle_record_id) as count
      FROM ocr_pending_tasks
      WHERE helper_task_id = ? AND status = 'done' AND battle_record_id IS NOT NULL
    `, [helperTaskId]);
    console.log(`   关联的战报数: ${ocrBattles[0].count}`);

    // 3. battle_records数据底表（所有战报，包括手动和OCR）
    console.log('\n【3】battle_records 数据底表:');

    // 获取项目ID
    const [taskInfo] = await pool.query(
      'SELECT project_id FROM helper_configs WHERE id = ?',
      [helperTaskId]
    );

    if (taskInfo.length > 0) {
      const projectId = taskInfo[0].project_id;
      console.log(`   监听任务4对应的项目ID: ${projectId}`);

      // 该项目的战报总数
      const [projectBattles] = await pool.query(
        'SELECT COUNT(*) as total FROM battle_records WHERE project_id = ?',
        [projectId]
      );
      console.log(`   该项目的战报总数: ${projectBattles[0].total}`);

      // 最近创建的战报
      const [recentBattles] = await pool.query(`
        SELECT COUNT(*) as count
        FROM battle_records
        WHERE project_id = ?
          AND created_at >= (SELECT MIN(created_at) FROM ocr_pending_tasks WHERE helper_task_id = ?)
      `, [projectId, helperTaskId]);
      console.log(`   从OCR任务开始后创建的战报数: ${recentBattles[0].count}`);
    }

    // 4. "自动战报解析列表"应该显示什么
    console.log('\n【4】"自动战报解析列表"的数据来源:');
    const [parsedList] = await pool.query(`
      SELECT COUNT(*) as count
      FROM battle_records br
      INNER JOIN ocr_pending_tasks opt ON br.id = opt.battle_record_id
      WHERE opt.helper_task_id = ? AND opt.status = 'done'
    `, [helperTaskId]);
    console.log(`   通过OCR解析生成的战报数: ${parsedList[0].count}`);

    console.log('\n========================================');
    console.log('【标准定义】');
    console.log('========================================');
    console.log('');
    console.log('待处理: OCR任务中status=\'pending\'的数量');
    console.log(`         当前值: ${ocr.pending}`);
    console.log('');
    console.log('已处理: OCR任务中status=\'done\'的数量');
    console.log(`         当前值: ${ocr.done}`);
    console.log('');
    console.log('自动战报解析列表: 从OCR任务生成的战报记录数');
    console.log(`                   当前值: ${parsedList[0].count}`);
    console.log(`                   应该等于: 已处理数量 ${ocr.done}`);
    console.log('');
    console.log('有失败: (已处理/总任务数)');
    console.log(`         当前值: (${ocr.done}/${ocr.total})`);
    console.log('');
    console.log('数据底表: 项目的所有战报数（包括手动+OCR）');
    if (taskInfo.length > 0) {
      const [projectBattles] = await pool.query(
        'SELECT COUNT(*) as total FROM battle_records WHERE project_id = ?',
        [taskInfo[0].project_id]
      );
      console.log(`           当前值: ${projectBattles[0].total}`);
    }
    console.log('');
    console.log('========================================');

  } catch (error) {
    console.error('分析失败:', error.message);
  } finally {
    await pool.end();
  }
}

analyzeDataStructure();
