const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const COOKIE_NAME = 'sgcp_session';
const SHORT_SESSION_SECONDS = 8 * 60 * 60;
const LONG_SESSION_SECONDS = 30 * 24 * 60 * 60;

function loadSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Configure JWT_SECRET com pelo menos 32 caracteres antes de iniciar o servidor.');
  }

  const secretPath = path.join(__dirname, '..', '.jwt-secret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {}

  const generated = crypto.randomBytes(48).toString('base64url');
  try {
    fs.writeFileSync(secretPath, generated, { flag: 'wx', mode: 0o600 });
    return generated;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
    throw new Error('O arquivo local de sessão não contém uma chave segura.');
  }
}

const secret = loadSecret();
const base64url = (value) => Buffer.from(value).toString('base64url');

function signToken(userId, lifetimeSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: String(userId), iat: now, exp: now + lifetimeSeconds }));
  const unsigned = header + '.' + payload;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return unsigned + '.' + signature;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const unsigned = parts[0] + '.' + parts[1];
  const expected = crypto.createHmac('sha256', secret).update(unsigned).digest();
  let supplied;
  try { supplied = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || !/^\d+$/.test(String(payload.sub)) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    if (pair.slice(0, index).trim() === name) return decodeURIComponent(pair.slice(index + 1).trim());
  }
  return '';
}

function setSessionCookie(res, userId, keepConnected) {
  const lifetime = keepConnected ? LONG_SESSION_SECONDS : SHORT_SESSION_SECONDS;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const cookie = COOKIE_NAME + '=' + signToken(userId, lifetime) +
    '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + lifetime + secure;
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', COOKIE_NAME + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + secure);
}

function requireAuth(req, res, next) {
  const payload = verifyToken(getCookie(req, COOKIE_NAME));
  if (!payload) {
    clearSessionCookie(res);
    return res.status(401).json({ erro: 'Faça login para continuar.' });
  }

  return db.query(
    'SELECT u.id, u.nome, u.email, u.perfil, u.paciente_id, u.ativo, pa.nome AS perfil_nome, ' +
    "COALESCE(pa.permissoes, '[]'::jsonb) AS permissoes " +
    'FROM usuarios u LEFT JOIN perfis_acesso pa ON pa.id = u.perfil_acesso_id WHERE u.id = $1',
    [payload.sub]
  ).then(({ rows }) => {
    const user = rows[0];
    if (!user || !user.ativo) {
      clearSessionCookie(res);
      return res.status(401).json({ erro: 'Esta conta não está ativa.' });
    }
    req.user = {
      id: String(user.id),
      nome: user.nome,
      email: user.email,
      perfil: user.perfil,
      perfilNome: user.perfil === 'PODOLOGA' ? 'Podóloga proprietária' :
        user.perfil === 'PACIENTE' ? 'Paciente' : (user.perfil_nome || 'Recepcionista'),
      permissoes: Array.isArray(user.permissoes) ? user.permissoes : [],
      pacienteId: user.paciente_id == null ? null : String(user.paciente_id),
    };
    return next();
  }).catch(next);
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.perfil)) {
      return res.status(403).json({ erro: 'Seu perfil não tem acesso a esta função.' });
    }
    return next();
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.user?.perfil === 'PODOLOGA' || req.user?.permissoes?.includes(permission)) return next();
    return res.status(403).json({ erro: 'Seu perfil não tem permissão para acessar este módulo.' });
  };
}

function requirePermissionOrRole(permission, role) {
  return (req, res, next) => {
    if (req.user?.perfil === 'PODOLOGA' || req.user?.perfil === role || req.user?.permissoes?.includes(permission)) return next();
    return res.status(403).json({ erro: 'Seu perfil não tem permissão para acessar este módulo.' });
  };
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch { return res.status(403).json({ erro: 'Origem da solicitação inválida.' }); }
    if (parsed.host !== req.get('host') || parsed.protocol !== req.protocol + ':') {
      return res.status(403).json({ erro: 'A solicitação veio de outra origem.' });
    }
  }
  return next();
}

module.exports = {
  COOKIE_NAME,
  SHORT_SESSION_SECONDS,
  LONG_SESSION_SECONDS,
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  allowRoles,
  requirePermission,
  requirePermissionOrRole,
  requireSameOrigin,
};
