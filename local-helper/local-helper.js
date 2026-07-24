/**
 * 本地助手 - 重构版 v3.0
 *
 * 核心原则：
 * 1. 只做本地助手能做的事：扫描本地文件 + 上传
 * 2. 不上报进度（后端自己统计数据库）
 * 3. 不做心跳检测（过度设计）
 *
 * 功能清单：
 * 1. 激活连接（一次性）
 * 2. 扫描上传文件（循环）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

// ========== 配置 ==========
const CONFIG_PATH = path.join(__dirname, 'local-helper.config.json');
const PID_PATH = path.join(__dirname, 'local-helper.pid');
const DEFAULT_API_BASE = 'https://api.zhenwu.fun/api';
const POLL_INTERVAL = 5;  // 轮询间隔（秒）
const HELPER_PORT = 9999;  // HTTP 服务端口

let httpServer = null;

// ========== 工具函数 ==========

function readJson(fp, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(fp, value) {
  fs.writeFileSync(fp, JSON.stringify(value, null, 2), 'utf8');
}

function normalizeApiBase(apiBase) {
  const value = String(apiBase || DEFAULT_API_BASE).trim() || DEFAULT_API_BASE;
  if (/^http:\/\/api\.zhenwu\.fun\/api\/?$/i.test(value)) {
    return 'https://api.zhenwu.fun/api';
  }
  return value.replace(/\/$/, '');
}

function removeFileQuietly(fp) {
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (e) {}
}

// ========== 单实例锁 ==========

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

// ========== API 请求 ==========

async function apiFetch(config, pathname, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (config.helperToken) {
    headers['Authorization'] = 'Bearer ' + config.helperToken;
  }

  const url = normalizeApiBase(config.apiBase) + pathname;
  const resp = await fetch(url, Object.assign({}, options, { headers }));
  const data = await resp.json();

  if (!resp.ok || data.code >= 400) {
    throw new Error(data.message || ('HTTP ' + resp.status));
  }

  return data;
}

// ========== 核心功能1：获取任务列表 ==========

async function listTasks(config) {
  try {
    const data = await apiFetch(config, '/ocr-watch/tasks');
    return Array.isArray(data.data) ? data.data : [];
  } catch (e) {
    console.warn('[任务列表] 获取失败:', e.message);
    return [];
  }
}

// ========== 核心功能1.5：上报目录状态 ==========

async function reportFolderStatus(config, taskId, status, message) {
  try {
    await apiFetch(config, `/ocr-watch/tasks/${taskId}/folder-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, message })
    });
  } catch (e) {
    throw new Error(`上报目录状态失败: ${e.message}`);
  }
}

// ========== 核心功能1.6：发送心跳 ==========

async function sendHeartbeat(config, taskId) {
  try {
    await apiFetch(config, `/ocr-watch/tasks/${taskId}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    // 心跳失败不影响主流程，仅记录日志
    console.warn(`[心跳] 任务 ${taskId} 心跳发送失败:`, e.message);
  }
}

// ========== 核心功能2：扫描本地文件 ==========

function listImages(folderPath) {
  try {
    return fs.readdirSync(folderPath)
      .filter(name => /\.(png|jpg|jpeg)$/i.test(name))
      .sort();
  } catch (e) {
    return [];
  }
}

// ========== 核心功能3：查询已处理文件（去重） ==========

async function getProcessedFiles(config, projectId) {
  try {
    const data = await apiFetch(
      config,
      `/gallery/imagenames?successOnly=true&projectId=${encodeURIComponent(projectId)}`
    );
    return new Set(Array.isArray(data.data) ? data.data : []);
  } catch (e) {
    console.warn('[去重查询] 获取已处理文件失败:', e.message);
    throw e;  // 查询失败时抛出异常，避免重复上传
  }
}

// ========== 核心功能4：上传文件 ==========

async function uploadFile(config, task, filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');

  // 获取项目标注配置
  let labelConfig = null;
  try {
    const projectId = task.projectId || 0;
    const configResp = await fetch(
      normalizeApiBase(config.apiBase) + `/label-config/${projectId}`,
      { headers: { 'Authorization': 'Bearer ' + config.helperToken } }
    );
    if (configResp.ok) {
      const configData = await configResp.json();
      if (configData.code === 200 && configData.data && configData.data.categories) {
        labelConfig = configData.data.categories;
      }
    }
  } catch (e) {
    console.warn('[标注配置] 获取失败，使用自动检测模式:', e.message);
  }

  // 上传文件
  const reqBody = {
    image: base64,
    projectId: task.projectId || null,
    imageName: fileName,
    source: 'auto-watch',
    helperTaskId: task.id
  };
  if (labelConfig) {
    reqBody.labelConfig = labelConfig;
  }

  const resp = await fetch(
    normalizeApiBase(config.apiBase) + '/battles/ocr-upload',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.helperToken
      },
      body: JSON.stringify(reqBody)
    }
  );

  const data = await resp.json();
  if (!resp.ok || data.code !== 200) {
    const err = new Error(data.message || ('Upload failed: HTTP ' + resp.status));
    err.code = data.code || resp.status;
    throw err;
  }

  return data.data || null;
}

// ========== 核心功能5：处理单个任务 ==========

async function processTask(config, task) {
  const taskKey = String(task.id);

  // 获取文件夹路径
  const localFolder = config.taskFolders && config.taskFolders[taskKey];
  const folderPath = task.folderPath || localFolder;

  // 同步配置（如果后端更新了路径）
  if (task.folderPath && localFolder !== task.folderPath) {
    if (!config.taskFolders) config.taskFolders = {};
    config.taskFolders[taskKey] = task.folderPath;
    config.lastFolderPath = task.folderPath;
    writeJson(CONFIG_PATH, config);
  }

  // 检查目录
  if (!folderPath || !folderPath.trim()) {
    return;
  }

  // 检查目录是否存在
  if (!fs.existsSync(folderPath)) {
    console.warn(`[任务${taskKey}] 目录不存在: ${folderPath}`);
    // 上报目录状态
    await reportFolderStatus(config, task.id, 'not_found', `目录不存在: ${folderPath}`).catch(e => {
      console.warn(`[任务${taskKey}] 上报目录状态失败:`, e.message);
    });
    return;
  }

  // 目录存在，上报正常状态
  await reportFolderStatus(config, task.id, 'ok', '').catch(e => {
    console.warn(`[任务${taskKey}] 上报目录状态失败:`, e.message);
  });

  // 查询已处理文件（去重）
  let processedFiles;
  try {
    processedFiles = await getProcessedFiles(config, task.projectId);
  } catch (e) {
    console.warn(`[任务${taskKey}] 查询已处理文件失败，跳过本轮，避免重复上传`);
    return;
  }

  // 扫描本地文件
  const localFiles = listImages(folderPath);

  // 计算新文件
  const newFiles = localFiles.filter(name => !processedFiles.has(name));

  if (newFiles.length === 0) {
    return;  // 无新文件，直接返回
  }

  console.log(`[任务${taskKey}] 发现 ${newFiles.length} 个新文件`);

  // 逐个上传
  for (let i = 0; i < newFiles.length; i++) {
    const fileName = newFiles[i];
    const fullPath = path.join(folderPath, fileName);

    // 检查任务状态（支持暂停）
    try {
      const tasks = await listTasks(config);
      const currentTask = tasks.find(t => String(t.id) === taskKey);
      if (!currentTask || currentTask.status !== 'running') {
        console.log(`[任务${taskKey}] 状态已变更为 ${currentTask ? currentTask.status : 'deleted'}，停止处理`);
        return;
      }
    } catch (checkErr) {
      console.warn(`[任务${taskKey}] 状态检查失败:`, checkErr.message);
    }

    // 检查文件大小
    const stats = fs.statSync(fullPath);
    if (stats.size > 5 * 1024 * 1024) {
      console.warn(`[任务${taskKey}] 文件过大，跳过: ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
      continue;
    }

    // 上传文件
    try {
      await uploadFile(config, task, fullPath, fileName);
      console.log(`[任务${taskKey}] ✅ ${fileName}`);
    } catch (e) {
      console.error(`[任务${taskKey}] ❌ ${fileName}: ${e.message}`);
    }
  }
}

// ========== HTTP 服务器（用于前端连接） ==========

function startHttpServer(config) {
  if (httpServer) return;

  httpServer = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // /ping 和 /status - 检测助手状态（两个接口返回相同内容，兼容旧版前端）
    if ((req.url === '/ping' || req.url === '/status') && req.method === 'GET') {
      // 每次请求都重新读取配置，确保返回最新状态
      const currentConfig = readJson(CONFIG_PATH, config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        version: '3.0-refactored',
        configured: !!currentConfig.helperToken,
        helperClientId: currentConfig.helperClientId || null,
        deviceId: currentConfig.deviceId || null,
        apiBase: normalizeApiBase(currentConfig.apiBase),
        lastFolderPath: currentConfig.lastFolderPath || '',
        folderExists: currentConfig.lastFolderPath ? fs.existsSync(currentConfig.lastFolderPath) : null,
        running: true
      }));
      return;
    }

    // /activate - 激活助手
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

          const apiBase = data.apiBase;
          const deviceId = config.deviceId || data.deviceId || ('device-' + Date.now());

          const helperConfigResp = await fetch(
            apiBase.replace(/\/$/, '') + '/ocr-watch/helper-config?deviceId=' + encodeURIComponent(deviceId),
            { headers: { 'Authorization': 'Bearer ' + data.token } }
          );

          const helperConfig = await helperConfigResp.json();
          if (!helperConfigResp.ok || helperConfig.code !== 200 || !helperConfig.data || !helperConfig.data.helperToken) {
            throw new Error(helperConfig.message || 'helper config failed');
          }

          // 保存配置
          config.helperToken = helperConfig.data.helperToken;
          config.helperClientId = helperConfig.data.helperClientId || null;
          config.apiBase = normalizeApiBase(helperConfig.data.apiBase || apiBase);
          config.deviceId = helperConfig.data.deviceId || deviceId;
          writeJson(CONFIG_PATH, config);

          console.log('✅ 助手已激活');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            message: '激活成功',
            helperClientId: config.helperClientId || null,
            deviceId: config.deviceId || ''
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // /bind-task - 绑定任务（前端创建任务后通知本地助手）
    if (req.url === '/bind-task' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.taskId || !data.folderPath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 400, message: '缺少 taskId 或 folderPath' }));
            return;
          }

          // 保存任务文件夹映射到配置
          if (!config.taskFolders) config.taskFolders = {};
          config.taskFolders[String(data.taskId)] = data.folderPath;
          config.lastFolderPath = data.folderPath;
          writeJson(CONFIG_PATH, config);

          console.log(`✅ 已绑定任务 ${data.taskId} -> ${data.folderPath}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 200, message: '绑定成功' }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 500, message: e.message }));
        }
      });
      return;
    }

    // /select-folder - 文件夹选择（保持原有实现）
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    if (reqUrl.pathname === '/select-folder' && req.method === 'GET') {
      const { execSync } = require('child_process');
      const os = require('os');

      const exePath = path.join(__dirname, 'fpicker.exe');
      const ps1Path = path.join(__dirname, 'fpicker.ps1');
      const resultPath = path.join(os.tmpdir(), 'nslg_folder_result.txt');

      // 检查 fpicker.exe 或 fpicker.ps1 是否存在
      const useExe = fs.existsSync(exePath);
      const usePs1 = fs.existsSync(ps1Path);

      if (!useExe && !usePs1) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, data: { path: null }, message: 'fpicker.exe 或 fpicker.ps1 未找到' }));
        return;
      }

      try {
        if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);

        const initialPath = String(reqUrl.searchParams.get('initialPath') || config.lastFolderPath || '').trim();
        const safeInitialPath = initialPath && fs.existsSync(initialPath) ? initialPath.replace(/"/g, '') : '';

        let cmd;
        if (useExe) {
          let cmdArgs = `"${exePath}" "${resultPath}"`;
          if (safeInitialPath) cmdArgs += ` "${safeInitialPath}"`;
          cmd = `cmd /c start "FolderPicker" /min /wait ${cmdArgs}`;
        } else {
          // 使用 PowerShell 脚本
          const ps1Args = `-ResultPath "${resultPath}"` + (safeInitialPath ? ` -InitialPath "${safeInitialPath}"` : '');
          cmd = `powershell -STA -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}" ${ps1Args}`;
        }

        execSync(cmd, { timeout: 120000 });

        let folderPath = null;
        if (fs.existsSync(resultPath)) {
          const raw = fs.readFileSync(resultPath, 'utf8').trim();
          if (raw && raw !== 'CANCELLED' && !raw.startsWith('ERROR:')) {
            folderPath = raw;
          }
          fs.unlinkSync(resultPath);
        }

        if (folderPath) {
          config.lastFolderPath = folderPath;
          writeJson(CONFIG_PATH, config);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 200, data: { path: folderPath } }));
      } catch (e) {
        if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, data: { path: null }, message: e.message }));
      }
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  httpServer.listen(HELPER_PORT, '127.0.0.1', () => {
    console.log(`🌐 HTTP 服务: http://127.0.0.1:${HELPER_PORT}`);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  端口 ${HELPER_PORT} 已被占用`);
      httpServer = null;
    } else {
      console.error('HTTP 服务器错误:', err);
    }
  });
}

// ========== 主循环 ==========

async function main() {
  acquireSingleInstanceLock();

  // 读取配置
  let config = readJson(CONFIG_PATH, null);
  if (!config) {
    console.log('⚠️  未找到配置文件，使用默认配置（仅支持文件夹选择）');
    config = {
      apiBase: DEFAULT_API_BASE,
      helperToken: null,
      taskFolders: {}
    };
  }

  // 启动 HTTP 服务
  startHttpServer(config);

  console.log('🚀 本地助手已启动 v3.0-refactored');
  console.log(`   API: ${config.apiBase || DEFAULT_API_BASE}`);
  console.log(`   配置: ${config.helperToken ? '已配置' : '未配置'}`);

  // 主循环：扫描任务 + 上传文件
  while (true) {
    try {
      // 重新读取配置（支持热更新）
      config = readJson(CONFIG_PATH, config);

      // 如果没有 Token，跳过任务处理
      if (!config.helperToken) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000));
        continue;
      }

      // 获取任务列表
      const tasks = await listTasks(config);

      // 处理所有 running 状态的任务
      for (const task of tasks) {
        if (task.status === 'running') {
          // 发送心跳保持在线状态
          await sendHeartbeat(config, task.id);

          // 处理任务文件
          await processTask(config, task);
        }
      }
    } catch (e) {
      console.error('❌ 轮询失败:', e.message);
    }

    // 等待下一轮
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000));
  }
}

main().catch(err => {
  console.error('💥 致命错误:', err);
  process.exit(1);
});
