/**
 * 本地助手 - 极简版 v2.0
 *
 * 功能：
 * - 轮询监听文件夹
 * - 上传新文件到后端
 * - 更新任务进度
 *
 * 使用方法：
 * 1. 首次运行：node local-helper.minimal.js --setup
 * 2. 后台运行：node local-helper.minimal.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

// 配置文件路径
const CONFIG_PATH = path.join(__dirname, 'local-helper.config.json');
const STATE_PATH = path.join(__dirname, 'local-helper.state.json');
const PID_PATH = path.join(__dirname, 'local-helper.pid');

// 默认 API 地址
const DEFAULT_API_BASE = 'https://api.zhenwu.fun/api';

// 轮询间隔（秒）
const POLL_INTERVAL = 5;

// HTTP 服务器配置
const HELPER_PORT = 9999;
let httpServer = null;

// 单进程锁
function acquireSingleInstanceLock() {
  const existing = readJson(PID_PATH, null);
  if (existing && isProcessRunning(Number(existing.pid))) {
    console.log('✅ 本地助手已在运行');
    process.exit(0);
  }

  writeJson(PID_PATH, { pid: process.pid, startedAt: new Date().toISOString() });
  const cleanup = () => removeFileQuietly(PID_PATH);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

function isProcessRunning(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

// JSON 读写
function readJson(fp, fallback) {
  try {
    const text = fs.readFileSync(fp, 'utf8');
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function writeJson(fp, value) {
  fs.writeFileSync(fp, JSON.stringify(value, null, 2), 'utf8');
}

function removeFileQuietly(fp) {
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (e) {}
}

// 生成随机 Token
function randomToken(prefix, size = 18) {
  return `${prefix}${crypto.randomBytes(size).toString('hex')}`;
}

// API 请求
async function apiFetch(config, pathname, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (config.helperToken) headers['Authorization'] = 'Bearer ' + config.helperToken;

  const resp = await fetch((config.apiBase || DEFAULT_API_BASE).replace(/\/$/, '') + pathname, Object.assign({}, options, { headers }));
  const data = await resp.json();
  if (!resp.ok || data.code >= 400) throw new Error(data.message || ('HTTP ' + resp.status));
  return data;
}

// 获取任务列表
async function listTasks(config) {
  try {
    const data = await apiFetch(config, '/ocr-watch/tasks');
    return Array.isArray(data.data) ? data.data : [];
  } catch (e) {
    console.warn('获取任务列表失败:', e.message);
    return [];
  }
}

// 扫描文件夹
function listImages(folderPath) {
  try {
    return fs.readdirSync(folderPath)
      .filter(name => /\.(png|jpg|jpeg)$/i.test(name))
      .sort();
  } catch (e) {
    return [];
  }
}

// 创建待处理任务（不立即执行OCR）
async function uploadFile(config, task, filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');

  const resp = await fetch((config.apiBase || DEFAULT_API_BASE).replace(/\/$/, '') + '/battles/ocr-tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + config.helperToken
    },
    body: JSON.stringify({
      image: base64,
      projectId: task.projectId || null,
      imageName: fileName,
      helperTaskId: task.id
    })
  });

  const data = await resp.json();
  if (!resp.ok || data.code !== 200) throw new Error(data.message || ('Upload failed: HTTP ' + resp.status));
}

// 更新进度
async function updateProgress(config, task, payload) {
  await apiFetch(config, `/ocr-watch/tasks/${task.id}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

// 处理单个任务
async function processTask(config, state, task) {
  const taskKey = String(task.id);

  // 优先使用本地配置的文件夹路径，否则使用数据库中的路径
  const localFolder = config.taskFolders && config.taskFolders[taskKey];
  const folderPath = localFolder || task.folderPath;

  // 检查目录是否设置
  if (!folderPath || folderPath.trim() === '') {
    return;
  }

  // 检查目录是否存在
  if (!fs.existsSync(folderPath)) {
    console.warn(`[${taskKey}] 目录不存在: ${folderPath}`);
    await updateProgress(config, task, {
      lastError: `目录不存在: ${folderPath}`,
      lastHeartbeat: new Date().toISOString()
    });
    return;
  }

  // 获取本地已处理文件
  let processedFiles = new Set(state.processedByTask[taskKey] || []);

  // 从后端获取已成功解析的文件列表（防止重复提交）
  try {
    const data = await apiFetch(config, `/gallery/imagenames?successOnly=true&projectId=${encodeURIComponent(task.projectId || '')}`);
    if (Array.isArray(data.data)) {
      data.data.forEach(name => processedFiles.add(name));
    }
  } catch (e) {
    console.warn(`[${taskKey}] 查询已解析文件失败，仅使用本地缓存:`, e.message);
  }

  // 获取所有文件
  const files = listImages(folderPath);

  // 找出新文件
  const newFiles = files.filter(name => !processedFiles.has(name));

  if (newFiles.length === 0) {
    // update heartbeat (no new files) - clear pending/current
    await updateProgress(config, task, {
      pendingFiles: [],
      currentFile: '',
      processedCount: processedFiles.size,
      processedFilesJson: Array.from(processedFiles),
      lastHeartbeat: new Date().toISOString()
    });
    return;
  }

  // report pending files before processing
  await updateProgress(config, task, {
    pendingFiles: newFiles.slice(),
    currentFile: '',
    processedCount: processedFiles.size,
    processedFilesJson: Array.from(processedFiles),
    lastHeartbeat: new Date().toISOString()
  });

  // process new files
  console.log(`[${taskKey}] found ${newFiles.length} new files`);
  let successCount = 0;
  let lastError = '';

  for (let i = 0; i < newFiles.length; i++) {
    const fileName = newFiles[i];
    const fullPath = path.join(folderPath, fileName);

    // check file size (max 5MB)
    const stats = fs.statSync(fullPath);
    if (stats.size > 5 * 1024 * 1024) {
      console.warn(`[${taskKey}] file too large, skip: ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
      lastError = `${fileName}: file too large (>5MB)`;
      // report this file as current so frontend shows error
      const remaining = newFiles.slice(i + 1);
      await updateProgress(config, task, {
        pendingCount: remaining.length,
        pendingFiles: remaining,
        currentFile: fileName,
        lastError,
        lastHeartbeat: new Date().toISOString()
      });
      continue;
    }

    // report current file before upload
    const remaining = newFiles.slice(i + 1);
    await updateProgress(config, task, {
      pendingFiles: newFiles.slice(i),
      currentFile: fileName,
      lastHeartbeat: new Date().toISOString()
    });

    try {
      await uploadFile(config, task, fullPath, fileName);
      processedFiles.add(fileName);
      successCount++;
      console.log(`[${taskKey}] ok ${fileName}`);
    } catch (e) {
      console.error(`[${taskKey}] fail ${fileName}:`, e.message);
      lastError = `${fileName}: ${e.message}`;
    }

    // 每个文件处理完后检查任务状态（支持用户暂停/停止）
    try {
      const tasks = await listTasks(config);
      const currentTask = tasks.find(t => String(t.id) === taskKey);
      if (!currentTask || currentTask.status !== 'running') {
        console.log(`[${taskKey}] 任务状态已变更为 ${currentTask ? currentTask.status : 'deleted'}，停止处理`);
        // 保存进度
        state.processedByTask[taskKey] = Array.from(processedFiles);
        writeJson(STATE_PATH, state);
        return;
      }
    } catch (checkErr) {
      // 检查失败不中断处理流程
      console.warn(`[${taskKey}] 状态检查失败:`, checkErr.message);
    }
  }

  // update local state
  state.processedByTask[taskKey] = Array.from(processedFiles);
  writeJson(STATE_PATH, state);

  // update progress - clear pending/current, all done
  await updateProgress(config, task, {
    pendingFiles: [],
    currentFile: '',
    processedCount: processedFiles.size,
    processedFilesJson: Array.from(processedFiles),
    lastError,
    lastHeartbeat: new Date().toISOString()
  });
}

// 首次配置
async function setupConfig() {
  console.log('🔧 本地助手首次配置');
  console.log('');

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise(resolve => rl.question(prompt, answer => resolve(answer.trim())));

  // 获取 API 地址
  const apiBaseInput = await question('请输入 API 地址 (默认: https://api.zhenwu.fun/api，直接回车使用默认): ');
  const apiBase = apiBaseInput || DEFAULT_API_BASE;

  // 获取 Helper Token
  console.log('');
  console.log('提示：请访问 https://www.zhenwu.fun 登录后：');
  console.log('  1. 进入"自动解析"页面');
  console.log('  2. 点击"首次链接助手"按钮');
  console.log('  3. 复制显示的 Token');
  console.log('');
  const helperToken = await question('请粘贴 Helper Token: ');

  if (!helperToken) {
    console.log('❌ Helper Token 不能为空');
    process.exit(1);
  }

  // 验证 Token
  console.log('验证 Token...');
  try {
    await fetch(apiBase.replace(/\/$/, '') + '/ocr-watch/tasks', {
      headers: { 'Authorization': 'Bearer ' + helperToken }
    });
  } catch (e) {
    console.log('❌ Token 验证失败:', e.message);
    process.exit(1);
  }

  // 保存配置
  const config = {
    apiBase,
    helperToken,
    tasks: {}
  };

  writeJson(CONFIG_PATH, config);
  writeJson(STATE_PATH, { processedByTask: {} });

  console.log('');
  console.log('✅ 配置已保存到:', CONFIG_PATH);
  console.log('现在可以运行: node local-helper.minimal.js');

  rl.close();
  process.exit(0);
}

// 主函数
async function main() {
  acquireSingleInstanceLock();

  const NO_SETUP = process.argv.includes('--no-setup');
  const SETUP_MODE = process.argv.includes('--setup');

  if (SETUP_MODE) {
    await setupConfig();
    return;
  }

  // 读取配置（可选）
  let config = readJson(CONFIG_PATH, null);
  if (!config) {
    if (NO_SETUP) {
      console.log('❌ 未找到配置文件，请先运行: node local-helper.minimal.js --setup');
      process.exit(1);
    }
    // 无配置文件时使用默认配置
    console.log('⚠️  未找到配置文件，使用默认配置启动（仅支持文件夹选择功能）');
    config = {
      apiBase: DEFAULT_API_BASE,
      helperToken: null,
      tasks: {}
    };
  }

  const state = readJson(STATE_PATH, { processedByTask: {} });

  // 启动 HTTP 服务器（用于前端自动连接）
  startHttpServer(config);

  console.log('🚀 本地助手已启动');
  console.log(`   API: ${config.apiBase || DEFAULT_API_BASE}`);
  console.log(`   配置状态: ${config.helperToken ? '已配置' : '未配置（仅支持文件夹选择）'}`);

  // 主循环
  while (true) {
    try {
      config = readJson(CONFIG_PATH, config);

      // 如果没有 Token，跳过任务轮询
      if (!config.helperToken) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000));
        continue;
      }

      const tasks = await listTasks(config);

      // 同步 processedFiles
      tasks.forEach(task => {
        const taskKey = String(task.id);
        if (task.processedFilesJson && Array.isArray(task.processedFilesJson)) {
          const serverFiles = new Set(task.processedFilesJson);
          const localFiles = new Set(state.processedByTask[taskKey] || []);

          if (serverFiles.size !== localFiles.size || [...serverFiles].some(f => !localFiles.has(f))) {
            console.log(`[${taskKey}] 同步已处理文件列表 (${serverFiles.size} 个)`);
            state.processedByTask[taskKey] = Array.from(serverFiles);
          }
        }
      });

      writeJson(STATE_PATH, state);

      // 处理所有 running 状态的任务
      for (const task of tasks) {
        if (task.status === 'running') {
          await processTask(config, state, task);
        }
      }
    } catch (e) {
      console.error('❌ 轮询失败:', e.message);
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000));
  }
}

main().catch(err => {
});
// ========== HTTP 服务器（用于前端自动连接）==========

function startHttpServer(config) {
  if (httpServer) return;

  httpServer = http.createServer((req, res) => {
    // CORS 支持
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // /ping - 检测本地助手是否运行
    if (req.url === '/ping' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok', 
        version: '2.0',
        configured: !!(config.helperToken)
      }));
      return;
    }

    // /activate - 接收前端传递的 Token
    if (req.url === '/activate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.token || !data.apiBase) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '缺少必要参数' }));
            return;
          }

          // 保存配置
          config.helperToken = data.token;
          config.apiBase = data.apiBase;
          if (data.deviceId) config.deviceId = data.deviceId;
          writeJson(CONFIG_PATH, config);

          console.log('✅ 本地助手已激活，Token 已保存');
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', message: '激活成功' }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // /status - 获取当前状态
    if (req.url === '/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        configured: !!(config.helperToken),
        apiBase: config.apiBase || '',
        running: true
      }));
      return;
    }

    // /select-folder - 弹出文件夹选择器
    if (req.url === '/select-folder' && req.method === 'GET') {
      const { execSync } = require('child_process');
      const os = require('os');

      const exePath = path.join(__dirname, 'fpicker.exe');
      const resultPath = path.join(os.tmpdir(), 'nslg_folder_result.txt');

      if (!fs.existsSync(exePath)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, data: { path: null }, message: 'fpicker.exe not found' }));
        return;
      }

      try {
        // 清理旧结果文件
        if (fs.existsSync(resultPath)) {
          fs.unlinkSync(resultPath);
        }

        // 调用 fpicker.exe
        const cmdArgs = `"${exePath}" "${resultPath}"`;
        execSync(`cmd /c start "FolderPicker" /min /wait ${cmdArgs}`, { timeout: 120000 });

        // 读取结果
        let folderPath = null;
        if (fs.existsSync(resultPath)) {
          const raw = fs.readFileSync(resultPath, 'utf8').trim();
          if (raw && raw !== 'CANCELLED' && !raw.startsWith('ERROR:')) {
            folderPath = raw;
          }
          fs.unlinkSync(resultPath);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 200, data: { path: folderPath } }));
      } catch (e) {
        if (fs.existsSync(resultPath)) {
          fs.unlinkSync(resultPath);
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, data: { path: null }, message: e.message }));
      }
      return;
    }

    // /bind-task - 绑定任务到文件夹
    if (req.url === '/bind-task' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { taskId, folderPath } = JSON.parse(body);

          if (!taskId || !folderPath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 400, message: 'taskId and folderPath are required' }));
            return;
          }

          // 更新配置文件
          const config = readJson(CONFIG_PATH, { apiBase: DEFAULT_API_BASE, helperToken: '', clientId: null, deviceId: '', taskFolders: {} });
          if (!config.taskFolders) config.taskFolders = {};
          config.taskFolders[String(taskId)] = folderPath;
          writeJson(CONFIG_PATH, config);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 200, message: 'Task bound successfully' }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 500, message: e.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  httpServer.listen(HELPER_PORT, '127.0.0.1', () => {
    console.log(`🌐 HTTP 服务已启动: http://127.0.0.1:${HELPER_PORT}`);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  端口 ${HELPER_PORT} 已被占用，HTTP 服务未启动`);
      httpServer = null;
    } else {
      console.error('HTTP 服务器错误:', err);
    }
  });
}
