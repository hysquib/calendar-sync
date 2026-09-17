const express = require('express');
const WebSocket = require('ws');
const logger = require('../utils/logger');
const { getBrowserManager } = require('../utils/browserManager');
const JWXTService = require('../services/jwxt');
const { getConfigManager } = require('../utils/configManager');

const router = express.Router();

// 活动的 WebSocket 连接
const wsConnections = new Map(); // pageId -> ws

/**
 * 初始化 WebSocket 服务器
 * @param {http.Server} server - HTTP 服务器实例
 */
function initWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/api/browser/ws' });

  wss.on('connection', (ws, req) => {
    // 简单的 token 验证（从 URL query 中获取）
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const pageId = url.searchParams.get('pageId');

    // 注意：实际生产中应该验证 token，这里简化处理
    // 因为 WebSocket 路径在 /api 下，且我们的 authMiddleware 是基于 cookie 的
    // 对于 WebSocket，我们依赖已经通过页面认证的用户

    logger.info('新的浏览器 WebSocket 连接', { pageId });

    wsConnections.set(pageId || 'pending', ws);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWSMessage(ws, message, pageId);
      } catch (error) {
        logger.error('处理 WebSocket 消息失败', { error: error.message });
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
      }
    });

    ws.on('close', () => {
      logger.info('浏览器 WebSocket 连接关闭', { pageId });
      // 不自动关闭页面，用户可能会重连
      for (const [pid, w] of wsConnections.entries()) {
        if (w === ws) {
          wsConnections.delete(pid);
          break;
        }
      }
    });

    ws.on('error', (error) => {
      logger.error('浏览器 WebSocket 错误', { error: error.message });
    });
  });

  logger.info('✓ 浏览器 WebSocket 服务已启动');
  return wss;
}

/**
 * 处理 WebSocket 消息
 */
async function handleWSMessage(ws, message, currentPageId) {
  const browserManager = getBrowserManager();

  switch (message.type) {
    case 'init': {
      // 创建新页面并导航到指定 URL
      const pageId = await browserManager.createPage(message.sessionId || 'default', message.url || 'about:blank');
      ws.pageId = pageId;
      wsConnections.set(pageId, ws);
      
      ws.send(JSON.stringify({
        type: 'init',
        pageId,
        url: browserManager.getCurrentUrl(pageId),
      }));
      
      // 发送初始截图
      await sendScreenshot(ws, pageId);
      break;
    }

    case 'click': {
      const pageId = message.pageId || ws.pageId;
      await browserManager.click(pageId, message.x, message.y);
      await sendScreenshot(ws, pageId);
      break;
    }

    case 'type': {
      const pageId = message.pageId || ws.pageId;
      await browserManager.type(pageId, message.text);
      await sendScreenshot(ws, pageId);
      break;
    }

    case 'keypress': {
      const pageId = message.pageId || ws.pageId;
      await browserManager.pressKey(pageId, message.key);
      await sendScreenshot(ws, pageId);
      break;
    }

    case 'navigate': {
      const pageId = message.pageId || ws.pageId;
      const result = await browserManager.navigate(pageId, message.url);
      ws.send(JSON.stringify({
        type: 'navigate',
        success: result.success,
        url: browserManager.getCurrentUrl(pageId),
        error: result.error,
      }));
      await sendScreenshot(ws, pageId);
      break;
    }

    case 'screenshot': {
      const pageId = message.pageId || ws.pageId;
      await sendScreenshot(ws, pageId);
      break;
    }

    case 'refresh': {
      const pageId = message.pageId || ws.pageId;
      const page = browserManager.getPage(pageId);
      if (page) {
        await page.reload({ waitUntil: 'networkidle2' });
      }
      await sendScreenshot(ws, pageId);
      break;
    }

    case 'getCookies': {
      const pageId = message.pageId || ws.pageId;
      const cookies = await browserManager.getCookies(pageId);
      ws.send(JSON.stringify({
        type: 'cookies',
        cookies,
      }));
      break;
    }

    case 'close': {
      const pageId = message.pageId || ws.pageId;
      await browserManager.closePage(pageId);
      ws.send(JSON.stringify({ type: 'closed' }));
      ws.close();
      break;
    }

    default:
      logger.warn('未知的 WebSocket 消息类型', { type: message.type });
  }
}

/**
 * 发送截图
 */
async function sendScreenshot(ws, pageId) {
  try {
    const browserManager = getBrowserManager();
    const screenshot = await browserManager.screenshot(pageId);
    const url = browserManager.getCurrentUrl(pageId);
    
    ws.send(JSON.stringify({
      type: 'screenshot',
      data: screenshot.toString('base64'),
      url,
      timestamp: Date.now(),
    }));
  } catch (error) {
    logger.error('发送截图失败', { error: error.message });
    ws.send(JSON.stringify({
      type: 'error',
      message: '截图失败: ' + error.message,
    }));
  }
}

// ---- REST API ----

/**
 * POST /api/browser/start
 * 启动浏览器并打开指定页面
 */
router.post('/start', async (req, res) => {
  try {
    const { url, sessionId } = req.body;
    const browserManager = getBrowserManager();
    
    const pageId = await browserManager.createPage(sessionId || 'jwxt_import', url);
    
    res.json({
      success: true,
      pageId,
      url: browserManager.getCurrentUrl(pageId),
    });
  } catch (error) {
    logger.error('启动浏览器失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/browser/:pageId/close
 * 关闭指定页面
 */
router.post('/:pageId/close', async (req, res) => {
  try {
    const browserManager = getBrowserManager();
    await browserManager.closePage(req.params.pageId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/browser/:pageId/screenshot
 * 获取截图
 */
router.get('/:pageId/screenshot', async (req, res) => {
  try {
    const browserManager = getBrowserManager();
    const screenshot = await browserManager.screenshot(req.params.pageId);
    
    res.set('Content-Type', 'image/jpeg');
    res.send(screenshot);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/browser/:pageId/click
 * 模拟点击
 */
router.post('/:pageId/click', async (req, res) => {
  try {
    const { x, y } = req.body;
    const browserManager = getBrowserManager();
    const result = await browserManager.click(req.params.pageId, x, y);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/browser/:pageId/type
 * 模拟输入
 */
router.post('/:pageId/type', async (req, res) => {
  try {
    const { text } = req.body;
    const browserManager = getBrowserManager();
    const result = await browserManager.type(req.params.pageId, text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/browser/:pageId/navigate
 * 导航到指定 URL
 */
router.post('/:pageId/navigate', async (req, res) => {
  try {
    const { url } = req.body;
    const browserManager = getBrowserManager();
    const result = await browserManager.navigate(req.params.pageId, url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/browser/:pageId/cookies
 * 获取 cookie
 */
router.get('/:pageId/cookies', async (req, res) => {
  try {
    const browserManager = getBrowserManager();
    const cookies = await browserManager.getCookies(req.params.pageId);
    res.json({ success: true, cookies });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/jwxt/save-login
 * 保存教务系统登录状态（cookie）
 */
router.post('/jwxt/save-login', async (req, res) => {
  try {
    const { pageId, baseUrl, username } = req.body;
    
    if (!pageId || !baseUrl) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    const browserManager = getBrowserManager();
    const cookies = await browserManager.getCookies(pageId);
    
    if (!cookies || cookies.length === 0) {
      return res.status(400).json({ success: false, error: '未获取到 cookie，请先登录' });
    }

    // 保存 cookie 到 JWXT 服务
    const jwxtService = new JWXTService({ baseUrl, username });
    const saved = jwxtService.saveCookies(cookies, baseUrl, username);
    
    if (saved) {
      // 同时更新配置
      const configManager = getConfigManager();
      configManager.update({
        jwxt: {
          enabled: true,
          baseUrl,
          username,
          calendarName: '课程表',
          daysAhead: 14,
        }
      }, true);
      
      // 重新加载同步服务
      const { getSyncManager } = require('../sync/sync');
      getSyncManager()._initServices();

      res.json({ success: true, message: '登录状态已保存' });
    } else {
      res.status(500).json({ success: false, error: '保存失败' });
    }
  } catch (error) {
    logger.error('保存教务系统登录失败', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/jwxt/status
 * 检查教务系统登录状态
 */
router.get('/jwxt/status', async (req, res) => {
  try {
    const configManager = getConfigManager();
    const config = configManager.getConfig();
    
    if (!config.jwxt?.enabled || !config.jwxt?.baseUrl) {
      return res.json({ success: true, loggedIn: false, enabled: false });
    }

    const jwxtService = new JWXTService(config.jwxt);
    await jwxtService.init();
    
    res.json({
      success: true,
      loggedIn: jwxtService.isLoggedIn,
      enabled: true,
      baseUrl: config.jwxt.baseUrl,
      username: config.jwxt.username,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/jwxt/test
 * 测试教务系统连接
 */
router.post('/jwxt/test', async (req, res) => {
  try {
    const configManager = getConfigManager();
    const config = configManager.getConfig();
    
    if (!config.jwxt?.enabled) {
      return res.json({ success: false, error: '教务系统未启用' });
    }

    const jwxtService = new JWXTService(config.jwxt);
    await jwxtService.init();
    const result = await jwxtService.testConnection();
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = { router, initWebSocket };
