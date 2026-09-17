const puppeteer = require('puppeteer');
const logger = require('./logger');

/**
 * 浏览器管理器
 * 管理 Puppeteer 浏览器实例，支持多页面操作
 * 用于教务系统等需要模拟浏览器登录的场景
 */
class BrowserManager {
  constructor() {
    this.browser = null;
    this.pages = new Map(); // pageId -> { page, lastUsed, sessionId }
    this.sessions = new Map(); // sessionId -> { pageId, userId, createdAt }
  }

  /**
   * 初始化浏览器
   */
  async init() {
    if (this.browser) return;

    logger.info('正在启动 Puppeteer 浏览器...');

    const launchOptions = {
      headless: 'new',
      ignoreHTTPSErrors: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--window-size=1280,800',
        '--lang=zh-CN',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--allow-running-insecure-content',
        '--disable-web-security',
      ],
      defaultViewport: {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
      },
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    try {
      this.browser = await puppeteer.launch(launchOptions);
      logger.info('✓ Puppeteer 浏览器启动成功');

      // 监听浏览器断开
      this.browser.on('disconnected', () => {
        logger.warn('Puppeteer 浏览器已断开，将重新初始化');
        this.browser = null;
        this.pages.clear();
        this.sessions.clear();
      });

    } catch (error) {
      logger.error('Puppeteer 浏览器启动失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 确保浏览器已启动
   */
  async ensureBrowser() {
    if (!this.browser) {
      await this.init();
    }
  }

  /**
   * 创建新的浏览器会话页面
   * @param {string} sessionId - 会话ID
   * @param {string} url - 初始URL
   * @returns {Promise<string>} pageId
   */
  async createPage(sessionId, url = 'about:blank') {
    await this.ensureBrowser();

    const page = await this.browser.newPage();
    
    // 设置页面级别忽略 HTTPS 错误
    const client = await page.target().createCDPSession();
    await client.send('Security.setIgnoreCertificateErrors', { ignore: true });
    
    // 设置 User-Agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 设置额外的请求头，模拟真实浏览器
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    });

    const pageId = `page_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.pages.set(pageId, {
      page,
      sessionId,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });

    if (url && url !== 'about:blank') {
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded', 
          timeout: 60000,
          referer: undefined,
        });
      } catch (error) {
        logger.warn('页面加载失败', { url, error: error.message });
      }
    }

    logger.info('创建新的浏览器页面', { pageId, sessionId, url });
    return pageId;
  }

  /**
   * 获取页面
   */
  getPage(pageId) {
    const entry = this.pages.get(pageId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.page;
    }
    return null;
  }

  /**
   * 截图
   */
  async screenshot(pageId) {
    const page = this.getPage(pageId);
    if (!page) throw new Error('页面不存在');

    try {
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 70,
        fullPage: false,
      });
      return screenshot;
    } catch (error) {
      logger.error('截图失败', { pageId, error: error.message });
      throw error;
    }
  }

  /**
   * 导航到指定URL
   */
  async navigate(pageId, url) {
    const page = this.getPage(pageId);
    if (!page) throw new Error('页面不存在');

    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
      });
      return { success: true, url: page.url() };
    } catch (error) {
      logger.warn('导航失败', { pageId, url, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 模拟点击
   */
  async click(pageId, x, y) {
    const page = this.getPage(pageId);
    if (!page) throw new Error('页面不存在');

    try {
      await page.mouse.click(x, y);
      // 等待页面稍微稳定
      await new Promise(r => setTimeout(r, 500));
      return { success: true };
    } catch (error) {
      logger.error('点击失败', { pageId, x, y, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 模拟输入文字
   */
  async type(pageId, text) {
    const page = this.getPage(pageId);
    if (!page) throw new Error('页面不存在');

    try {
      await page.keyboard.type(text, { delay: 30 });
      return { success: true };
    } catch (error) {
      logger.error('输入失败', { pageId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 模拟按键
   */
  async pressKey(pageId, key) {
    const page = this.getPage(pageId);
    if (!page) throw new Error('页面不存在');

    try {
      await page.keyboard.press(key);
      await new Promise(r => setTimeout(r, 300));
      return { success: true };
    } catch (error) {
      logger.error('按键失败', { pageId, key, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取当前页面URL
   */
  getCurrentUrl(pageId) {
    const page = this.getPage(pageId);
    if (!page) return null;
    return page.url();
  }

  /**
   * 获取页面 cookie
   */
  async getCookies(pageId) {
    const page = this.getPage(pageId);
    if (!page) throw new Error('页面不存在');

    try {
      const cookies = await page.cookies();
      return cookies;
    } catch (error) {
      logger.error('获取 cookie 失败', { pageId, error: error.message });
      return [];
    }
  }

  /**
   * 设置 cookie
   */
  async setCookies(pageId, cookies) {
    const page = this.getPage(pageId);
    if (!page) throw new Error('页面不存在');

    try {
      await page.setCookie(...cookies);
      return { success: true };
    } catch (error) {
      logger.error('设置 cookie 失败', { pageId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取页面内容（HTML）
   */
  async getContent(pageId) {
    const page = this.getPage(pageId);
    if (!page) throw new Error('页面不存在');

    try {
      return await page.content();
    } catch (error) {
      logger.error('获取页面内容失败', { pageId, error: error.message });
      return '';
    }
  }

  /**
   * 在页面中执行 JS
   */
  async evaluate(pageId, script) {
    const page = this.getPage(pageId);
    if (!page) throw new Error('页面不存在');

    try {
      return await page.evaluate(script);
    } catch (error) {
      logger.error('执行 JS 失败', { pageId, error: error.message });
      return null;
    }
  }

  /**
   * 关闭页面
   */
  async closePage(pageId) {
    const entry = this.pages.get(pageId);
    if (entry) {
      try {
        await entry.page.close();
      } catch (e) {
        // 忽略关闭错误
      }
      this.pages.delete(pageId);
      logger.info('页面已关闭', { pageId });
    }
  }

  /**
   * 清理过期页面（超过30分钟未使用）
   */
  cleanup() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30分钟

    for (const [pageId, entry] of this.pages.entries()) {
      if (now - entry.lastUsed > timeout) {
        this.closePage(pageId).catch(() => {});
      }
    }
  }

  /**
   * 关闭浏览器
   */
  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {
        // 忽略
      }
      this.browser = null;
      this.pages.clear();
      this.sessions.clear();
      logger.info('Puppeteer 浏览器已关闭');
    }
  }
}

// 单例
let instance = null;

function getBrowserManager() {
  if (!instance) {
    instance = new BrowserManager();
  }
  return instance;
}

module.exports = { BrowserManager, getBrowserManager };
