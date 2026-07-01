/**
 * SMClick Server — Pizzinatto
 * Serve o dashboard.html + proxy para o SMClick
 * Deploy: Render.com (Web Service, Node)
 */
const http  = require('http');
const https = require('https');
const url   = require('url');
const fs    = require('fs');
const path  = require('path');

const PORT      = process.env.PORT || 3456;
const BASE_V2   = 'https://back.smclick.com.br/v1/api/attendances/managerial/v2';
const LOGIN_URL = 'https://back.smclick.com.br/v1/api/clients/auth/login/';

// Credenciais via variáveis de ambiente (configuradas no Render)
// ou via /setcredentials no dashboard
const CREDENTIALS = {
  email:    process.env.SMCLICK_EMAIL    || '',
  password: process.env.SMCLICK_PASSWORD || '',
};

let BEARER     = '';
let tokenExpAt = 0;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function httpsGet(targetUrl, headers) {
  return new Promise((resolve, reject) => {
    const opts   = url.parse(targetUrl);
    opts.headers = headers;
    opts.timeout = 15000;
    const req = https.get(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function httpsPost(targetUrl, postData, headers = {}) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(postData);
    const parsed = url.parse(targetUrl);
    const opts   = {
      hostname: parsed.hostname,
      path:     parsed.path,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
      timeout:  15000,
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function autoLogin() {
  if (!CREDENTIALS.email || !CREDENTIALS.password) return false;
  console.log(`[auth] Login como ${CREDENTIALS.email}...`);
  try {
    const res  = await httpsPost(LOGIN_URL, { email: CREDENTIALS.email, passwd: CREDENTIALS.password });
    console.log(`[auth] → ${res.status}: ${res.body.substring(0, 200)}`);
    if (res.status === 200 || res.status === 201) {
      const data  = JSON.parse(res.body);
      const token = data.access_token ?? data.access ?? data.token ?? data.data?.access;
      if (token) {
        BEARER = token;
        try {
          const pay  = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
          tokenExpAt = pay.exp * 1000;
        } catch(e) { tokenExpAt = Date.now() + 24 * 60 * 60 * 1000; }
        console.log(`[auth] ✓ Token obtido! Expira: ${new Date(tokenExpAt).toLocaleString('pt-BR')}`);
        return true;
      }
    }
  } catch(e) { console.log(`[auth] Erro: ${e.message}`); }
  return false;
}

// Renovar 30min antes de expirar
setInterval(async () => {
  if (CREDENTIALS.email && BEARER && Date.now() > tokenExpAt - 30 * 60 * 1000) {
    console.log('[auth] Renovando token...');
    await autoLogin();
  }
}, 5 * 60 * 1000);

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS); res.end(); return;
  }

  const parsed  = url.parse(req.url, true);
  const reqPath = parsed.pathname || '/';

  // Servir tv.html
  if (reqPath === '/tv' || reqPath === '/tv.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'tv.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch(e) { res.writeHead(404); res.end('tv.html not found'); }
    return;
  }

  // Servir o dashboard.html na raiz
  if (reqPath === '/' || reqPath === '/dashboard.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
      // Injeta a URL do proxy dinamicamente (no Render é a própria URL do serviço)
      const adapted = html.replace(
        "const PROXY    = 'http://localhost:3456/proxy';",
        "const PROXY    = window.location.origin + '/proxy';"
      );
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(adapted);
    } catch(e) {
      res.writeHead(404); res.end('dashboard.html not found');
    }
    return;
  }

  const jsonHeaders = { ...CORS, 'Content-Type': 'application/json' };

  if (reqPath === '/setcredentials' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { email, password } = JSON.parse(body);
        CREDENTIALS.email    = email;
        CREDENTIALS.password = password;
        const ok = await autoLogin();
        res.writeHead(200, jsonHeaders);
        res.end(JSON.stringify({ ok }));
      } catch(e) {
        res.writeHead(400, jsonHeaders);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (reqPath === '/settoken') {
    const t = parsed.query.token;
    if (t) {
      BEARER = t;
      try { const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()); tokenExpAt = p.exp * 1000; } catch(e) {}
    }
    res.writeHead(200, jsonHeaders); res.end(JSON.stringify({ ok: true })); return;
  }

  if (reqPath === '/status') {
    res.writeHead(200, jsonHeaders);
    res.end(JSON.stringify({
      ok:             !!BEARER,
      tokenExpiresAt: BEARER ? new Date(tokenExpAt).toLocaleString('pt-BR') : null,
      hasCredentials: !!(CREDENTIALS.email && CREDENTIALS.password),
      minsLeft:       BEARER ? Math.round((tokenExpAt - Date.now()) / 60000) : 0,
    }));
    return;
  }

  // Rota de debug: mostra resposta crua da API para descobrir parâmetros de data
  if (reqPath === '/debug') {
    if (!BEARER) { res.writeHead(401, jsonHeaders); res.end(JSON.stringify({ error: 'Sem token' })); return; }
    const hoje = new Date().toISOString().slice(0, 10);
    const testes = [
      '/chats/metrics/?status=finished',
      `/chats/metrics/?status=finished&date=${hoje}`,
      `/chats/metrics/?status=finished&start_date=${hoje}&end_date=${hoje}`,
      `/chats/metrics/?status=finished&filter_date=${hoje}`,
      `/chats/metrics/?status=finished&created_at=${hoje}`,
      '/chats/metrics/?status=closed',
      `/chats/metrics/?status=closed&date=${hoje}`,
    ];
    const resultados = {};
    for (const qs of testes) {
      try {
        const r = await httpsGet(BASE_V2 + qs, { 'Authorization': `Bearer ${BEARER}`, 'Accept': 'application/json' });
        let parsed;
        try { parsed = JSON.parse(r.body); } catch(e) { parsed = { raw: r.body.substring(0, 300) }; }
        // Mostra só os attendants para não poluir
        resultados[qs] = {
          status: r.status,
          attendant: parsed?.data?.attendant ?? parsed?.attendant ?? '(não encontrado)',
          keys_data: parsed?.data ? Object.keys(parsed.data) : '(sem data)',
        };
      } catch(e) { resultados[qs] = { erro: e.message }; }
    }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hoje, resultados }, null, 2));
    return;
  }

  if (!reqPath.startsWith('/proxy')) {
    res.writeHead(404, jsonHeaders); res.end(JSON.stringify({ error: 'Not found' })); return;
  }

  if (!BEARER) {
    res.writeHead(401, jsonHeaders); res.end(JSON.stringify({ __noToken: true })); return;
  }

  const qs      = url.parse(req.url).search || '';
  const apiPath = reqPath.replace(/^\/proxy/, '') || '/';
  const target  = BASE_V2 + apiPath + qs;

  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] → ${target}`);

  try {
    const result = await httpsGet(target, {
      'Authorization': `Bearer ${BEARER}`,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
    });

    const isHtml = result.body.trim().startsWith('<');
    console.log(`    ← ${result.status}  ${result.body.length}b`);

    if (result.status === 401) {
      const ok = await autoLogin();
      if (!ok) { res.writeHead(401, jsonHeaders); res.end(JSON.stringify({ __tokenExpired: true })); return; }
      const retry = await httpsGet(target, { 'Authorization': `Bearer ${BEARER}`, 'Accept': 'application/json' });
      res.writeHead(retry.status, { ...CORS, 'Content-Type': 'application/json' });
      res.end(retry.body.trim().startsWith('<') ? JSON.stringify({ __isHtml: true }) : retry.body);
      return;
    }

    res.writeHead(result.status, { ...CORS, 'Content-Type': 'application/json' });
    res.end(isHtml ? JSON.stringify({ __isHtml: true }) : result.body);
  } catch(e) {
    console.error(`ERR: ${e.message}`);
    res.writeHead(502, jsonHeaders); res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, async () => {
  console.log(`\n✓ Pizzinatto Dashboard rodando na porta ${PORT}`);
  if (CREDENTIALS.email) await autoLogin();
  else console.log('  Configure SMCLICK_EMAIL e SMCLICK_PASSWORD no Render, ou use ⚙ Login no dashboard.\n');
});
