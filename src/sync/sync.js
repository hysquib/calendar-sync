const logger = require('../utils/logger');
const { getConfig } = require('../config');
const XiqueerService = require('../services/xiqueer');
const WeComTodoService = require('../services/wecom');
const MsGraphCalendarService = require('../services/graph');
const CalDAVService = require('../services/caldav');
const JWXTService = require('../services/jwxt');
const { getCustomService } = require('../services/custom');

/**
 * 同步管理器
 * 负责协调各个数据源和日历服务之间的同步
 * 支持两种同步目标：CalDAV（自建）和 Microsoft Graph
 */
class SyncManager {
  constructor() {
    this.xiqueerService = null;
    this.jwxtService = null;
    this.wecomService = null;
    this.calendarService = null; // 当前激活的日历服务 (graph 或 caldav)
    this.calendarServiceType = null; // 'caldav' | 'graph'
    this.customService = null;
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.lastSyncResult = null;

    this._initServices();
  }

  /**
   * 初始化/重新初始化服务（配置变更后调用）
   */
  _initServices() {
    const config = getConfig();

    logger.info('正在初始化同步服务...');

    // 初始化自定义事件服务（始终启用）
    this.customService = getCustomService();
    logger.info('✓ 自定义事件服务已初始化');

    // 根据 syncTarget 初始化日历服务
    const target = config.syncTarget || 'caldav';

    if (target === 'caldav' && config.caldav?.enabled) {
      this.calendarService = new CalDAVService(config.caldav);
      this.calendarServiceType = 'caldav';
      logger.info('✓ CalDAV 日历服务已初始化');
    } else if (target === 'graph' && config.msGraph?.clientId && config.msGraph?.userEmail) {
      this.calendarService = new MsGraphCalendarService(config.msGraph);
      this.calendarServiceType = 'graph';
      logger.info('✓ Microsoft Graph 日历服务已初始化');
    } else {
      // 默认启用 CalDAV（如果配置了的话）
      if (config.caldav?.enabled) {
        this.calendarService = new CalDAVService(config.caldav);
        this.calendarServiceType = 'caldav';
        logger.info('✓ CalDAV 日历服务已初始化（默认）');
      } else {
        this.calendarService = null;
        this.calendarServiceType = null;
        logger.info('- 日历服务未配置');
      }
    }

    // 初始化喜鹊儿服务
    if (config.xiqueer.enabled && config.xiqueer.username && config.xiqueer.password) {
      this.xiqueerService = new XiqueerService(config.xiqueer);
      logger.info('✓ 喜鹊儿课表服务已初始化');
    } else {
      this.xiqueerService = null;
      logger.info('- 喜鹊儿课表未配置');
    }

    // 初始化教务系统服务
    if (config.jwxt?.enabled && config.jwxt?.baseUrl) {
      this.jwxtService = new JWXTService(config.jwxt);
      this.jwxtService.init().catch(err => {
        logger.warn('教务系统初始化失败', { error: err.message });
      });
      logger.info('✓ 教务系统课表服务已初始化');
    } else {
      this.jwxtService = null;
      logger.info('- 教务系统课表未配置');
    }

    // 初始化企业微信服务
    if (config.wecom.enabled && config.wecom.corpId && config.wecom.secret) {
      this.wecomService = new WeComTodoService(config.wecom);
      logger.info('✓ 企业微信待办服务已初始化');
    } else {
      this.wecomService = null;
      logger.info('- 企业微信待办未配置');
    }
  }

  /**
   * 重新加载配置并重新初始化服务
   */
  reloadConfig() {
    this._initServices();
  }

  /**
   * 执行完整同步
   */
  async syncAll() {
    const config = getConfig();

    if (this.isSyncing) {
      logger.warn('同步正在进行中，跳过本次同步');
      return { skipped: true, reason: 'sync_in_progress' };
    }

    if (!this.calendarService) {
      logger.warn('日历服务未配置，无法同步');
      return { skipped: true, reason: 'no_calendar_service' };
    }

    this.isSyncing = true;
    const startTime = Date.now();
    const results = {};

    logger.info(`========== 开始同步 (目标: ${this.calendarServiceType}) ==========`);

    try {
      // 同步喜鹊儿课表
      if (this.xiqueerService) {
        try {
          results.xiqueer = await this.syncXiqueerSchedule();
        } catch (error) {
          logger.error('喜鹊儿课表同步失败', { error: error.message });
          results.xiqueer = { success: false, error: error.message };
        }
      } else {
        results.xiqueer = { success: false, error: '未配置' };
      }

      // 同步教务系统课表
      if (this.jwxtService) {
        try {
          results.jwxt = await this.syncJWXTSchedule();
        } catch (error) {
          logger.error('教务系统课表同步失败', { error: error.message });
          results.jwxt = { success: false, error: error.message };
        }
      } else {
        results.jwxt = { success: false, error: '未配置' };
      }

      // 同步企业微信待办
      if (this.wecomService) {
        try {
          results.wecom = await this.syncWeComTodos();
        } catch (error) {
          logger.error('企业微信待办同步失败', { error: error.message });
          results.wecom = { success: false, error: error.message };
        }
      } else {
        results.wecom = { success: false, error: '未配置' };
      }

      // 同步自定义事件和待办
      try {
        results.custom = await this.syncCustomEvents();
      } catch (error) {
        logger.error('自定义事件同步失败', { error: error.message });
        results.custom = { success: false, error: error.message };
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`========== 同步完成 (耗时 ${duration}s) ==========`);

      this.lastSyncTime = new Date().toISOString();
      this.lastSyncResult = {
        timestamp: this.lastSyncTime,
        duration: `${duration}s`,
        syncTarget: this.calendarServiceType,
        results,
      };

      return this.lastSyncResult;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 同步喜鹊儿课表
   */
  async syncXiqueerSchedule() {
    const config = getConfig();
    logger.info('--- 开始同步喜鹊儿课表 ---');

    // 获取课表数据
    const events = await this.xiqueerService.getCalendarEvents();
    logger.info(`获取到 ${events.length} 条课表事件`);

    // 同步到日历
    const syncResult = await this.calendarService.syncEvents(
      config.xiqueer.calendarName,
      events,
      'xiqueer'
    );

    logger.info('--- 喜鹊儿课表同步完成 ---');
    return syncResult;
  }

  /**
   * 同步教务系统课表
   */
  async syncJWXTSchedule() {
    const config = getConfig();
    logger.info('--- 开始同步教务系统课表 ---');

    // 先检查登录状态
    if (!this.jwxtService.isLoggedIn) {
      await this.jwxtService.init();
      if (!this.jwxtService.isLoggedIn) {
        throw new Error('教务系统未登录，请在管理后台重新登录');
      }
    }

    // 获取课表数据
    const events = await this.jwxtService.getCalendarEvents(config.jwxt.daysAhead || 14);
    logger.info(`获取到 ${events.length} 条课表事件`);

    // 同步到日历
    const syncResult = await this.calendarService.syncEvents(
      config.jwxt.calendarName || '课程表',
      events,
      'jwxt'
    );

    logger.info('--- 教务系统课表同步完成 ---');
    return syncResult;
  }

  /**
   * 同步企业微信待办
   */
  async syncWeComTodos() {
    const config = getConfig();
    logger.info('--- 开始同步企业微信待办 ---');

    // 获取待办数据
    const events = await this.wecomService.getCalendarEvents();
    logger.info(`获取到 ${events.length} 条待办事件`);

    // 同步到日历
    const syncResult = await this.calendarService.syncEvents(
      config.wecom.calendarName,
      events,
      'wecom'
    );

    logger.info('--- 企业微信待办同步完成 ---');
    return syncResult;
  }

  /**
   * 同步自定义事件和待办
   */
  async syncCustomEvents() {
    logger.info('--- 开始同步自定义事件 ---');

    // 获取自定义事件数据（包含事件和待办转换后的事件）
    const events = this.customService.getCalendarEvents();
    logger.info(`获取到 ${events.length} 条自定义事件`);

    // 同步到日历
    const syncResult = await this.calendarService.syncEvents(
      '自定义事件',
      events,
      'custom'
    );

    logger.info('--- 自定义事件同步完成 ---');
    return syncResult;
  }

  /**
   * 获取同步状态
   */
  getStatus() {
    const config = getConfig();
    return {
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      lastSyncResult: this.lastSyncResult,
      syncTarget: this.calendarServiceType,
      services: {
        xiqueer: {
          enabled: !!(config.xiqueer.enabled && config.xiqueer.username),
          calendarName: config.xiqueer.calendarName,
        },
        wecom: {
          enabled: !!(config.wecom.enabled && config.wecom.corpId),
          calendarName: config.wecom.calendarName,
          userIds: config.wecom.userIds,
        },
        custom: {
          enabled: true,
          events: this.customService ? this.customService.events.length : 0,
          todos: this.customService ? this.customService.todos.length : 0,
        },
        msGraph: {
          enabled: this.calendarServiceType === 'graph',
          userEmail: config.msGraph.userEmail,
          apiType: config.msGraph.apiType,
        },
        caldav: {
          enabled: this.calendarServiceType === 'caldav',
          serverUrl: config.caldav?.serverUrl,
          username: config.caldav?.username,
        },
      },
      syncCron: config.syncCron,
      timezone: config.timezone,
    };
  }

  /**
   * 测试所有服务连接
   */
  async testConnections() {
    const config = getConfig();
    const results = {};

    // 测试喜鹊儿
    if (config.xiqueer.username && config.xiqueer.password) {
      const service = new XiqueerService(config.xiqueer);
      results.xiqueer = await service.testConnection();
    } else {
      results.xiqueer = { success: false, error: '未配置' };
    }

    // 测试企业微信
    if (config.wecom.corpId && config.wecom.secret) {
      const service = new WeComTodoService(config.wecom);
      results.wecom = await service.testConnection();
    } else {
      results.wecom = { success: false, error: '未配置' };
    }

    // 测试日历服务
    if (this.calendarServiceType === 'caldav' && this.calendarService) {
      results.caldav = await this.calendarService.testConnection();
    } else if (this.calendarServiceType === 'graph' && this.calendarService) {
      results.msGraph = await this.calendarService.testConnection();
    } else {
      results.caldav = { success: false, error: '未配置' };
      results.msGraph = { success: false, error: '未配置' };
    }

    // 测试自定义事件服务
    results.custom = this.customService.testConnection();

    return results;
  }
}

// 单例
let instance = null;

function getSyncManager() {
  if (!instance) {
    instance = new SyncManager();
  }
  return instance;
}

module.exports = { SyncManager, getSyncManager };
