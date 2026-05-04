/**
 * Cloudflare Worker - 微信支付 + OCR代理
 * 部署后路由：zhenwu.fun/api/*
 * 版本: v2026050417
 */

// ========== 微信支付配置（从环境变量读取）==========
// WX_APPID: 微信公众号/小程序 AppID
// WX_MCHID: 商户号 (1684435726)
// WX_APIV3_KEY: APIv3密钥
// WX_SERIAL_NO: 商户证书序列号
// WX_PRIVATE_KEY: 商户私钥（PEM格式）

// ========== 工具函数 ==========

// 生成随机字符串
function randomString(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Base64 解码为 ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// PEM 私钥解析：去掉头尾标记和换行，Base64解码为 pkcs8 ArrayBuffer
function pemToPkcs8(pem) {
  // 替换环境变量中的字面 \n 为真实换行符
  const normalized = pem.replace(/\\n/g, '\n');
  // 去掉 -----BEGIN/END----- 和所有换行/空格
  const b64 = normalized
    .replace(/-----BEGIN[^-]*-----/, '')
    .replace(/-----END[^-]*-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// 微信支付 API v3 签名
async function generateWxSignature(method, url, timestamp, nonce, body, privateKeyPem) {
  const message = `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;

  // PEM → pkcs8 ArrayBuffer
  const pkcs8Buffer = pemToPkcs8(privateKeyPem);

  // 导入私钥（pkcs8 格式）
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // 签名
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(message)
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// 构造微信支付 Authorization 头
async function buildWxAuthHeader(method, urlPath, body, env) {
  const mchid = env.WX_MCHID;
  const serialNo = env.WX_SERIAL_NO;
  const privateKey = env.WX_PRIVATE_KEY;
  
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomString(16);
  const bodyStr = body || '';
  
  const signature = await generateWxSignature(method, urlPath, timestamp, nonce, bodyStr, privateKey);
  
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
}

// 微信支付回调通知解密
async function decryptWxNotify(encryptedData, associatedData, nonce, apiv3Key) {
  // 导入 AES-256-GCM key
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiv3Key),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  const encryptedBuffer = base64ToArrayBuffer(encryptedData);
  const iv = new TextEncoder().encode(nonce);
  const aad = new TextEncoder().encode(associatedData);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    encryptedBuffer
  );
  
  return new TextDecoder().decode(decrypted);
}

// ========== 微信支付接口 ==========

// 创建支付订单（Native 扫码支付）
async function createWxOrder(request, env) {
  try {
    const body = await request.json();
    const { phone, points, price, pkgId } = body;
    
    if (!phone || !points || !price) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    // 生成商户订单号
    const outTradeNo = `NSLG_${Date.now()}_${randomString(8)}`;
    
    // 保存订单到 KV（需要先在 Cloudflare 创建 KV namespace）
    if (env.ORDERS) {
      await env.ORDERS.put(outTradeNo, JSON.stringify({
        phone,
        points,
        price,
        pkgId,
        status: 'pending',
        createdAt: new Date().toISOString()
      }));
    }
    
    const urlPath = '/v3/pay/transactions/native';
    const requestBody = JSON.stringify({
      appid: env.WX_APPID,
      mchid: env.WX_MCHID,
      description: `积分充值-${points}积分`,
      out_trade_no: outTradeNo,
      notify_url: env.WX_NOTIFY_URL || 'https://www.zhenwu.fun/api/pay/notify',
      amount: {
        total: Math.round(price * 100), // 转换为分
        currency: 'CNY'
      }
    });
    
    const auth = await buildWxAuthHeader('POST', urlPath, requestBody, env);
    
    const resp = await fetch(`https://api.mch.weixin.qq.com${urlPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': auth,
        'User-Agent': 'Cloudflare-Workers'
      },
      body: requestBody
    });
    
    const result = await resp.json();
    
    if (!resp.ok) {
      console.error('[WX Pay] 创建订单失败:', result);
      return new Response(JSON.stringify({ error: result.message || '创建订单失败' }), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log('[WX Pay] 订单创建成功:', outTradeNo);
    
    return new Response(JSON.stringify({
      out_trade_no: outTradeNo,
      code_url: result.code_url // 微信返回的支付二维码链接
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (e) {
    console.error('[WX Pay] 创建订单异常:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 微信支付回调处理
async function handleWxNotify(request, env) {
  try {
    const body = await request.text();
    const headers = Object.fromEntries(request.headers);
    
    // 验证签名（简化版，生产环境需要完整验证）
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    const signature = headers['wechatpay-signature'];
    const serial = headers['wechatpay-serial'];
    
    // TODO: 验证签名
    // const verified = await verifyWxSignature(timestamp, nonce, body, signature, serial, env);
    
    const notifyData = JSON.parse(body);
    
    // 解密通知数据
    const decrypted = await decryptWxNotify(
      notifyData.resource.ciphertext,
      notifyData.resource.associated_data,
      notifyData.resource.nonce,
      env.WX_APIV3_KEY
    );
    
    const payment = JSON.parse(decrypted);
    console.log('[WX Pay] 支付成功:', payment);
    
    const outTradeNo = payment.out_trade_no;
    const transactionId = payment.transaction_id;
    
    // 读取订单信息
    if (env.ORDERS) {
      const orderStr = await env.ORDERS.get(outTradeNo);
      if (orderStr) {
        const order = JSON.parse(orderStr);
        
        // 更新订单状态
        order.status = 'paid';
        order.transaction_id = transactionId;
        order.paidAt = new Date().toISOString();
        await env.ORDERS.put(outTradeNo, JSON.stringify(order));
        
        // TODO: 调用前端 API 给用户加积分
        // 由于无法直接操作 IndexedDB，需要前端轮询或使用其他机制
        console.log(`[WX Pay] 订单 ${outTradeNo} 支付成功，需为用户 ${order.phone} 增加 ${order.points} 积分`);
        
        // 方案：将待加积分记录到 KV，前端轮询时读取
        const pendingKey = `pending_points_${order.phone}`;
        const existing = await env.ORDERS.get(pendingKey);
        const pending = existing ? JSON.parse(existing) : [];
        pending.push({ points: order.points, orderId: outTradeNo, time: Date.now() });
        await env.ORDERS.put(pendingKey, JSON.stringify(pending), { expirationTtl: 86400 });
      }
    }
    
    // 返回成功响应给微信
    return new Response(JSON.stringify({ code: 'SUCCESS', message: '成功' }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (e) {
    console.error('[WX Pay] 回调处理失败:', e);
    return new Response(JSON.stringify({ code: 'FAIL', message: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 查询订单状态（供前端轮询）
async function queryOrderStatus(request, env) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  
  if (!phone) {
    return new Response(JSON.stringify({ error: '缺少 phone 参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    // 读取待加积分记录
    const pendingKey = `pending_points_${phone}`;
    if (!env.ORDERS) {
      return new Response(JSON.stringify({ pending: [] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const pendingStr = await env.ORDERS.get(pendingKey);
    if (!pendingStr) {
      return new Response(JSON.stringify({ pending: [] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const pending = JSON.parse(pendingStr);
    
    // 返回待处理的积分记录，并清除已返回的
    await env.ORDERS.delete(pendingKey);
    
    return new Response(JSON.stringify({ pending }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ========== OCR 代理（保留原有功能）==========
async function handleOcrProxy(request, env) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  try {
    const body = await request.json();
    const apiKey = env.DOUBAO_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API Key not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    const model = env.DOUBAO_ENDPOINT || body.model || 'ep-m-20260426183050-krmx7';
    
    const reqBody = {
      model,
      messages: body.messages,
      max_tokens: body.max_tokens || 2000,
    };
    
    const resp = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(reqBody),
    });
    
    const result = await resp.json();
    
    return new Response(JSON.stringify(result), {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

// ========== 认证辅助函数 ==========
async function verifyUser(db, phone, password) {
  const stmt = db.prepare('SELECT * FROM cloud_users WHERE phone = ? AND password = ?');
  const result = await stmt.bind(phone, password).first();
  return result;
}

async function getUserByPhone(db, phone) {
  const stmt = db.prepare('SELECT phone, name, role, points FROM cloud_users WHERE phone = ?');
  return await stmt.bind(phone).first();
}

// ========== 项目管理 API 处理函数 ==========

// 获取项目列表（根据权限过滤）
async function handleGetProjects(request, env) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');  // 当前用户手机号
  const role = url.searchParams.get('role');    // 当前用户角色

  if (!phone) {
    return jsonResponse({ error: '缺少 phone 参数' }, 400);
  }

    try {
      let projects = [];
      if (role === 'super_admin') {
        // 超管看所有项目
        const stmt = env.DB.prepare('SELECT * FROM projects ORDER BY created_at DESC');
        const result = await stmt.all();
        projects = result.results || [];
      } else {
      // 普通用户看：公开项目 + 自己创建的 + 自己是被授权成员的
      const stmt = env.DB.prepare(`
        SELECT DISTINCT p.* FROM projects p
        LEFT JOIN project_permissions pp ON p.id = pp.project_id
        WHERE p.visibility = 'public'
           OR p.creator_phone = ?
           OR pp.phone = ?
        ORDER BY p.created_at DESC
      `);
      const result = await stmt.bind(phone, phone).all();
      projects = result.results || [];
    }

    // 解析 JSON 字段
    projects = projects.map(p => ({
      ...p,
      members: JSON.parse(p.members || '[]'),
      battle_record_ids: JSON.parse(p.battle_record_ids || '[]')
    }));

    return jsonResponse({ success: true, data: projects });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 创建项目
async function handleCreateProject(request, env) {
  try {
    const body = await request.json();
    const { id, name, desc, visibility, creator_phone } = body;

    if (!name || !creator_phone) {
      return jsonResponse({ error: '缺少必要参数' }, 400);
    }

    const projectId = id || 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const now = Date.now();

    const stmt = env.DB.prepare(`
      INSERT INTO projects (id, name, description, creator_phone, visibility, members, battle_record_ids, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    await stmt.bind(
      projectId,
      name,
      desc || '',
      creator_phone,
      visibility || 'private',
      '[]',
      '[]',
      now,
      now
    ).run();

    // 给创建者授权
    const permStmt = env.DB.prepare(`
      INSERT INTO project_permissions (id, phone, project_id, can_edit, can_delete, granted_by, granted_at)
      VALUES (?, ?, ?, 1, 1, ?, ?)
    `);
    await permStmt.bind(
      creator_phone + '_' + projectId,
      creator_phone,
      projectId,
      creator_phone,
      now
    ).run();

    return jsonResponse({ success: true, data: { id: projectId } });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 更新项目
async function handleUpdateProject(request, env, projectId) {
  try {
    const body = await request.json();
    const { name, desc, visibility } = body;
    const now = Date.now();

    const stmt = env.DB.prepare(`
      UPDATE projects
      SET name = ?, description = ?, visibility = ?, updated_at = ?
      WHERE id = ?
    `);

    await stmt.bind(name, desc || '', visibility || 'private', now, projectId).run();

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 删除项目
async function handleDeleteProject(request, env, projectId) {
  try {
    // 先删除相关的权限记录
    const delPerm = env.DB.prepare('DELETE FROM project_permissions WHERE project_id = ?');
    await delPerm.bind(projectId).run();

    // 删除项目
    const delProj = env.DB.prepare('DELETE FROM projects WHERE id = ?');
    await delProj.bind(projectId).run();

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 获取项目成员
async function handleGetProjectMembers(request, env, projectId) {
  try {
    const stmt = env.DB.prepare(`
      SELECT pp.*, cu.name FROM project_permissions pp
      LEFT JOIN cloud_users cu ON pp.phone = cu.phone
      WHERE pp.project_id = ?
    `);
    const result = await stmt.bind(projectId).all();
    const members = result.results || [];

    return jsonResponse({ success: true, data: members });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 获取某用户在所有项目中的权限
async function handleGetUserPermissions(request, env, phone) {
  try {
    const stmt = env.DB.prepare(`
      SELECT pp.* FROM project_permissions pp
      WHERE pp.phone = ?
    `);
    const result = await stmt.bind(phone).all();
    const permissions = result.results || [];

    return jsonResponse({ success: true, data: permissions });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 添加项目成员
async function handleAddProjectMember(request, env, projectId) {
  try {
    const body = await request.json();
    const { phone, can_edit, can_delete, granted_by } = body;

    if (!phone) {
      return jsonResponse({ error: '缺少 phone 参数' }, 400);
    }

    const id = phone + '_' + projectId;
    const now = Date.now();

    // 添加到权限表
    const stmt = env.DB.prepare(`
      INSERT OR REPLACE INTO project_permissions (id, phone, project_id, can_edit, can_delete, granted_by, granted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    await stmt.bind(
      id,
      phone,
      projectId,
      can_edit ? 1 : 0,
      can_delete ? 1 : 0,
      granted_by || '',
      now
    ).run();

    // 更新 projects.members 字段
    try {
      const projStmt = env.DB.prepare('SELECT members FROM projects WHERE id = ?');
      const proj = await projStmt.bind(projectId).first();
      if (proj) {
        const members = JSON.parse(proj.members || '[]');
        if (!members.includes(phone)) {
          members.push(phone);
          const updateStmt = env.DB.prepare('UPDATE projects SET members = ?, updated_at = ? WHERE id = ?');
          await updateStmt.bind(JSON.stringify(members), now, projectId).run();
        }
      }
    } catch (e) {
      console.error('[AddMember] 更新 projects.members 失败:', e);
    }

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 删除项目成员
async function handleRemoveProjectMember(request, env, projectId, phone) {
  try {
    // 从权限表删除
    const stmt = env.DB.prepare('DELETE FROM project_permissions WHERE project_id = ? AND phone = ?');
    await stmt.bind(projectId, phone).run();

    // 从 projects.members 字段移除
    try {
      const projStmt = env.DB.prepare('SELECT members FROM projects WHERE id = ?');
      const proj = await projStmt.bind(projectId).first();
      if (proj) {
        const members = JSON.parse(proj.members || '[]');
        const newMembers = members.filter(m => m !== phone);
        const updateStmt = env.DB.prepare('UPDATE projects SET members = ?, updated_at = ? WHERE id = ?');
        await updateStmt.bind(JSON.stringify(newMembers), Date.now(), projectId).run();
      }
    } catch (e) {
      console.error('[RemoveMember] 更新 projects.members 失败:', e);
    }

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ========== 战报管理 API 处理函数 ==========

// 获取战报列表
async function handleGetRecords(request, env) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');

  try {
    let stmt;
    if (projectId) {
      stmt = env.DB.prepare('SELECT * FROM records WHERE project_id = ? ORDER BY created_at DESC');
      stmt = stmt.bind(projectId);
    } else {
      stmt = env.DB.prepare('SELECT * FROM records ORDER BY created_at DESC LIMIT 1000');
    }

    const result = await stmt.all();
    const records = (result.results || []).map(r => ({
      ...r,
      data: JSON.parse(r.data || '{}')
    }));

    return jsonResponse({ success: true, data: records });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 创建战报
async function handleCreateRecord(request, env) {
  try {
    const body = await request.json();
    const { id, project_id, user_phone, data } = body;

    if (!user_phone) {
      return jsonResponse({ error: '缺少 user_phone 参数' }, 400);
    }

    const recordId = id || 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const now = Date.now();

    const stmt = env.DB.prepare(`
      INSERT INTO records (id, project_id, user_phone, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    await stmt.bind(
      recordId,
      project_id || null,
      user_phone,
      JSON.stringify(data || {}),
      now,
      now
    ).run();

    // 更新项目的 battle_record_ids
    if (project_id) {
      const projStmt = env.DB.prepare('SELECT battle_record_ids FROM projects WHERE id = ?');
      const proj = await projStmt.bind(project_id).first();

      if (proj) {
        const ids = JSON.parse(proj.battle_record_ids || '[]');
        ids.push(recordId);
        const updateStmt = env.DB.prepare('UPDATE projects SET battle_record_ids = ?, updated_at = ? WHERE id = ?');
        await updateStmt.bind(JSON.stringify(ids), now, project_id).run();
      }
    }

    return jsonResponse({ success: true, data: { id: recordId } });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 更新战报
async function handleUpdateRecord(request, env, recordId) {
  try {
    const body = await request.json();
    const { data } = body;
    const now = Date.now();

    const stmt = env.DB.prepare(`
      UPDATE records SET data = ?, updated_at = ? WHERE id = ?
    `);

    await stmt.bind(JSON.stringify(data || {}), now, recordId).run();

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 删除战报
async function handleDeleteRecord(request, env, recordId) {
  try {
    // 获取战报信息（用于从项目中移除）
    const getStmt = env.DB.prepare('SELECT project_id FROM records WHERE id = ?');
    const record = await getStmt.bind(recordId).first();

    // 从项目中移除
    if (record && record.project_id) {
      const projStmt = env.DB.prepare('SELECT battle_record_ids FROM projects WHERE id = ?');
      const proj = await projStmt.bind(record.project_id).first();

      if (proj) {
        const ids = JSON.parse(proj.battle_record_ids || '[]');
        const newIds = ids.filter(id => id!== recordId);
        const updateStmt = env.DB.prepare('UPDATE projects SET battle_record_ids = ?, updated_at = ? WHERE id = ?');
        await updateStmt.bind(JSON.stringify(newIds), Date.now(), record.project_id).run();
      }
    }

    // 删除战报
    const delStmt = env.DB.prepare('DELETE FROM records WHERE id = ?');
    await delStmt.bind(recordId).run();

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ========== 用户管理 API 处理函数 ==========

// 获取用户列表（超管）
async function handleGetUsers(request, env) {
  try {
    const stmt = env.DB.prepare('SELECT phone, name, role, points, created_at FROM cloud_users ORDER BY created_at DESC');
    const result = await stmt.all();
    const users = result.results || [];

    return jsonResponse({ success: true, data: users });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 创建用户（注册）
async function handleCreateUser(request, env) {
  try {
    const body = await request.json();
    const { phone, name, password, role } = body;

    if (!phone || !name || !password) {
      return jsonResponse({ error: '缺少必要参数' }, 400);
    }

    const now = Date.now();

    const stmt = env.DB.prepare(`
      INSERT OR IGNORE INTO cloud_users (phone, name, password, role, points, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `);

    await stmt.bind(phone, name, password, role || 'member', now, now).run();

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// 验证登录
async function handleLogin(request, env) {
  try {
    const body = await request.json();
    const { phone, password } = body;

    if (!phone || !password) {
      return jsonResponse({ error: '缺少必要参数' }, 400);
    }

    const stmt = env.DB.prepare('SELECT phone, name, role, points FROM cloud_users WHERE phone = ? AND password = ?');
    const user = await stmt.bind(phone, password).first();

    if (!user) {
      return jsonResponse({ error: '手机号或密码错误' }, 401);
    }

    return jsonResponse({ success: true, data: user });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ========== 辅助函数：统一 JSON 响应 ==========
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// ========== 角色管理 API 处理函数 ==========

// 获取角色列表（从 D1 数据库）
async function handleGetRoles(request, env) {
  try {
    const stmt = env.DB.prepare('SELECT * FROM roles ORDER BY id');
    const result = await stmt.all();
    const roles = (result.results || []).map(r => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      permissions: JSON.parse(r.permissions || '{}'),
      isBuiltIn: r.is_builtin === 1
    }));
    return jsonResponse({ success: true, data: roles });
  } catch (e) {
    // 如果表不存在，返回空数组
    if (e.message.includes('no such table')) {
      return jsonResponse({ success: true, data: [] });
    }
    // 如果缺少 description 列，执行迁移
    if (e.message.includes('no such column: description')) {
      try {
        await env.DB.exec(`ALTER TABLE roles ADD COLUMN description TEXT DEFAULT ''`);
        console.log('[Migration] 已添加 description 列到 roles 表');
        // 重试
        return handleGetRoles(request, env);
      } catch (migrateErr) {
        console.error('[Migration] 添加 description 列失败:', migrateErr);
      }
    }
    return jsonResponse({ error: e.message }, 500);
  }
}

// 保存角色（创建或更新）
async function handleSaveRole(request, env) {
  try {
    const body = await request.json();
    const { id, name, description, permissions, isBuiltIn } = body;
    
    if (!id || !name) {
      return jsonResponse({ error: '缺少必要参数' }, 400);
    }
    
    const now = Date.now();
    const permissionsStr = JSON.stringify(permissions || {});
    const isBuiltinFlag = isBuiltIn ? 1 : 0;
    
    // 尝试更新，如果不存在则插入
    const stmt = env.DB.prepare(`
      INSERT INTO roles (id, name, description, permissions, is_builtin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        permissions = excluded.permissions,
        updated_at = excluded.updated_at
    `);
    
    await stmt.bind(id, name, description || '', permissionsStr, isBuiltinFlag, now, now).run();
    
    return jsonResponse({ success: true });
  } catch (e) {
    // 如果表不存在，先创建表
    if (e.message.includes('no such table')) {
      await env.DB.exec(`
        CREATE TABLE IF NOT EXISTS roles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          permissions TEXT NOT NULL,
          is_builtin INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      // 重试
      return handleSaveRole(request, env);
    }
    // 如果缺少 description 列，执行迁移
    if (e.message.includes('no such column: description')) {
      try {
        await env.DB.exec(`ALTER TABLE roles ADD COLUMN description TEXT DEFAULT ''`);
        console.log('[Migration] 已添加 description 列到 roles 表');
        // 重试
        return handleSaveRole(request, env);
      } catch (migrateErr) {
        console.error('[Migration] 添加 description 列失败:', migrateErr);
      }
    }
    return jsonResponse({ error: e.message }, 500);
  }
}

// 删除角色（不能删除内置角色）
async function handleDeleteRole(request, env, roleId) {
  try {
    // 检查是否是内置角色
    const checkStmt = env.DB.prepare('SELECT is_builtin FROM roles WHERE id = ?');
    const role = await checkStmt.bind(roleId).first();
    
    if (role && role.is_builtin === 1) {
      return jsonResponse({ error: '不能删除内置角色' }, 400);
    }
    
    const stmt = env.DB.prepare('DELETE FROM roles WHERE id = ?');
    await stmt.bind(roleId).run();
    
    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ========== 主入口 ==========
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // 路由处理
    if (path === '/api/ocr' && request.method === 'POST') {
      return handleOcrProxy(request, env);
    }

    // ========== 项目管理 API ==========
    // 获取项目列表
    if (path === '/api/projects' && request.method === 'GET') {
      return handleGetProjects(request, env);
    }
    // 创建项目
    if (path === '/api/projects' && request.method === 'POST') {
      return handleCreateProject(request, env);
    }
    // 更新项目（使用正则匹配 /api/projects/:id）
    if (path.match(/^\/api\/projects\/[^/]+$/) && request.method === 'PUT') {
      const projectId = path.split('/')[3];
      return handleUpdateProject(request, env, projectId);
    }
    // 删除项目
    if (path.match(/^\/api\/projects\/[^/]+$/) && request.method === 'DELETE') {
      const projectId = path.split('/')[3];
      return handleDeleteProject(request, env, projectId);
    }
    // 获取项目成员
    if (path.match(/^\/api\/projects\/[^/]+\/members$/) && request.method === 'GET') {
      const projectId = path.split('/')[3];
      return handleGetProjectMembers(request, env, projectId);
    }
    // 添加项目成员
    if (path.match(/^\/api\/projects\/[^/]+\/members$/) && request.method === 'POST') {
      const projectId = path.split('/')[3];
      return handleAddProjectMember(request, env, projectId);
    }
    // 删除项目成员
    if (path.match(/^\/api\/projects\/[^/]+\/members\/[^/]+$/) && request.method === 'DELETE') {
      const parts = path.split('/');
      const projectId = parts[3];
      const phone = parts[5];
      return handleRemoveProjectMember(request, env, projectId, phone);
    }

    // ========== 战报管理 API ==========
    // 获取战报列表
    if (path === '/api/records' && request.method === 'GET') {
      return handleGetRecords(request, env);
    }
    // 创建战报
    if (path === '/api/records' && request.method === 'POST') {
      return handleCreateRecord(request, env);
    }
    // 更新战报
    if (path.match(/^\/api\/records\/[^/]+$/) && request.method === 'PUT') {
      const recordId = path.split('/')[3];
      return handleUpdateRecord(request, env, recordId);
    }
    // 删除战报
    if (path.match(/^\/api\/records\/[^/]+$/) && request.method === 'DELETE') {
      const recordId = path.split('/')[3];
      return handleDeleteRecord(request, env, recordId);
    }

    // ========== 用户管理 API ==========
    // 获取用户列表（超管）
    if (path === '/api/users' && request.method === 'GET') {
      return handleGetUsers(request, env);
    }
    // 创建用户（注册）
    if (path === '/api/users' && request.method === 'POST') {
      return handleCreateUser(request, env);
    }
    // 验证用户登录
    if (path === '/api/users/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    // 获取某用户在所有项目中的权限
    if (path.match(/^\/api\/users\/[^/]+\/permissions$/) && request.method === 'GET') {
      const phone = path.split('/')[3];
      return handleGetUserPermissions(request, env, phone);
    }
    
    // ========== 支付相关 API ==========
    if (path === '/api/pay/create' && request.method === 'POST') {
      return createWxOrder(request, env);
    }
    
    if (path === '/api/pay/notify' && request.method === 'POST') {
      return handleWxNotify(request, env);
    }
    
    if (path === '/api/pay/query' && request.method === 'GET') {
      return queryOrderStatus(request, env);
    }
    
    // ========== 角色管理 API ==========
    // 获取角色列表
    if (path === '/api/roles' && request.method === 'GET') {
      return handleGetRoles(request, env);
    }
    // 保存角色（创建或更新）
    if (path === '/api/roles' && request.method === 'POST') {
      return handleSaveRole(request, env);
    }
    // 删除角色
    if (path.match(/^\/api\/roles\/[^/]+$/) && request.method === 'DELETE') {
      const roleId = path.split('/')[3];
      return handleDeleteRole(request, env, roleId);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};
