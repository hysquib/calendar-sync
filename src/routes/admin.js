const express = require('express');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getConfigManager } = require('../utils/configManager');
const { login, logout } = require('../utils/auth');
const { getSyncManager } = require('../sync/sync');
const { getScheduler } = require('../sync/scheduler');
const { getCustomService } = require('../services/custom');

const router = express.Router();

// ---- 认证相关 ----

// 登录
router.post('/auth/login', (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, error: '请输入密码' });
  }

  const result = login(password);
  if (result.success) {
    res.cookie('auth_token', result.token, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });
    res.json({ success: true, token: result.token });
  } else {
    res.status(401).json(result);
  }
});

// 登出
router.post('/auth/logout', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.cookies?.auth_token;
  logout(token);
  res.clearCookie('auth_token');
  res.json({ success: true });
});

// 修改密码
router.post('/auth/password', (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const configManager = getConfigManager();

  if (!configManager.verifyPassword(oldPassword)) {
    return res.status(400).json({ success: false, error: '原密码错误' });
  }

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, error: '新密码至少6位' });
  }

  configManager.updatePassword(newPassword);
  res.json({ success: true });
});

// ---- 配置相关 ----

// 获取配置
router.get('/config', (req, res) => {
  const configManager = getConfigManager();
  res.json({
    success: true,
    config: configManager.getPublicConfig(),
  });
});

// 更新配置
router.post('/config', (req, res) => {
  try {
    const configManager = getConfigManager();
    const newConfig = req.body;

    configManager.update(newConfig, true);

    // 重新加载同步服务
    const syncManager = getSyncManager();
    // 触发一次重新初始化
    syncManager._initServices();

    res.json({
      success: true,
      config: configManager.getPublicConfig(),
      message: '配置已保存，服务将使用新配置',
    });
  } catch (error) {
    logger.error('保存配置失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 同步相关 ----

// 获取同步状态
router.get('/sync/status', (req, res) => {
  const syncManager = getSyncManager();
  const scheduler = getScheduler();

  res.json({
    success: true,
    sync: syncManager.getStatus(),
    scheduler: scheduler.getStatus(),
  });
});

// 手动触发同步
router.post('/sync/trigger', async (req, res) => {
  try {
    const syncManager = getSyncManager();
    const result = await syncManager.syncAll();
    res.json({ success: true, result });
  } catch (error) {
    logger.error('手动同步失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// 测试连接
router.post('/sync/test', async (req, res) => {
  try {
    const syncManager = getSyncManager();
    const results = await syncManager.testConnections();
    res.json({ success: true, results });
  } catch (error) {
    logger.error('连接测试失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 自定义事件 CRUD ----

// 获取所有事件
router.get('/custom/events', (req, res) => {
  const customService = getCustomService();
  res.json({ success: true, events: customService.getEvents() });
});

// 创建事件
router.post('/custom/events', (req, res) => {
  try {
    const customService = getCustomService();
    const event = customService.createEvent(req.body);
    res.json({ success: true, event });
  } catch (error) {
    logger.error('创建事件失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新事件
router.put('/custom/events/:id', (req, res) => {
  try {
    const customService = getCustomService();
    const event = customService.updateEvent(req.params.id, req.body);
    if (!event) {
      return res.status(404).json({ success: false, error: '事件不存在' });
    }
    res.json({ success: true, event });
  } catch (error) {
    logger.error('更新事件失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除事件
router.delete('/custom/events/:id', (req, res) => {
  try {
    const customService = getCustomService();
    const deleted = customService.deleteEvent(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '事件不存在' });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('删除事件失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// 批量删除事件
router.post('/custom/events/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    const customService = getCustomService();
    let deleted = 0;
    for (const id of ids) {
      if (customService.deleteEvent(id)) deleted++;
    }
    res.json({ success: true, deleted });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 自定义待办 CRUD ----

// 获取所有待办
router.get('/custom/todos', (req, res) => {
  const customService = getCustomService();
  res.json({ success: true, todos: customService.getTodos() });
});

// 创建待办
router.post('/custom/todos', (req, res) => {
  try {
    const customService = getCustomService();
    const todo = customService.createTodo(req.body);
    res.json({ success: true, todo });
  } catch (error) {
    logger.error('创建待办失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新待办
router.put('/custom/todos/:id', (req, res) => {
  try {
    const customService = getCustomService();
    const todo = customService.updateTodo(req.params.id, req.body);
    if (!todo) {
      return res.status(404).json({ success: false, error: '待办不存在' });
    }
    res.json({ success: true, todo });
  } catch (error) {
    logger.error('更新待办失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除待办
router.delete('/custom/todos/:id', (req, res) => {
  try {
    const customService = getCustomService();
    const deleted = customService.deleteTodo(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '待办不存在' });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('删除待办失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 日志相关 ----

// 获取日志
router.get('/logs', (req, res) => {
  const { lines = 100, type = 'combined' } = req.query;
  const logDir = path.join(process.cwd(), 'logs');
  const logFile = type === 'error' ? 'error.log' : 'combined.log';
  const filePath = path.join(logDir, logFile);

  try {
    if (!fs.existsSync(filePath)) {
      return res.json({ success: true, logs: [] });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);
    const recentLines = allLines.slice(-parseInt(lines, 10));

    res.json({
      success: true,
      logs: recentLines.reverse(), // 最新的在前
    });
  } catch (error) {
    logger.error('读取日志失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// 清空日志
router.delete('/logs', (req, res) => {
  const logDir = path.join(process.cwd(), 'logs');

  try {
    ['combined.log', 'error.log'].forEach(file => {
      const filePath = path.join(logDir, file);
      if (fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf-8');
      }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
