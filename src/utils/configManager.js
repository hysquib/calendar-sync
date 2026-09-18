const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * 配置管理器
 * 支持从文件读写配置，热更新
 */
class ConfigManager {
  constructor() {
    this.configPath = path.join(process.cwd(), 'data', 'config.json');
    this.envPath = path.join(process.cwd(), '.env');
    this.dataDir = path.join(process.cwd(), 'data');
    this.config = null;

    // 确保数据目录存在
    this._ensureDataDir();
    // 初始化配置
    this._initConfig();
  }

  _ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _initConfig() {
    // 优先从 config.json 读取
    if (fs.existsSync(this.configPath)) {
      try {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(content);
        logger.info('已从 config.json 加载配置');
        return;
      } catch (error) {
        logger.error('读取 config.json 失败，将使用环境变量', { error: error.message });
      }
    }

    // 从环境变量初始化
    this.config = this._loadFromEnv();
    this._saveConfig();
    logger.info('已从环境变量初始化配置');
  }

  _loadFromEnv() {
    return {
      // 管理密码
      adminPassword: process.env.ADMIN_PASSWORD || 'admin123',

      // 服务配置
      port: parseInt(process.env.PORT, 10) || 3000,
      syncCron: process.env.SYNC_CRON || '0 * * * *',
      timezone: process.env.TIMEZONE || 'Asia/Shanghai',

      // 喜鹊儿课表配置
      xiqueer: {
        username: process.env.XIQUEER_USERNAME || '',
        password: process.env.XIQUEER_PASSWORD || '',
        school: process.env.XIQUEER_SCHOOL || '',
        daysAhead: parseInt(process.env.XIQUEER_DAYS_AHEAD, 10) || 14,
        calendarName: process.env.XIQUEER_CALENDAR_NAME || '课程表',
        enabled: !!(process.env.XIQUEER_USERNAME && process.env.XIQUEER_PASSWORD),
      },

      // 企业微信待办配置
      wecom: {
        corpId: process.env.WECOM_CORP_ID || '',
        secret: process.env.WECOM_SECRET || '',
        agentId: process.env.WECOM_AGENT_ID || '',
        userIds: (process.env.WECOM_USER_IDS || '').split(',').filter(Boolean),
        calendarName: process.env.WECOM_CALENDAR_NAME || '企业待办',
        todoDuration: parseInt(process.env.WECOM_TODO_DURATION, 10) || 60,
        enabled: !!(process.env.WECOM_CORP_ID && process.env.WECOM_SECRET),
      },

      // Microsoft Graph 配置
      msGraph: {
        clientId: process.env.MS_GRAPH_CLIENT_ID || '',
        clientSecret: process.env.MS_GRAPH_CLIENT_SECRET || '',
        tenantId: process.env.MS_GRAPH_TENANT_ID || '',
        userEmail: process.env.MS_GRAPH_USER_EMAIL || '',
        apiType: process.env.MS_GRAPH_API_TYPE || 'graph',
        exchangeServerUrl: process.env.EXCHANGE_SERVER_URL || '',
        exchangeUsername: process.env.EXCHANGE_USERNAME || '',
        exchangePassword: process.env.EXCHANGE_PASSWORD || '',
      },

      // CalDAV 配置
      caldav: {
        enabled: process.env.CALDAV_ENABLED === 'true' || false,
        serverUrl: process.env.CALDAV_SERVER_URL || 'http://radicale:5232/',
        username: process.env.CALDAV_USERNAME || 'admin',
        password: process.env.CALDAV_PASSWORD || 'admin123',
        defaultCalendar: process.env.CALDAV_DEFAULT_CALENDAR || 'calendar',
      },

      // 教务系统配置（青果 KINGOSOFT）
      jwxt: {
        enabled: false,
        baseUrl: process.env.JWXT_BASE_URL || '',
        username: process.env.JWXT_USERNAME || '',
        calendarName: process.env.JWXT_CALENDAR_NAME || '课程表',
        daysAhead: parseInt(process.env.JWXT_DAYS_AHEAD, 10) || 14,
        semesterStart: process.env.JWXT_SEMESTER_START || '2026-09-07',
      },

      // 同步目标配置
      syncTarget: process.env.SYNC_TARGET || 'caldav', // 'caldav' 或 'graph'
    };
  }

  _saveConfig() {
    try {
      this._ensureDataDir();
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        'utf-8'
      );
      return true;
    } catch (error) {
      logger.error('保存配置失败', { error: error.message });
      return false;
    }
  }

  /**
   * 获取全部配置
   */
  getAll() {
    return this.config;
  }

  /**
   * 获取配置（getAll 的别名）
   */
  getConfig() {
    return this.config;
  }

  /**
   * 获取数据目录路径
   */
  getDataDir() {
    return this.dataDir;
  }

  /**
   * 获取配置（不含敏感信息，用于前端展示）
   */
  getPublicConfig() {
    const config = JSON.parse(JSON.stringify(this.config));

    // 隐藏敏感字段（显示前4后2位，中间用固定4个*代替）
    // 固定使用 **** 确保与 _deepMerge 中的 includes('****') 检测匹配
    const mask = (str) => {
      if (!str) return '';
      if (str.length <= 8) return '********';
      return str.substring(0, 4) + '****' + str.substring(str.length - 2);
    };

    if (config.xiqueer) {
      config.xiqueer.password = config.xiqueer.password ? mask(config.xiqueer.password) : '';
    }
    if (config.wecom) {
      config.wecom.secret = config.wecom.secret ? mask(config.wecom.secret) : '';
    }
    if (config.msGraph) {
      config.msGraph.clientSecret = config.msGraph.clientSecret ? mask(config.msGraph.clientSecret) : '';
      config.msGraph.exchangePassword = config.msGraph.exchangePassword ? mask(config.msGraph.exchangePassword) : '';
    }
    if (config.caldav) {
      config.caldav.password = config.caldav.password ? mask(config.caldav.password) : '';
    }

    config.adminPassword = config.adminPassword ? mask(config.adminPassword) : '';

    return config;
  }

  /**
   * 更新配置
   * @param {Object} newConfig - 新的配置
   * @param {boolean} partial - 是否为部分更新
   */
  update(newConfig, partial = true) {
    if (partial) {
      // 深度合并
      this._deepMerge(this.config, newConfig);
    } else {
      this.config = { ...this.config, ...newConfig };
    }

    // 更新 enabled 状态
    if (this.config.xiqueer) {
      this.config.xiqueer.enabled = !!(this.config.xiqueer.username && this.config.xiqueer.password);
    }
    if (this.config.wecom) {
      this.config.wecom.enabled = !!(this.config.wecom.corpId && this.config.wecom.secret);
    }
    if (this.config.jwxt) {
      this.config.jwxt.enabled = !!(this.config.jwxt.baseUrl);
    }
    if (this.config.caldav) {
      this.config.caldav.enabled = !!(this.config.caldav.serverUrl && this.config.caldav.username);
    }

    // userIds 可能是字符串，转成数组
    if (this.config.wecom && typeof this.config.wecom.userIds === 'string') {
      this.config.wecom.userIds = this.config.wecom.userIds
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }

    this._saveConfig();
    logger.info('配置已更新');

    return this.config;
  }

  /**
   * 更新管理密码
   */
  updatePassword(newPassword) {
    this.config.adminPassword = newPassword;
    this._saveConfig();
    logger.info('管理密码已更新');
    return true;
  }

  /**
   * 验证密码
   */
  verifyPassword(password) {
    return password === this.config.adminPassword;
  }

  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object'
      ) {
        this._deepMerge(target[key], source[key]);
      } else {
        // 跳过掩码值（包含****的表示没有修改）
        if (typeof source[key] === 'string' && source[key].includes('****')) {
          // 不更新
        } else {
          target[key] = source[key];
        }
      }
    }
  }
}

// 单例
let instance = null;

function getConfigManager() {
  if (!instance) {
    instance = new ConfigManager();
  }
  return instance;
}

module.exports = { ConfigManager, getConfigManager };
