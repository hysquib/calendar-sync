const axios = require('axios');
const dayjs = require('dayjs');
const logger = require('../utils/logger');

/**
 * Microsoft Graph 日历服务
 *
 * 使用 Microsoft Graph API 将事件同步到 Outlook/Exchange 日历
 * iOS 设备可通过 Exchange ActiveSync (EAS) 协议原生同步这些日历
 *
 * API 文档: https://learn.microsoft.com/en-us/graph/api/resources/event
 *
 * 认证方式：客户端凭证流 (Client Credentials Flow)
 * 需要在 Azure AD 中注册应用并授予 Calendars.ReadWrite 权限
 */
class MsGraphCalendarService {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.tenantId = config.tenantId;
    this.userEmail = config.userEmail;
    this.apiType = config.apiType || 'graph';

    // Exchange Server 配置（备用）
    this.exchangeServerUrl = config.exchangeServerUrl;
    this.exchangeUsername = config.exchangeUsername;
    this.exchangePassword = config.exchangePassword;

    this.accessToken = null;
    this.tokenExpiresAt = 0;

    this.graphApi = axios.create({
      baseURL: 'https://graph.microsoft.com/v1.0',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 缓存日历ID
    this.calendarCache = new Map();
    // 缓存事件ID（用于去重）
    this.eventCache = new Map();
  }

  /**
   * 获取 access_token (客户端凭证流)
   */
  async getAccessToken() {
    const now = Date.now();

    if (this.accessToken && now < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.accessToken;
    }

    try {
      logger.info('正在获取 Microsoft Graph access_token...');

      const tokenEndpoint = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;

      const response = await axios.post(tokenEndpoint, new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = now + response.data.expires_in * 1000;

      logger.info('Microsoft Graph access_token 获取成功');
      return this.accessToken;
    } catch (error) {
      logger.error('获取 Microsoft Graph access_token 失败', {
        error: error.message,
        response: error.response?.data,
      });
      throw new Error(`Graph API 认证失败: ${error.message}`);
    }
  }

  /**
   * 调用 Graph API（自动添加认证头）
   */
  async graphRequest(method, path, data = null, params = null) {
    const accessToken = await this.getAccessToken();

    try {
      const response = await this.graphApi.request({
        method,
        url: `/users/${this.userEmail}${path}`,
        data,
        params,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error) {
      // token 过期重试
      if (error.response?.status === 401) {
        logger.warn('Graph API token 过期，重新获取');
        this.accessToken = null;
        return this.graphRequest(method, path, data, params);
      }

      logger.error('Graph API 请求失败', {
        method,
        path,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw error;
    }
  }

  /**
   * 获取或创建指定名称的日历
   * @param {string} calendarName - 日历名称
   * @returns {string} 日历ID
   */
  async getOrCreateCalendar(calendarName) {
    if (this.calendarCache.has(calendarName)) {
      return this.calendarCache.get(calendarName);
    }

    try {
      // 列出所有日历
      const result = await this.graphRequest('GET', '/calendars', null, {
        $filter: `name eq '${calendarName}'`,
      });

      if (result.value && result.value.length > 0) {
        const calendarId = result.value[0].id;
        this.calendarCache.set(calendarName, calendarId);
        logger.info(`找到日历: ${calendarName}`);
        return calendarId;
      }

      // 创建新日历
      logger.info(`创建新日历: ${calendarName}`);
      const newCalendar = await this.graphRequest('POST', '/calendars', {
        name: calendarName,
        color: 'lightBlue',
      });

      this.calendarCache.set(calendarName, newCalendar.id);
      logger.info(`日历创建成功: ${calendarName}`);
      return newCalendar.id;
    } catch (error) {
      logger.error('获取/创建日历失败', { calendarName, error: error.message });
      throw error;
    }
  }

  /**
   * 获取指定日历中的所有事件（分页）
   * @param {string} calendarId - 日历ID
   * @param {number} daysAhead - 获取未来多少天的事件
   */
  async getCalendarEvents(calendarId, daysAhead = 30) {
    const events = [];
    const startDate = dayjs().subtract(1, 'day').format('YYYY-MM-DDTHH:mm:ss');
    const endDate = dayjs().add(daysAhead, 'day').format('YYYY-MM-DDTHH:mm:ss');

    let nextLink = `/calendars/${calendarId}/calendarView?startDateTime=${startDate}&endDateTime=${endDate}&$top=100`;

    while (nextLink) {
      try {
        const result = await this.graphRequest('GET', nextLink.replace(`/users/${this.userEmail}`, ''));

        if (result.value) {
          events.push(...result.value);
        }

        nextLink = result['@odata.nextLink'] || null;
      } catch (error) {
        logger.error('获取日历事件失败', { error: error.message });
        break;
      }
    }

    logger.info(`获取日历事件: ${events.length} 条`, { calendarId });
    return events;
  }

  /**
   * 创建日历事件
   * @param {string} calendarId - 日历ID
   * @param {Object} event - 事件数据（Microsoft Graph 格式）
   */
  async createEvent(calendarId, event) {
    try {
      const result = await this.graphRequest('POST', `/calendars/${calendarId}/events`, event);
      logger.debug('事件创建成功', { eventId: result.id, subject: event.subject });
      return result;
    } catch (error) {
      logger.error('创建事件失败', {
        subject: event.subject,
        error: error.message,
        details: error.response?.data,
      });
      throw error;
    }
  }

  /**
   * 更新日历事件
   * @param {string} calendarId - 日历ID
   * @param {string} eventId - 事件ID
   * @param {Object} event - 更新的事件数据
   */
  async updateEvent(calendarId, eventId, event) {
    try {
      const result = await this.graphRequest('PATCH', `/calendars/${calendarId}/events/${eventId}`, event);
      logger.debug('事件更新成功', { eventId, subject: event.subject });
      return result;
    } catch (error) {
      logger.error('更新事件失败', {
        eventId,
        subject: event.subject,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 删除日历事件
   * @param {string} calendarId - 日历ID
   * @param {string} eventId - 事件ID
   */
  async deleteEvent(calendarId, eventId) {
    try {
      await this.graphRequest('DELETE', `/calendars/${calendarId}/events/${eventId}`);
      logger.debug('事件删除成功', { eventId });
      return true;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn('事件不存在，跳过删除', { eventId });
        return true;
      }
      logger.error('删除事件失败', { eventId, error: error.message });
      throw error;
    }
  }

  /**
   * 同步事件到指定日历
   * 智能同步：创建新事件、更新已变更的事件、删除不存在的事件
   *
   * @param {string} calendarName - 日历名称
   * @param {Array} sourceEvents - 源事件数组（来自喜鹊儿/企业微信）
   * @param {string} sourcePrefix - 源标识前缀（用于扩展属性去重）
   * @returns {Object} 同步结果统计
   */
  async syncEvents(calendarName, sourceEvents, sourcePrefix) {
    logger.info(`开始同步日历: ${calendarName}`, { sourceEventCount: sourceEvents.length });

    const calendarId = await this.getOrCreateCalendar(calendarName);

    // 获取现有事件
    const existingEvents = await this.getCalendarEvents(calendarId, 30);

    // 构建现有事件的索引（使用单值扩展属性来标识来源）
    const existingEventMap = new Map();
    for (const event of existingEvents) {
      // 尝试从扩展属性中获取源ID
      const sourceId = this.getSourceIdFromEvent(event, sourcePrefix);
      if (sourceId) {
        existingEventMap.set(sourceId, event);
      }
    }

    logger.info(`现有同步事件: ${existingEventMap.size} 条`, { calendarName });

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let skipped = 0;
    const errors = [];

    // 处理源事件：创建或更新
    const sourceIds = new Set();

    for (const sourceEvent of sourceEvents) {
      const sourceId = sourceEvent.id;
      sourceIds.add(sourceId);

      try {
        // 添加扩展属性标识来源
        const graphEvent = this.convertToGraphEvent(sourceEvent, sourcePrefix, sourceId);

        const existingEvent = existingEventMap.get(sourceId);

        if (existingEvent) {
          // 检查是否需要更新
          if (this.needsUpdate(existingEvent, graphEvent)) {
            await this.updateEvent(calendarId, existingEvent.id, graphEvent);
            updated++;
          } else {
            skipped++;
          }
        } else {
          // 创建新事件
          await this.createEvent(calendarId, graphEvent);
          created++;
        }
      } catch (error) {
        errors.push({
          sourceId,
          subject: sourceEvent.subject,
          error: error.message,
        });
        logger.error('同步事件失败', { sourceId, subject: sourceEvent.subject, error: error.message });
      }
    }

    // 删除源中不存在的事件
    for (const [sourceId, existingEvent] of existingEventMap) {
      if (!sourceIds.has(sourceId)) {
        try {
          await this.deleteEvent(calendarId, existingEvent.id);
          deleted++;
        } catch (error) {
          errors.push({
            sourceId,
            action: 'delete',
            error: error.message,
          });
        }
      }
    }

    const result = {
      calendarName,
      total: sourceEvents.length,
      created,
      updated,
      deleted,
      skipped,
      errors: errors.length,
      errorDetails: errors,
    };

    logger.info(`日历同步完成: ${calendarName}`, result);
    return result;
  }

  /**
   * 将内部事件格式转换为 Microsoft Graph 事件格式
   */
  convertToGraphEvent(sourceEvent, sourcePrefix, sourceId) {
    const event = {
      subject: sourceEvent.subject,
      body: sourceEvent.body || {
        contentType: 'text',
        content: '',
      },
      start: sourceEvent.start,
      end: sourceEvent.end,
      location: sourceEvent.location || {
        displayName: '',
      },
      categories: sourceEvent.categories || [],
      isAllDay: sourceEvent.isAllDay || false,
      showAs: sourceEvent.showAs || 'busy',
      isCancelled: sourceEvent.isCancelled || false,
    };

    // 添加单值扩展属性用于标识来源
    event.singleValueExtendedProperties = [
      {
        // 使用自定义属性ID（在 String 范围内）
        id: 'String {00020329-0000-0000-c000-000000000046} Name CalendarSyncSourceId',
        value: `${sourcePrefix}_${sourceId}`,
      },
      {
        id: 'String {00020329-0000-0000-c000-000000000046} Name CalendarSyncSource',
        value: sourcePrefix,
      },
    ];

    if (sourceEvent.attendees && sourceEvent.attendees.length > 0) {
      event.attendees = sourceEvent.attendees;
    }

    return event;
  }

  /**
   * 从 Graph 事件中提取源ID
   */
  getSourceIdFromEvent(event, expectedSource) {
    if (!event.singleValueExtendedProperties) return null;

    let source = null;
    let sourceId = null;

    for (const prop of event.singleValueExtendedProperties) {
      if (prop.id.includes('CalendarSyncSourceId')) {
        sourceId = prop.value;
      }
      if (prop.id.includes('CalendarSyncSource')) {
        source = prop.value;
      }
    }

    if (source === expectedSource && sourceId) {
      // 去掉前缀返回
      const prefix = `${expectedSource}_`;
      if (sourceId.startsWith(prefix)) {
        return sourceId.substring(prefix.length);
      }
    }

    return null;
  }

  /**
   * 判断事件是否需要更新
   */
  needsUpdate(existingEvent, newEvent) {
    // 简单比较关键字段
    const fieldsToCheck = ['subject', 'isAllDay', 'showAs', 'isCancelled'];

    for (const field of fieldsToCheck) {
      if (existingEvent[field] !== newEvent[field]) {
        return true;
      }
    }

    // 比较时间
    if (existingEvent.start?.dateTime !== newEvent.start?.dateTime ||
        existingEvent.end?.dateTime !== newEvent.end?.dateTime) {
      return true;
    }

    // 比较地点
    if (existingEvent.location?.displayName !== newEvent.location?.displayName) {
      return true;
    }

    // 比较正文（只比较纯文本内容）
    if (existingEvent.body?.content !== newEvent.body?.content) {
      return true;
    }

    return false;
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      const token = await this.getAccessToken();
      // 尝试获取用户信息
      const user = await this.graphRequest('GET', '');
      return {
        success: true,
        userEmail: user.mail || user.userPrincipalName,
        displayName: user.displayName,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = MsGraphCalendarService;
