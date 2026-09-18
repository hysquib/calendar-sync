const cron = require('node-cron');
const logger = require('../utils/logger');
const { getConfig } = require('../config');
const { getSyncManager } = require('./sync');

/**
 * 定时任务调度器
 * 使用动态 getConfig() 确保配置变更后立即生效
 */
class Scheduler {
  constructor() {
    this.syncManager = getSyncManager();
    this.tasks = new Map();
    this.isRunning = false;
  }

  /**
   * 启动所有定时任务
   */
  start() {
    if (this.isRunning) {
      logger.warn('调度器已在运行中');
      return;
    }

    const config = getConfig();
    logger.info('启动定时调度器...');

    // 同步任务
    this._startSyncTask();

    this.isRunning = true;
    logger.info('定时调度器已启动', {
      syncCron: config.syncCron,
      timezone: config.timezone,
    });
  }

  /**
   * 停止所有定时任务
   */
  stop() {
    logger.info('停止定时调度器...');

    for (const [name, task] of this.tasks) {
      task.stop();
      logger.info(`已停止任务: ${name}`);
    }

    this.tasks.clear();
    this.isRunning = false;
    logger.info('定时调度器已停止');
  }

  /**
   * 启动同步任务
   */
  _startSyncTask() {
    const config = getConfig();
    const task = cron.schedule(config.syncCron, async () => {
      logger.info('定时同步任务触发');
      try {
        await this.syncManager.syncAll();
      } catch (error) {
        logger.error('定时同步任务执行失败', { error: error.message });
      }
    }, {
      timezone: config.timezone,
      scheduled: true,
    });

    this.tasks.set('sync', task);
    logger.info('同步任务已注册', { cron: config.syncCron });

    // 启动后延迟执行一次同步
    setTimeout(async () => {
      logger.info('启动后首次同步...');
      try {
        await this.syncManager.syncAll();
      } catch (error) {
        logger.error('首次同步失败', { error: error.message });
      }
    }, 5000);
  }

  /**
   * 手动触发同步
   */
  async triggerSync() {
    logger.info('手动触发同步');
    return this.syncManager.syncAll();
  }

  /**
   * 获取调度器状态
   */
  getStatus() {
    const config = getConfig();
    return {
      isRunning: this.isRunning,
      tasks: Array.from(this.tasks.keys()),
      syncCron: config.syncCron,
      timezone: config.timezone,
    };
  }
}

// 单例
let instance = null;

function getScheduler() {
  if (!instance) {
    instance = new Scheduler();
  }
  return instance;
}

module.exports = { Scheduler, getScheduler };
