const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const CONFIG_PATH = path.join(__dirname, 'local-helper.config.json');
const STATE_PATH = path.join(__dirname, 'local-helper.state.json');
const PID_PATH = path.join(__dirname, 'local-helper.pid');
const POLL_MS = 8000;
const DEFAULT_LOCAL_API = 'http://127.0.0.1:3000/api';
const NO_PROMPT = process.argv.includes('--no-prompt');

function readJson(fp, fallback) {
  try {
    const buffer = fs.readFileSync(fp);
    let text;
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      text = buffer.toString('utf16le');
    } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      text = Buffer.from(buffer.slice(2)).swap16().toString('utf16le');
    } else {
      text = buffer.toString('utf8');
    }
    return JSON.parse(text.replace(/^\uFEFF/, ''));
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

function formatLocalDateTime(date = new Date()) {
  const pad = num => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

function acquireSingleInstanceLock() {
  const existing = readJson(PID_PATH, null);
  if (existing && isProcessRunning(Number(existing.pid))) {
    console.log('Local helper is already running.');
    process.exit(0);
  }

  writeJson(PID_PATH, { pid: process.pid, startedAt: formatLocalDateTime() });
  const cleanup = () => removeFileQuietly(PID_PATH);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

function getConfig() {
  return readJson(CONFIG_PATH, {
    apiBase: DEFAULT_LOCAL_API,
    helperToken: '',
    clientId: null,
    deviceId: '',
    taskFolders: {}
  });
}

function getState() {
  return readJson(STATE_PATH, { processedByTask: {} });
}

function pruneLocalState(state, tasks) {
  const validIds = new Set((tasks || []).map(task => String(task.id)));
  const nextProcessed = {};
  Object.entries(state.processedByTask || {}).forEach(([taskId, files]) => {
    if (validIds.has(taskId)) nextProcessed[taskId] = Array.isArray(files) ? files : [];
  });
  state.processedByTask = nextProcessed;
  writeJson(STATE_PATH, state);
}

function pruneTaskFolders(config, tasks) {
  const validIds = new Set((tasks || []).map(task => String(task.id)));
  const nextFolders = {};
  Object.entries(config.taskFolders || {}).forEach(([taskId, folderPath]) => {
    if (validIds.has(taskId)) nextFolders[taskId] = folderPath;
  });
  config.taskFolders = nextFolders;
  writeJson(CONFIG_PATH, config);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function apiFetch(config, pathname, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (config.helperToken) headers.Authorization = 'Bearer ' + config.helperToken;
  const resp = await fetch(config.apiBase.replace(/\/$/, '') + pathname, Object.assign({}, options, { headers }));
  const data = await resp.json();
  if (!resp.ok || data.code >= 400) throw new Error(data.message || ('HTTP ' + resp.status));
  return data;
}

async function resolveApiBase(config) {
  const candidates = [];
  if (config.apiBase) candidates.push(String(config.apiBase).trim().replace(/\/$/, ''));
  if (!candidates.includes(DEFAULT_LOCAL_API)) candidates.push(DEFAULT_LOCAL_API);
  for (const apiBase of candidates) {
    try {
      const resp = await fetch(apiBase + '/health');
      if (resp.ok) return apiBase;
    } catch (e) {}
  }
  return (config.apiBase || DEFAULT_LOCAL_API).replace(/\/$/, '');
}

async function bindIfNeeded(config) {
  const apiBase = await resolveApiBase(config);
  if (config.helperToken && config.clientId) return Object.assign(config, { apiBase });
  if (NO_PROMPT) throw new Error('Local helper is not linked yet. Please finish linking in the desktop helper window first.');

  console.log(`Local helper will connect to: ${apiBase}`);
  const linkToken = await ask('Paste the link code from the web page: ');
  const nextConfig = Object.assign({}, config, {
    apiBase,
    deviceId: config.deviceId || crypto.randomUUID()
  });

  const data = await apiFetch(nextConfig, '/local-helper/link/consume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkToken,
      deviceId: nextConfig.deviceId,
      deviceName: process.env.COMPUTERNAME || 'Windows-PC',
      helperVersion: '0.2.0',
      meta: { platform: process.platform }
    })
  });

  nextConfig.helperToken = data.data.helperToken;
  nextConfig.clientId = data.data.clientId;
  writeJson(CONFIG_PATH, nextConfig);
  console.log('Link succeeded. Device:', data.data.deviceName);
  return nextConfig;
}

async function listTasks(config) {
  const data = await apiFetch(config, '/local-helper/assigned-tasks');
  return Array.isArray(data.data) ? data.data : [];
}

async function listSuccessfulImageNames(config, projectId) {
  if (!projectId) return [];
  const data = await apiFetch(config, `/gallery/imagenames?successOnly=true&projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(data.data) ? data.data.map(name => String(name || '').trim()).filter(Boolean) : [];
}

function areStringSetsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

function listImages(folderPath) {
  try {
    return fs.readdirSync(folderPath)
      .filter(name => /\.(png|jpg|jpeg)$/i.test(name))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (e) {
    return [];
  }
}

function buildTaskStats(task, files, known, overrides = {}) {
  const successfulFiles = files.filter(name => known.has(name));
  const pendingFiles = files.filter(name => !known.has(name));
  return Object.assign({
    discovered: files.length,
    uploaded: successfulFiles.length,
    parsed: successfulFiles.length,
    failed: Number(task.stats?.failed || 0),
    pending: pendingFiles.length,
    pendingFiles: pendingFiles.slice(0, 200),
    currentFile: ''
  }, overrides);
}

async function uploadTaskFile(config, task, filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  const resp = await fetch(config.apiBase.replace(/\/$/, '') + '/battles/ocr-upload', {
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

async function reportProgress(config, task, payload) {
  await apiFetch(config, `/local-helper/tasks/${task.id}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function ensureTaskFolder(config, task) {
  const taskKey = String(task.id);
  const savedFolder = String(config.taskFolders?.[taskKey] || '').trim();

  if (task.folderPath) {
    if (savedFolder !== task.folderPath) {
      config.taskFolders = Object.assign({}, config.taskFolders, { [taskKey]: task.folderPath });
      writeJson(CONFIG_PATH, config);
    }
    return task.folderPath;
  }

  if (savedFolder && fs.existsSync(savedFolder)) {
    await reportProgress(config, task, { status: 'ready', folderPath: savedFolder, stats: task.stats || {} });
    return savedFolder;
  }

  if (NO_PROMPT) return '';

  const folderPath = (await ask(`Enter a local folder for task ${task.name || task.id}: `)).trim();
  if (!folderPath) return '';
  if (!fs.existsSync(folderPath)) {
    console.log('Folder does not exist. Please try again later.');
    return '';
  }

  config.taskFolders = Object.assign({}, config.taskFolders, { [taskKey]: folderPath });
  writeJson(CONFIG_PATH, config);
  await reportProgress(config, task, { status: 'ready', folderPath, stats: task.stats || {} });
  console.log(`Task ${task.id} is now bound to ${folderPath}`);
  return folderPath;
}

async function processTask(config, state, task) {
  const taskKey = String(task.id);
  const localKnown = new Set((state.processedByTask[taskKey] || []).map(name => String(name || '').trim()).filter(Boolean));
  let known = localKnown;
  try {
    known = new Set(await listSuccessfulImageNames(config, task.projectId));
    if (!areStringSetsEqual(known, localKnown)) {
      state.processedByTask[taskKey] = [...known];
      writeJson(STATE_PATH, state);
    }
  } catch (e) {
    console.warn(`Failed to refresh successful image list for task ${task.id}: ${e.message}`);
  }
  const folderPath = await ensureTaskFolder(config, task);
  if (!folderPath) {
    await reportProgress(config, task, { status: 'pending_bind', stats: task.stats || {} });
    return;
  }

  task.folderPath = folderPath;
  const files = listImages(folderPath);
  const taskStatus = String(task.status || '').trim().toLowerCase();
  let stats = buildTaskStats(task, files, known);

  await reportProgress(config, task, {
    status: taskStatus === 'paused' ? 'paused' : (taskStatus === 'stopped' ? 'stopped' : (taskStatus === 'running' ? 'running' : 'ready')),
    folderPath,
    stats
  });

  if (taskStatus !== 'running') return;

  for (const fileName of [...stats.pendingFiles]) {
    const fullPath = path.join(folderPath, fileName);
    try {
      stats = buildTaskStats(task, files, known, {
        uploaded: stats.uploaded,
        parsed: stats.parsed,
        failed: stats.failed,
        currentFile: fileName
      });
      await reportProgress(config, task, {
        status: 'running',
        folderPath,
        stats
      });

      await uploadTaskFile(config, task, fullPath, fileName);
      known.add(fileName);
      state.processedByTask[taskKey] = [...known];
      writeJson(STATE_PATH, state);
      stats = buildTaskStats(task, files, known, {
        uploaded: stats.uploaded + 1,
        parsed: stats.parsed + 1,
        failed: stats.failed,
        currentFile: ''
      });
      task.stats = stats;
      try {
        await reportProgress(config, task, {
          status: 'running',
          folderPath,
          lastUploadAt: formatLocalDateTime(),
          stats
        });
      } catch (progressErr) {
        console.error(`Failed to write progress for ${fileName}: ${progressErr.message}`);
      }
      } catch (e) {
      stats = buildTaskStats(task, files, known, {
        uploaded: stats.uploaded,
        parsed: stats.parsed,
        failed: stats.failed + 1,
        currentFile: fileName
      });
      task.stats = stats;
      try {
        await reportProgress(config, task, {
          status: 'error',
          folderPath,
          lastError: `${fileName}: ${e.message}`,
          stats
        });
      } catch (progressErr) {
        console.error(`Failed to write error status for ${fileName}: ${progressErr.message}`);
      }
    }
  }

  state.processedByTask[taskKey] = [...known];
  writeJson(STATE_PATH, state);
  task.stats = buildTaskStats(task, files, known, {
    uploaded: Number(task.stats?.uploaded || 0),
    parsed: Number(task.stats?.parsed || 0),
    failed: Number(task.stats?.failed || 0),
    currentFile: ''
  });
}

async function main() {
  acquireSingleInstanceLock();
  let config = getConfig();
  config = await bindIfNeeded(config);
  const state = getState();
  console.log('Local helper is running in background.');

  while (true) {
    try {
      config = getConfig();
      config = await bindIfNeeded(config);
      const tasks = await listTasks(config);
      pruneLocalState(state, tasks);
      pruneTaskFolders(config, tasks);
      for (const task of tasks) {
        await processTask(config, state, task);
      }
    } catch (e) {
      console.error('Task polling failed:', e.message);
      if (/令牌|token|invalid|expired|过期|无效/i.test(e.message || '')) {
        console.error('Helper token is invalid. Clearing credentials and waiting for re-link...');
        config.helperToken = '';
        config.clientId = null;
        writeJson(CONFIG_PATH, config);
        removeFileQuietly(PID_PATH);
        // 不崩溃退出，继续循环等待重新链接；托盘 UI 可重新发起绑定
      }
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

main().catch(err => {
  console.error(err);
  removeFileQuietly(PID_PATH);
  process.exit(1);
});
