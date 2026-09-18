const express = require('express');
const router = express.Router();
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { verifyToken } = require('../utils/auth');
const { getConfigManager } = require('../utils/configManager');
const JWXTService = require('../services/jwxt');

// CORS 中间件 — 允许从教务系统页面跨域请求
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

/**
 * POST /api/jwxt-import/schedule
 * 接收从本地浏览器（教务系统页面）发来的课表 HTML 和 cookie
 * 
 * Body:
 *   - token: 管理后台认证 token
 *   - html: 课表页面的 HTML
 *   - cookies: 页面 cookie 字符串
 *   - url: 当前页面 URL
 *   - baseUrl: 教务系统根地址
 *   - username: 学号
 */
router.post('/schedule', async (req, res) => {
  try {
    const { token, html, cookies, url, baseUrl, username, semesterStart } = req.body;

    // 验证 token
    if (!token || !verifyToken(token)) {
      return res.status(401).json({ success: false, error: '认证失败，请重新从管理后台获取代码' });
    }

    if (!html) {
      return res.status(400).json({ success: false, error: '未收到页面内容' });
    }

    logger.info('收到教务系统课表导入请求', { url, htmlLength: html.length, isMHTML: html.includes('MIME-Version') });

    // 解析课表 HTML
    const jwxtService = new JWXTService({ baseUrl: baseUrl || '', username: username || '', semesterStart: semesterStart || '2026-09-07' });
    const courses = jwxtService.parseScheduleHTML(html);

    // 转换为日历事件
    const events = courses.map(c => jwxtService.courseToEvent(c));

    // 保存导入的课表数据到文件（供后续同步使用，不依赖教务系统连接）
    try {
      const configManager = getConfigManager();
      const dataDir = configManager.getDataDir();
      const scheduleFile = path.join(dataDir, 'jwxt-schedule-cache.json');
      fs.writeFileSync(scheduleFile, JSON.stringify({
        baseUrl: baseUrl || '',
        username: username || '',
        semesterStart: semesterStart || '2026-09-07',
        importedAt: new Date().toISOString(),
        courses: courses,
        events: events,
      }, null, 2), 'utf-8');
      logger.info(`课表缓存已保存到 ${scheduleFile}，共 ${events.length} 个事件`);
    } catch (cacheError) {
      logger.warn('保存课表缓存失败', { error: cacheError.message });
    }

    // 解析 cookie 字符串为 cookie 对象数组
    let cookieArr = [];
    if (cookies) {
      cookieArr = cookies.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return { name: name.trim(), value: rest.join('=').trim(), domain: new URL(url).hostname };
      }).filter(c => c.name);
    }

    // 保存 cookie（供后续同步使用）
    if (cookieArr.length > 0 && baseUrl) {
      jwxtService.saveCookies(cookieArr, baseUrl, username || '');
    }

    // 始终更新配置并启用教务系统同步（不依赖 cookie，缓存数据已保存）
    try {
      const configManager = getConfigManager();
      configManager.update({
        jwxt: {
          enabled: true,
          baseUrl: baseUrl || '',
          username: username || '',
          calendarName: '课程表',
          daysAhead: 14,
        }
      }, true);

      // 重新加载同步服务
      try {
        const { getSyncManager } = require('../sync/sync');
        getSyncManager()._initServices();
      } catch (e) {
        logger.warn('重新加载同步服务失败', { error: e.message });
      }
    } catch (configErr) {
      logger.warn('更新教务系统配置失败', { error: configErr.message });
    }

    logger.info(`课表导入完成，共 ${courses.length} 节课，${events.length} 个事件`);

    res.json({
      success: true,
      coursesFound: courses.length,
      eventsCreated: events.length,
      courses: courses.map(c => ({
        name: c.course_name,
        date: c.date,
        teacher: c.teacher,
        classroom: c.classroom,
      })),
      cookieSaved: cookieArr.length > 0,
    });
  } catch (error) {
    logger.error('教务系统课表导入失败', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/jwxt-import/snippet
 * 获取要粘贴到教务系统控制台的 JS 代码
 * 
 * Query:
 *   - token: 管理后台认证 token
 *   - baseUrl: 教务系统根地址
 *   - username: 学号
 */
router.get('/snippet', async (req, res) => {
  try {
    const { token, baseUrl, username, semesterStart } = req.query;

    if (!token || !verifyToken(token)) {
      return res.status(401).json({ success: false, error: '认证失败' });
    }

    // 构造服务器地址（从请求头获取）
    const protocol = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
    const host = req.headers.host || 'localhost:3000';
    const serverUrl = `${protocol}://${host}`;

    const ss = semesterStart || '2026-09-07';

    const snippet = `(function(){
  var html = document.documentElement.outerHTML;
  var cookies = document.cookie;
  var data = {
    token: '${token}',
    html: html,
    cookies: cookies,
    url: window.location.href,
    baseUrl: '${baseUrl || ''}',
    username: '${username || ''}',
    semesterStart: '${ss}'
  };
  fetch('${serverUrl}/api/jwxt-import/schedule', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  }).then(function(r){return r.json();}).then(function(d){
    if (d.success) {
      alert('课表导入成功!\\n共发现 ' + d.coursesFound + ' 节课, 已创建 ' + d.eventsCreated + ' 个日历事件\\n\\n课程列表:\\n' + (d.courses||[]).slice(0,10).map(function(c){return c.date + ' ' + c.name;}).join('\\n') + (d.coursesFound>10?'\\n...':''));
    } else {
      alert('导入失败: ' + (d.error || '未知错误'));
    }
  }).catch(function(e){alert('网络错误: ' + e.message);});
})();`;

    res.json({ success: true, snippet, serverUrl });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
