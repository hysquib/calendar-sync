const axios = require('axios');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * CalDAV 日历服务
 * 支持将事件同步到任何兼容 CalDAV 协议的服务器（如 Radicale、Nextcloud、Baïkal 等）
 * iOS 日历原生支持 CalDAV，直接添加账户即可同步
 *
 * API 参考：RFC 4791 (CalDAV), RFC 5545 (iCalendar)
 */
class CalDAVService {
  constructor(config) {
    this.serverUrl = config.serverUrl || 'http://radicale:5232/';
    this.username = config.username || 'admin';
    this.password = config.password || 'admin123';
    this.defaultCalendar = config.defaultCalendar || 'calendar';

    this.api = axios.create({
      baseURL: this.serverUrl,
      timeout: 30000,
      auth: {
        username: this.username,
        password: this.password,
      },
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
      },
    });
  }

  /**
   * 确保日历集合存在，不存在则创建
   */
  async ensureCalendar(calendarName) {
    const calendarUrl = `${this.username}/${this._sanitizeName(calendarName)}/`;

    try {
      // 先检查是否存在
      await this.api.request({
        method: 'PROPFIND',
        url: calendarUrl,
        headers: { Depth: '0' },
      });
      logger.info(`CalDAV 日历已存在: ${calendarName}`);
      return calendarUrl;
    } catch (error) {
      if (error.response?.status === 404) {
        // 创建日历集合
        logger.info(`创建 CalDAV 日历: ${calendarName}`);
        await this.api.request({
          method: 'MKCALENDAR',
          url: calendarUrl,
          headers: { 'Content-Type': 'application/xml' },
          data: `<?xml version="1.0" encoding="UTF-8" ?>
<D:mkcalendar xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>${calendarName}</D:displayname>
      <calendar-description xmlns="urn:ietf:params:xml:ns:caldav">${calendarName}</calendar-description>
    </D:prop>
  </D:set>
</D:mkcalendar>`,
        });
        logger.info(`CalDAV 日历创建成功: ${calendarName}`);
        return calendarUrl;
      }
      throw error;
    }
  }

  /**
   * 获取指定日历中的所有事件
   */
  async getAllEvents(calendarUrl) {
    try {
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

      const response = await this.api.request({
        method: 'REPORT',
        url: calendarUrl,
        headers: { Depth: '1' },
        data: body,
      });

      return this._parseCalendarReport(response.data);
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`CalDAV 日历不存在: ${calendarUrl}`);
        return [];
      }
      logger.error('获取 CalDAV 事件失败', { error: error.message });
      return [];
    }
  }

  /**
   * 创建或更新事件
   */
  async putEvent(calendarUrl, event) {
    const uid = event.id;
    const ics = this._eventToICS(event, uid);
    const url = `${calendarUrl}${uid}.ics`;

    try {
      await this.api.request({
        method: 'PUT',
        url: url,
        data: ics,
      });
      return true;
    } catch (error) {
      logger.error('CalDAV 写入事件失败', {
        uid,
        subject: event.subject,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 删除事件
   */
  async deleteEvent(calendarUrl, uid) {
    const url = `${calendarUrl}${uid}.ics`;

    try {
      await this.api.request({
        method: 'DELETE',
        url: url,
      });
      return true;
    } catch (error) {
      if (error.response?.status === 404) {
        return true;
      }
      logger.error('CalDAV 删除事件失败', { uid, error: error.message });
      throw error;
    }
  }

  /**
   * 同步事件到 CalDAV 日历
   */
  async syncEvents(calendarName, sourceEvents, sourcePrefix) {
    logger.info(`开始同步 CalDAV 日历: ${calendarName}`, { count: sourceEvents.length });

    const calendarUrl = await this.ensureCalendar(calendarName);

    // 获取现有事件
    const existingEvents = await this.getAllEvents(calendarUrl);
    const existingMap = new Map();
    for (const evt of existingEvents) {
      const sourceId = this._extractSourceId(evt.ics, sourcePrefix);
      if (sourceId) existingMap.set(sourceId, evt);
    }

    logger.info(`现有 CalDAV 事件: ${existingMap.size} 条`, { calendarName });

    let created = 0, updated = 0, deleted = 0, skipped = 0;
    const errors = [];
    const sourceIds = new Set();

    for (const src of sourceEvents) {
      const sid = src.id;
      sourceIds.add(sid);

      try {
        const existing = existingMap.get(sid);

        if (existing) {
          // 检查是否需要更新（简化：始终更新以确保数据一致）
          await this.putEvent(calendarUrl, { ...src, sourcePrefix });
          updated++;
        } else {
          await this.putEvent(calendarUrl, { ...src, sourcePrefix });
          created++;
        }
      } catch (error) {
        errors.push({ sourceId: sid, subject: src.subject, error: error.message });
      }
    }

    // 删除源中不存在的事件
    for (const [sid, evt] of existingMap) {
      if (!sourceIds.has(sid)) {
        try {
          await this.deleteEvent(calendarUrl, evt.uid);
          deleted++;
        } catch (error) {
          errors.push({ sourceId: sid, action: 'delete', error: error.message });
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

    logger.info(`CalDAV 同步完成: ${calendarName}`, result);
    return result;
  }

  /**
   * 将事件转换为 iCalendar (ICS) 格式
   */
  _eventToICS(event, uid) {
    const start = event.start?.dateTime || event.start?.date;
    const end = event.end?.dateTime || event.end?.date;
    const allDay = event.isAllDay || false;

    const formatDT = (dt, isAllDay) => {
      if (!dt) return '';
      const d = new Date(dt);
      if (isAllDay) {
        return dayjs(d).format('YYYYMMDD');
      }
      // 使用 floating local time（不带 Z 后缀）
      // iOS/CalDAV 客户端会按本地时区解析，避免 UTC 偏移问题
      return dayjs(d).format('YYYYMMDDTHHmmss');
    };

    const dtStamp = dayjs().utc().format('YYYYMMDDTHHmmss') + 'Z';
    const dtStart = formatDT(start, allDay);
    const dtEnd = formatDT(end, allDay);

    const description = (event.body?.content || '')
      .replace(/\r/g, '')
      .replace(/\n/g, '\\n');

    const location = event.location?.displayName || '';
    const subject = event.subject || '无标题';
    const categories = (event.categories || []).join(',');

    // 在描述中添加来源标识（用于增量同步识别）
    const sourceMarker = `X-CALSYNC-SOURCE: ${event.sourcePrefix || 'unknown'}`;
    const sourceIdMarker = `X-CALSYNC-ID: ${uid}`;

    const status = event.isCancelled ? 'CANCELLED' : 'CONFIRMED';
    const transp = event.showAs === 'free' ? 'TRANSPARENT' : 'OPAQUE';

    return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Calendar Sync Service//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${dtStamp}
DTSTART${allDay ? ';VALUE=DATE' : ''}:${dtStart}
DTEND${allDay ? ';VALUE=DATE' : ''}:${dtEnd}
SUMMARY:${subject}
DESCRIPTION:${description}
LOCATION:${location}
CATEGORIES:${categories}
STATUS:${status}
TRANSP:${transp}
${sourceMarker}
${sourceIdMarker}
END:VEVENT
END:VCALENDAR
`;
  }

  /**
   * 解析 CalDAV REPORT 返回的 XML，提取事件
   */
  _parseCalendarReport(xmlData) {
    const events = [];
    if (!xmlData) return events;

    // 简单的正则解析（对于 Radicale 输出足够）
    const responseRegex = /<D:response>([\s\S]*?)<\/D:response>/g;
    const hrefRegex = /<D:href>(.*?)<\/D:href>/;
    const icsRegex = /<C:calendar-data>([\s\S]*?)<\/C:calendar-data>/;
    const etagRegex = /<D:getetag>(.*?)<\/D:getetag>/;

    let match;
    while ((match = responseRegex.exec(xmlData)) !== null) {
      const responseXml = match[1];
      const hrefMatch = responseXml.match(hrefRegex);
      const icsMatch = responseXml.match(icsRegex);
      const etagMatch = responseXml.match(etagRegex);

      if (hrefMatch && icsMatch) {
        const href = hrefMatch[1];
        const ics = icsMatch[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        const uid = href.split('/').pop().replace('.ics', '');
        const etag = etagMatch ? etagMatch[1] : null;

        events.push({ uid, href, ics, etag });
      }
    }

    return events;
  }

  /**
   * 从 ICS 内容中提取同步源 ID
   */
  _extractSourceId(ics, expectedSource) {
    const sourceMatch = ics.match(/X-CALSYNC-SOURCE:\s*(\S+)/i);
    const idMatch = ics.match(/X-CALSYNC-ID:\s*(\S+)/i);

    if (sourceMatch && idMatch && sourceMatch[1] === expectedSource) {
      return idMatch[1];
    }
    return null;
  }

  _sanitizeName(name) {
    // 对于含非 ASCII 字符的名称（如中文），使用 MD5 哈希生成 URL 安全的标识符
    // 显示名称仍通过 MKCALENDAR 的 displayname 属性正确设置
    if (/[^\x00-\x7F]/.test(name)) {
      return crypto.createHash('md5').update(name, 'utf8').digest('hex').substring(0, 16);
    }
    return name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'calendar';
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      // 尝试获取用户的 principal
      const response = await this.api.request({
        method: 'PROPFIND',
        url: `${this.username}/`,
        headers: { Depth: '0' },
      });

      return {
        success: true,
        server: this.serverUrl,
        username: this.username,
      };
    } catch (error) {
      if (error.response?.status === 401) {
        return { success: false, error: '认证失败：用户名或密码错误' };
      }
      if (error.response?.status === 404) {
        // 用户不存在但服务器可达，仍算连接成功
        return {
          success: true,
          server: this.serverUrl,
          username: this.username,
          message: '用户尚未创建日历，首次同步时将自动创建',
        };
      }
      return {
        success: false,
        error: `连接失败：${error.message}`,
      };
    }
  }
}

module.exports = CalDAVService;
