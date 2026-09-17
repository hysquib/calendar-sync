const express = require('express');
const http = require('http');
const path = require('path');
const logger = require('./utils/logger');
const { getConfig, getConfig: _getConfig } = require('./config');
const { getScheduler } = require('./sync/scheduler');
const { getSyncManager } = require('./sync/sync');
const { authMiddleware, pageAuthMiddleware } = require('./utils/auth');
const adminRoutes = require('./routes/admin');
const { router: browserRoutes, initWebSocket } = require('./routes/browser');

const app = express();
const server = http.createServer(app);

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 简单的 cookie 解析
app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie;
  req.cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      req.cookies[name] = decodeURIComponent(value || '');
    });
  }
  next();
});

// 健康检查（不需要认证）
app.get('/health', (req, res) => {
  const syncManager = getSyncManager();
  const scheduler = getScheduler();
  const config = getConfig();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.2.0',
    scheduler: scheduler.getStatus(),
    sync: {
      isSyncing: syncManager.isSyncing,
      lastSyncTime: syncManager.lastSyncTime,
      services: {
        xiqueer: {
          enabled: config.xiqueer?.enabled || false,
          calendarName: config.xiqueer?.calendarName || '课程表',
        },
        wecom: {
          enabled: config.wecom?.enabled || false,
          calendarName: config.wecom?.calendarName || '企业待办',
        },
        custom: {
          enabled: true,
          events: syncManager.customService ? syncManager.customService.events.length : 0,
          todos: syncManager.customService ? syncManager.customService.todos.length : 0,
        },
        msGraph: {
          enabled: !!(config.msGraph?.clientId && config.msGraph?.userEmail),
          userEmail: config.msGraph?.userEmail || '',
          apiType: config.msGraph?.apiType || 'graph',
        },
      },
    },
  });
});

// 静态文件 — 只提供非 HTML 文件（CSS/JS/图片等）
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: false, // 不自动返回 index.html
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      // HTML 文件不应该通过 static 中间件返回
      res.status(404);
    }
  },
}));

// 管理后台 API（需要认证）
app.use('/api', authMiddleware, adminRoutes);
app.use('/api/browser', authMiddleware, browserRoutes);
app.use('/api/jwxt', authMiddleware, browserRoutes);

// 管理后台页面（需要认证）
const publicDir = path.join(__dirname, '..', 'public');

app.get('/', pageAuthMiddleware, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/index.html', pageAuthMiddleware, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/custom.html', pageAuthMiddleware, (req, res) => {
  res.sendFile(path.join(publicDir, 'custom.html'));
});

app.get('/jwxt.html', pageAuthMiddleware, (req, res) => {
  res.sendFile(path.join(publicDir, 'jwxt.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});

// 启动服务
function startServer() {
  const config = getConfig();
  const scheduler = getScheduler();

  // 启动定时调度
  scheduler.start();

  // 启动 HTTP 服务
  const port = config.port || 3000;
  server.listen(port, () => {
    // 初始化 WebSocket
    initWebSocket(server);
    
    logger.info('========================================');
    logger.info('  日历同步服务已启动');
    logger.info(`  端口: ${port}`);
    logger.info(`  管理后台: http://localhost:${port}/`);
    logger.info(`  健康检查: http://localhost:${port}/health`);
    logger.info(`  同步周期: ${config.syncCron}`);
    logger.info(`  时区: ${config.timezone}`);
    logger.info('========================================');

    // 打印已启用的服务
    if (config.xiqueer?.enabled) {
      logger.info(`✓ 喜鹊儿课表同步已启用 -> ${config.xiqueer.calendarName}`);
    }
    if (config.wecom?.enabled) {
      logger.info(`✓ 企业微信待办同步已启用 -> ${config.wecom.calendarName}`);
    }
    logger.info(`✓ 自定义事件同步已启用 -> 自定义事件`);
    if (!config.xiqueer?.enabled && !config.wecom?.enabled) {
      logger.warn('⚠ 仅自定义事件同步已启用，建议配置数据源');
    }

    logger.info('💡 默认管理密码: admin123');
    logger.info('💡 iOS 设备请通过「设置 → 日历 → 账户 → 添加账户 → Exchange」添加 Microsoft 365 账户');
  });

  // 优雅关闭
  process.on('SIGTERM', () => {
    logger.info('收到 SIGTERM 信号，正在关闭服务...');
    scheduler.stop();
    server.close(() => {
      logger.info('服务已关闭');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.info('收到 SIGINT 信号，正在关闭服务...');
    scheduler.stop();
    server.close(() => {
      logger.info('服务已关闭');
      process.exit(0);
    });
  });

  return server;
}

// 如果直接运行此文件，启动服务
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
