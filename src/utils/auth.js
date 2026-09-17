const crypto = require('crypto');
const { getConfigManager } = require('./configManager');
const logger = require('./logger');

// 简单的 token 存储（内存）
const tokens = new Map();

/**
 * 生成登录 token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 验证登录
 */
function login(password) {
  const configManager = getConfigManager();

  if (configManager.verifyPassword(password)) {
    const token = generateToken();
    // token 有效期 24 小时
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    tokens.set(token, expiresAt);
    logger.info('管理员登录成功');
    return { success: true, token, expiresAt };
  }

  logger.warn('管理员登录失败，密码错误');
  return { success: false, error: '密码错误' };
}

/**
 * 登出
 */
function logout(token) {
  tokens.delete(token);
  return { success: true };
}

/**
 * 验证 token
 */
function verifyToken(token) {
  if (!token) return false;

  const expiresAt = tokens.get(token);
  if (!expiresAt) return false;

  if (Date.now() > expiresAt) {
    tokens.delete(token);
    return false;
  }

  return true;
}

/**
 * Express 认证中间件（API专用）
 * 用于 /api 路由下的认证
 */
function authMiddleware(req, res, next) {
  // 登录接口跳过认证
  if (req.path === '/auth/login' || req.path === '/auth/login/') {
    return next();
  }

  // 从 header 或 cookie 获取 token
  const token = req.headers['authorization']?.replace('Bearer ', '') ||
                req.cookies?.auth_token ||
                req.query.token;

  if (verifyToken(token)) {
    req.authToken = token;
    next();
  } else {
    res.status(401).json({ success: false, error: '未登录或登录已过期' });
  }
}

/**
 * 页面认证中间件
 * 用于管理后台页面的认证
 */
function pageAuthMiddleware(req, res, next) {
  // 登录页和静态资源跳过
  const path = req.path;
  if (path === '/login.html' || path.startsWith('/login')) {
    return next();
  }
  if (path.match(/\.(css|js|png|jpg|svg|ico|woff2?)$/)) {
    return next();
  }

  const token = req.cookies?.auth_token || req.query.token;

  if (verifyToken(token)) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

module.exports = {
  login,
  logout,
  verifyToken,
  authMiddleware,
  pageAuthMiddleware,
};
