/**
 * 本地助手监听状态诊断工具
 * 检查监听是否真的生效
 */

const mysql = require('mysql2/promise');
const http = require('http');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  host: 'localhost',
  user: 'nslg-battle-server',
  password: 'hu6956521',
  database: 'nslg_battle',
  dateStrings: true
};

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(msg, color = 'reset') {
  console.log(colors[color] + msg + colors.reset);
}

async function checkBackendAPI() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 9999,
      path: '/ping',
      method: 'GET',
      timeout: 3000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ ok: true, data });
        } catch (e) {
          resolve({ ok: false, error: '响应格式错误' });
        }
      });
    });
    req.on('error', (e) => {
      resolve({ ok: false, error: e.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: '连接超时' });
    });
    req.end();
  });
}

async function checkTasksWithToken(token) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/ocr-watch/tasks',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token
      },
      timeout: 5000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ ok: res.statusCode === 200, status: res.statusCode, data });
        } catch (e) {
          resolve({ ok: false, error: '响应格式错误' });
        }
      });
    });
    req.on('error', (e) => {
      resolve({ ok: false, error: e.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: '连接超时' });
    });
    req.end();
  });
}

async function main() {
  const pool = mysql.createPool(dbConfig);

  try {
    log('\n========== 本地助手监听状态诊断 ==========\n', 'blue');

    // 1. 检查本地助手进程
    log('【1/7】检查本地助手进程 (local-helper.js)', 'yellow');
    const pidPath = path.join(__dirname, 'local-helper', 'local-helper.pid');
    if (fs.existsSync(pidPath)) {
      try {
        const pidData = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
        log(`  ✅ PID 文件存在: ${pidData.pid}`, 'green');
        log(`  启动时间: ${pidData.startedAt}`, 'reset');
      } catch (e) {
        log(`  ❌ PID 文件损坏`, 'red');
      }
    } else {
      log(`  ❌ PID 文件不存在 - 本地助手未运行`, 'red');
    }

    // 2. 检查本地助手 HTTP 服务 (端口 9999)
    log('\n【2/7】检查本地助手 HTTP 服务 (端口 9999)', 'yellow');
    const helperStatus = await checkBackendAPI();
    if (helperStatus.ok) {
      log(`  ✅ HTTP 服务正常`, 'green');
      log(`  版本: ${helperStatus.data.version || '未知'}`, 'reset');
      log(`  已配置: ${helperStatus.data.configured ? '是' : '否'}`, 'reset');
      log(`  API Base: ${helperStatus.data.apiBase}`, 'reset');
      log(`  最后目录: ${helperStatus.data.lastFolderPath || '(无)'}`, 'reset');
    } else {
      log(`  ❌ 无法连接到 HTTP 服务: ${helperStatus.error}`, 'red');
    }

    // 3. 检查数据库中的任务配置
    log('\n【3/7】检查数据库中的任务配置', 'yellow');
    const [configs] = await pool.query(
      `SELECT id, user_id, project_id, folder_path, access_token, folder_status,
              folder_status_message, created_at, updated_at
       FROM helper_configs
       ORDER BY updated_at DESC
       LIMIT 5`
    );

    if (configs.length === 0) {
      log(`  ❌ 数据库中无任务配置`, 'red');
    } else {
      log(`  ✅ 找到 ${configs.length} 个任务配置`, 'green');
      for (const cfg of configs) {
        const token = cfg.access_token.substring(0, 20) + '...';
        log(`\n  配置 ID: ${cfg.id}`, 'reset');
        log(`    用户ID: ${cfg.user_id}`, 'reset');
        log(`    项目ID: ${cfg.project_id}`, 'reset');
        log(`    目录: ${cfg.folder_path || '(未设置)'}`, 'reset');
        log(`    目录状态: ${cfg.folder_status || 'unknown'}`, 'reset');
        if (cfg.folder_status_message) {
          log(`    状态消息: ${cfg.folder_status_message}`, 'reset');
        }
        log(`    Token: ${token}`, 'reset');
        log(`    更新时间: ${cfg.updated_at}`, 'reset');

        // 检查目录是否存在
        if (cfg.folder_path) {
          if (fs.existsSync(cfg.folder_path)) {
            const files = fs.readdirSync(cfg.folder_path)
              .filter(f => /\.(png|jpg|jpeg)$/i.test(f));
            log(`    ✅ 目录存在，包含 ${files.length} 个图片文件`, 'green');
          } else {
            log(`    ❌ 目录不存在！`, 'red');
          }
        }

        // 测试 token 是否有效
        if (cfg.access_token) {
          const taskCheck = await checkTasksWithToken(cfg.access_token);
          if (taskCheck.ok) {
            log(`    ✅ Token 有效`, 'green');
          } else {
            log(`    ❌ Token 无效: ${taskCheck.error || taskCheck.data?.message}`, 'red');
          }
        }
      }
    }

    // 4. 检查活动任务
    log('\n【4/7】检查活动的监听任务', 'yellow');
    const [tasks] = await pool.query(
      `SELECT t.id, t.user_id, t.project_id, t.status, t.folder_path,
              t.stats_uploaded, t.stats_pending, t.stats_failed,
              t.created_at, t.updated_at, p.name as project_name
       FROM ocr_watch_tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.status IN ('running', 'paused', 'pending_bind')
       ORDER BY t.updated_at DESC`
    );

    if (tasks.length === 0) {
      log(`  ⚠️  当前没有活动的监听任务`, 'yellow');
    } else {
      log(`  ✅ 找到 ${tasks.length} 个活动任务`, 'green');
      for (const task of tasks) {
        log(`\n  任务 ID: ${task.id}`, 'reset');
        log(`    项目: ${task.project_name || task.project_id}`, 'reset');
        log(`    状态: ${task.status}`, 'reset');
        log(`    目录: ${task.folder_path || '(未设置)'}`, 'reset');
        log(`    已上传: ${task.stats_uploaded || 0}`, 'reset');
        log(`    待处理: ${task.stats_pending || 0}`, 'reset');
        log(`    失败: ${task.stats_failed || 0}`, 'reset');
        log(`    更新时间: ${task.updated_at}`, 'reset');

        // 检查是否真的在运行
        if (task.status === 'running') {
          const timeDiff = Date.now() - new Date(task.updated_at).getTime();
          const minutes = Math.floor(timeDiff / 60000);
          if (minutes > 5) {
            log(`    ⚠️  任务已 ${minutes} 分钟未更新，可能未真正运行`, 'yellow');
          } else {
            log(`    ✅ 任务最近有活动 (${minutes} 分钟前)`, 'green');
          }
        }
      }
    }

    // 5. 检查最近上传的图片
    log('\n【5/7】检查最近上传的图片记录', 'yellow');
    const [recentUploads] = await pool.query(
      `SELECT id, project_id, original_name, file_size, source,
              uploader_phone, created_at
       FROM battle_gallery
       WHERE source = 'auto-watch'
       ORDER BY created_at DESC
       LIMIT 5`
    );

    if (recentUploads.length === 0) {
      log(`  ⚠️  没有找到自动监听上传的图片`, 'yellow');
    } else {
      log(`  ✅ 最近 5 条自动上传记录:`, 'green');
      for (const upload of recentUploads) {
        const timeAgo = Math.floor((Date.now() - new Date(upload.created_at).getTime()) / 60000);
        log(`    ${upload.original_name} - ${timeAgo} 分钟前`, 'reset');
      }
    }

    // 6. 检查 OCR 任务队列
    log('\n【6/7】检查 OCR 任务队列', 'yellow');
    const [ocrTasks] = await pool.query(
      `SELECT status, COUNT(*) as count
       FROM ocr_tasks
       GROUP BY status`
    );

    if (ocrTasks.length === 0) {
      log(`  ⚠️  OCR 任务队列为空`, 'yellow');
    } else {
      log(`  OCR 任务统计:`, 'reset');
      for (const stat of ocrTasks) {
        log(`    ${stat.status}: ${stat.count}`, 'reset');
      }
    }

    // 7. 综合诊断建议
    log('\n【7/7】综合诊断结果', 'yellow');
    const issues = [];

    if (!helperStatus.ok) {
      issues.push('本地助手 HTTP 服务未运行 (端口 9999)');
    }

    if (configs.length === 0) {
      issues.push('数据库中没有任务配置');
    }

    if (tasks.length === 0) {
      issues.push('没有运行中的监听任务');
    }

    const hasRecentUploads = recentUploads.length > 0 &&
      (Date.now() - new Date(recentUploads[0].created_at).getTime()) < 5 * 60 * 1000;

    if (tasks.length > 0 && !hasRecentUploads) {
      issues.push('任务在运行但最近5分钟没有新上传');
    }

    if (issues.length === 0) {
      log(`\n  ✅ 监听系统运行正常！`, 'green');
    } else {
      log(`\n  ⚠️  发现以下问题:`, 'yellow');
      issues.forEach(issue => log(`    • ${issue}`, 'red'));

      log(`\n  💡 建议排查步骤:`, 'blue');
      log(`    1. 确保本地助手已启动 (运行 start-local.ps1)`, 'reset');
      log(`    2. 在网页端检查任务状态是否为"运行中"`, 'reset');
      log(`    3. 确认监听目录路径正确且有新图片`, 'reset');
      log(`    4. 查看本地助手日志: local-helper/helper-worker.log`, 'reset');
    }

    log('\n========================================\n', 'blue');

  } catch (e) {
    log(`\n❌ 诊断失败: ${e.message}`, 'red');
    console.error(e);
  } finally {
    await pool.end();
  }
}

main();
