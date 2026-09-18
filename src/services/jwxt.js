const axios = require('axios');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const https = require('https');
const logger = require('../utils/logger');

// 数据目录（直接使用固定路径，避免循环依赖）
const DATA_DIR = path.join(process.cwd(), 'data');

// 创建忽略 HTTPS 证书错误的 axios 实例
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const axiosInstance = axios.create({
  httpsAgent,
  timeout: 30000,
  maxRedirects: 5,
  validateStatus: () => true,
});

// GBK 解码器
const gbkDecoder = new TextDecoder('gbk');

/**
 * 教务系统服务（青果 KINGOSOFT）
 */
class JWXTService {
  constructor(config) {
    this.baseUrl = config.baseUrl || '';
    this.username = config.username || '';
    this.cookies = null;
    this.cookieFile = null;
    this.isLoggedIn = false;
    // 学期开始日期（周一），用于将周次转换为实际日期
    this.semesterStart = config.semesterStart || '2026-09-01';
  }

  /**
   * 初始化：加载保存的 cookie
   */
  async init() {
    this.cookieFile = path.join(DATA_DIR, 'jwxt-cookies.json');

    try {
      if (fs.existsSync(this.cookieFile)) {
        const data = JSON.parse(fs.readFileSync(this.cookieFile, 'utf-8'));
        if (data.baseUrl === this.baseUrl && data.username === this.username) {
          this.cookies = data.cookies;
          logger.info('已加载教务系统保存的 cookie', { username: this.username });
          const valid = await this.checkLoginStatus();
          if (valid) {
            this.isLoggedIn = true;
            logger.info('✓ 教务系统 cookie 有效');
          } else {
            logger.warn('教务系统 cookie 已失效，需要重新登录');
            this.cookies = null;
          }
        }
      }
    } catch (error) {
      logger.warn('加载教务系统 cookie 失败', { error: error.message });
    }
  }

  /**
   * 保存 cookie
   */
  saveCookies(cookies, baseUrl, username) {
    this.cookies = cookies;
    this.baseUrl = baseUrl;
    this.username = username;
    this.isLoggedIn = true;

    try {
      this.cookieFile = path.join(DATA_DIR, 'jwxt-cookies.json');

      fs.writeFileSync(this.cookieFile, JSON.stringify({
        baseUrl,
        username,
        cookies,
        savedAt: new Date().toISOString(),
      }, null, 2), 'utf-8');

      logger.info('教务系统 cookie 已保存', { username });
      return true;
    } catch (error) {
      logger.error('保存教务系统 cookie 失败', { error: error.message });
      return false;
    }
  }

  /**
   * 检查登录状态
   */
  async checkLoginStatus() {
    if (!this.cookies || !this.baseUrl) return false;
    try {
      const cookieStr = this.cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const response = await axiosInstance.get(`${this.baseUrl}/frame/homepage`, {
        headers: {
          'Cookie': cookieStr,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        maxRedirects: 0,
        validateStatus: () => true,
      });
      if (response.status === 302 || response.status === 301) return false;
      const html = response.data;
      if (html.includes('登录') && html.includes('密码') && html.includes('验证码')) return false;
      if (html.includes('学生') || html.includes('姓名') || html.includes('个人信息')) return true;
      return response.status === 200;
    } catch (error) {
      logger.warn('检查教务系统登录状态失败', { error: error.message });
      return false;
    }
  }

  getCookieString() {
    if (!this.cookies) return '';
    return this.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  // ========== MHTML 解析 ==========

  /**
   * 解析 MHTML 文件，提取所有 HTML 部分
   */
  parseMHTML(content) {
    const htmlParts = [];

    // 检测是否是 MHTML
    if (!content.includes('MIME-Version') && !content.includes('multipart/related')) {
      // 普通 HTML，直接返回
      return [{ html: content, location: '' }];
    }

    // 提取 boundary
    const boundaryMatch = content.match(/boundary="?([^\s"\r\n]+)"?/);
    if (!boundaryMatch) {
      return [{ html: content, location: '' }];
    }
    const boundary = boundaryMatch[1];

    // 按 boundary 分割
    const parts = content.split('--' + boundary);
    for (const part of parts) {
      // 跳过前导文本和结尾
      if (!part.trim() || part.trim() === '--') continue;

      // 分离 headers 和 body
      const headerBodyMatch = part.match(/^\r?\n([\s\S]*?)(\r?\n\r?\n)([\s\S]*)$/);
      if (!headerBodyMatch) continue;

      const headers = headerBodyMatch[1];
      let body = headerBodyMatch[3];

      // 检查 Content-Type
      const isHTML = /Content-Type:\s*text\/html/i.test(headers);
      if (!isHTML) continue;

      // 提取 Content-Location
      const locationMatch = headers.match(/Content-Location:\s*(\S+)/);
      const location = locationMatch ? locationMatch[1] : '';

      // 解码 quoted-printable
      const isQP = /Content-Transfer-Encoding:\s*quoted-printable/i.test(headers);
      if (isQP) {
        body = this.decodeQuotedPrintable(body);
      }

      htmlParts.push({ html: body, location });
    }

    logger.info(`MHTML 解析完成，找到 ${htmlParts.length} 个 HTML 部分`, {
      locations: htmlParts.map(p => p.location).slice(0, 5)
    });

    return htmlParts;
  }

  /**
   * 解码 quoted-printable 编码，返回 UTF-8 字符串
   */
  decodeQuotedPrintable(text) {
    // 移除软换行（行尾的 =）
    let cleaned = text.replace(/=\r?\n/g, '');
    // 解码 =XX 为字节
    const bytes = [];
    let i = 0;
    while (i < cleaned.length) {
      if (cleaned[i] === '=' && i + 2 < cleaned.length) {
        const hex = cleaned.substr(i + 1, 2);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          bytes.push(parseInt(hex, 16));
          i += 3;
          continue;
        }
      }
      // 普通 ASCII 字符直接编码
      const code = cleaned.charCodeAt(i);
      if (code < 128) {
        bytes.push(code);
      } else {
        // 非 ASCII 字符（理论上 QP 中不应该出现，但以防万一）
        const encoded = new TextEncoder().encode(cleaned[i]);
        for (const b of encoded) bytes.push(b);
      }
      i++;
    }
    // 用 GBK 解码
    const uint8 = new Uint8Array(bytes);
    try {
      return gbkDecoder.decode(uint8);
    } catch (e) {
      // 如果 GBK 解码失败，尝试 UTF-8
      return new TextDecoder('utf-8').decode(uint8);
    }
  }

  // ========== 课表解析 ==========

  /**
   * 解析课表 HTML / MHTML
   * 自动检测格式，提取课程信息
   */
  parseScheduleHTML(content) {
    // 先尝试 MHTML 解析
    const htmlParts = this.parseMHTML(content);

    // 找到包含 DataTable 的部分（课表数据在这里）
    let scheduleHtml = null;
    for (const part of htmlParts) {
      if (part.location.includes('DataTable') || part.html.includes('sdTable_tbody')) {
        scheduleHtml = part.html;
        logger.info('找到 DataTable 课表内容', { location: part.location, length: part.html.length });
        break;
      }
    }

    // 如果没找到 DataTable，尝试找包含课表关键词的部分
    if (!scheduleHtml) {
      for (const part of htmlParts) {
        if (part.html.includes('tr0_kc') || part.html.includes('sksj') || part.html.includes('qsz')) {
          scheduleHtml = part.html;
          logger.info('找到课表内容（关键词匹配）', { length: part.html.length });
          break;
        }
      }
    }

    // 如果还没有，用第一个 HTML 部分
    if (!scheduleHtml && htmlParts.length > 0) {
      scheduleHtml = htmlParts[0].html;
    }

    if (!scheduleHtml) {
      logger.warn('无法提取课表 HTML 内容');
      return [];
    }

    return this.parseDataTable(scheduleHtml);
  }

  /**
   * 解析青果教务系统 DataTable 格式课表
   * 表格是列表格式，每行包含：课程名、周次、上课时间、地点、教师
   */
  parseDataTable(html) {
    const courses = [];

    try {
      const $ = cheerio.load(html, { decodeEntities: true });

      // 找到数据表
      let $tbody = $('#sdTable_tbody');
      if (!$tbody.length) {
        $tbody = $('tbody').first();
      }
      if (!$tbody.length) {
        logger.warn('未找到课表数据表 tbody');
        return courses;
      }

      const rows = $tbody.find('tr');
      logger.info(`找到 ${rows.length} 行课表数据`);

      let lastCourseName = '';
      let lastCourseInfo = {};

      rows.each((idx, tr) => {
        const $tr = $(tr);
        const rowId = $tr.attr('id') || `tr${idx}`;

        // 提取各字段（用 title 属性获取完整文本）
        const courseName = this.getCellText($, $tr, rowId, 'kc');
        const weekStr = this.getCellText($, $tr, rowId, 'qsz');
        const timeStr = this.getCellText($, $tr, rowId, 'sksj');
        const locationStr = this.getCellText($, $tr, rowId, 'skdd');
        const teacherStr = this.getCellText($, $tr, rowId, 'rkjs');
        const courseType = this.getCellText($, $tr, rowId, 'skfs');
        const classInfo = this.getCellText($, $tr, rowId, 'curent_skbzdmmc');

        // 如果课程名为空，用上一个非空课程名
        let actualCourseName = courseName;
        if (!actualCourseName && lastCourseName) {
          actualCourseName = lastCourseName;
        } else if (actualCourseName) {
          lastCourseName = actualCourseName;
          lastCourseInfo = { courseType, classInfo };
        }

        // 必须有周次和时间才能生成事件
        if (!weekStr || !timeStr) return;

        // 清理课程名中的编号前缀 [07000070]
        actualCourseName = actualCourseName.replace(/^\[\d+\]/, '').trim();

        // 解析周次 "1-3,6-8,11-15" → [1,2,3,6,7,8,11,12,13,14,15]
        const weeks = this.parseWeekRange(weekStr);
        if (weeks.length === 0) return;

        // 解析时间 "周一(7-8节)" → {dayOfWeek: 1, sections: [7,8]}
        const timeSlots = this.parseTimeSlot(timeStr);
        if (timeSlots.length === 0) return;

        // 清理地点名
        const cleanLocation = locationStr.replace(/\(.*?\)/g, '').trim();
        const cleanTeacher = teacherStr.trim();

        // 为每个周次 × 每个时间段生成一个课程条目
        for (const week of weeks) {
          for (const slot of timeSlots) {
            const date = this.weekToDate(week, slot.dayOfWeek);
            if (!date) continue;

            courses.push({
              date: date,
              week: week,
              dayOfWeek: slot.dayOfWeek,
              section_start: slot.sections[0],
              section_end: slot.sections[slot.sections.length - 1],
              course_name: actualCourseName,
              teacher: cleanTeacher,
              classroom: cleanLocation,
              course_type: courseType,
              class_info: lastCourseInfo.classInfo || classInfo,
              raw: `${actualCourseName} | ${weekStr} | ${timeStr} | ${locationStr}`,
            });
          }
        }
      });

      logger.info(`课表解析完成，共 ${courses.length} 节课`);

    } catch (error) {
      logger.error('解析 DataTable 课表失败', { error: error.message, stack: error.stack });
    }

    return courses;
  }

  /**
   * 从表格行中提取单元格文本
   */
  getCellText($, $tr, rowId, fieldName) {
    // 先用 title 属性（青果系统把完整文本放在 title 里）
    const $cell = $tr.find(`#${rowId}_${fieldName}`);
    if ($cell.length) {
      const title = $cell.attr('title');
      if (title && title.trim()) return title.trim();
      const text = $cell.text().trim();
      if (text) return text;
    }
    // 备选：用 name 属性
    const $cellByName = $tr.find(`td[name="${fieldName}"]`);
    if ($cellByName.length) {
      const title = $cellByName.attr('title');
      if (title && title.trim()) return title.trim();
      return $cellByName.text().trim();
    }
    return '';
  }

  /**
   * 解析周次字符串
   * "1-3,6-8,11-15" → [1,2,3,6,7,8,11,12,13,14,15]
   * "5" → [5]
   * "1,3,5,7" → [1,3,5,7]
   */
  parseWeekRange(str) {
    const weeks = [];
    if (!str) return weeks;

    // 清理
    str = str.replace(/周/g, '').replace(/\s+/g, '').trim();

    const parts = str.split(',');
    for (const part of parts) {
      const partStr = part.trim();
      if (!partStr) continue;

      // 匹配范围 "1-3"
      const rangeMatch = partStr.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        for (let w = start; w <= end; w++) {
          weeks.push(w);
        }
        continue;
      }

      // 匹配单个数字 "5"
      const singleMatch = partStr.match(/^(\d+)$/);
      if (singleMatch) {
        weeks.push(parseInt(singleMatch[1]));
      }
    }

    return weeks;
  }

  /**
   * 解析上课时间
   * "周一(7-8节)" → [{dayOfWeek: 1, sections: [7,8]}]
   * "周一(1-2节),周三(3-4节)" → [{dayOfWeek:1,sections:[1,2]},{dayOfWeek:3,sections:[3,4]}]
   */
  parseTimeSlot(str) {
    const slots = [];
    if (!str) return slots;

    // 匹配 "周X(N-M节)" 或 "星期X(N-M节)"
    const pattern = /周([一二三四五六日天])\((\d+)-(\d+)节\)|星期([一二三四五六日天])\((\d+)-(\d+)节\)/g;
    let match;
    while ((match = pattern.exec(str)) !== null) {
      const dayChar = match[1] || match[4];
      const startSection = parseInt(match[2] || match[5]);
      const endSection = parseInt(match[3] || match[6]);
      const dayOfWeek = this.chineseToWeekday(dayChar);
      if (dayOfWeek > 0) {
        const sections = [];
        for (let s = startSection; s <= endSection; s++) {
          sections.push(s);
        }
        slots.push({ dayOfWeek, sections });
      }
    }

    // 如果上面的模式没匹配到，尝试更灵活的匹配
    if (slots.length === 0) {
      // 匹配 "周X第N节" 或 "周X N-M节"
      const flexPattern = /周([一二三四五六日天]).*?(\d+)[-,](\d+)?节?/g;
      let flexMatch;
      while ((flexMatch = flexPattern.exec(str)) !== null) {
        const dayChar = flexMatch[1];
        const startSection = parseInt(flexMatch[2]);
        const endSection = flexMatch[3] ? parseInt(flexMatch[3]) : startSection;
        const dayOfWeek = this.chineseToWeekday(dayChar);
        if (dayOfWeek > 0) {
          const sections = [];
          for (let s = startSection; s <= endSection; s++) {
            sections.push(s);
          }
          slots.push({ dayOfWeek, sections });
        }
      }
    }

    return slots;
  }

  /**
   * 中文星期转数字（周一=1, 周日=7）
   */
  chineseToWeekday(char) {
    const map = {
      '一': 1, '二': 2, '三': 3, '四': 4,
      '五': 5, '六': 6, '日': 7, '天': 7,
    };
    return map[char] || 0;
  }

  /**
   * 根据周次和星期几计算实际日期
   * @param {number} week - 第几周
   * @param {number} dayOfWeek - 星期几（1=周一, 7=周日）
   * @returns {string} YYYY-MM-DD
   */
  weekToDate(week, dayOfWeek) {
    const semesterStart = dayjs(this.semesterStart);
    // 第1周的第1天 = semesterStart
    // 第N周的第D天 = semesterStart + (N-1)*7 + (D-1) 天
    const date = semesterStart.add((week - 1) * 7 + (dayOfWeek - 1), 'day');
    return date.format('YYYY-MM-DD');
  }

  // ========== 日历事件转换 ==========

  /**
   * 课程转换为日历事件
   */
  courseToEvent(course) {
    const startTime = this.getCourseStartTime(course.section_start);
    const endTime = this.getCourseEndTime(course.section_end || course.section_start);

    const date = dayjs(course.date);
    const startDateTime = date.hour(startTime.hour).minute(startTime.minute).second(0);
    const endDateTime = date.hour(endTime.hour).minute(endTime.minute).second(0);

    return {
      id: `jwxt_${course.course_name}_${course.date}_${course.section_start}`.replace(/\s+/g, '_'),
      subject: course.classroom ? `${course.course_name} @ ${course.classroom}` : course.course_name,
      body: {
        contentType: 'text',
        content: this.buildCourseDescription(course),
      },
      start: {
        dateTime: startDateTime.format('YYYY-MM-DDTHH:mm:ss'),
        timeZone: 'Asia/Shanghai',
      },
      end: {
        dateTime: endDateTime.format('YYYY-MM-DDTHH:mm:ss'),
        timeZone: 'Asia/Shanghai',
      },
      location: {
        displayName: course.classroom || '',
      },
      categories: ['课程表'],
      isAllDay: false,
    };
  }

  /**
   * 构建课程描述
   */
  buildCourseDescription(course) {
    const lines = [];
    if (course.teacher) lines.push(`教师：${course.teacher}`);
    if (course.classroom) lines.push(`教室：${course.classroom}`);
    if (course.section_start && course.section_end) {
      lines.push(`节次：第${course.section_start}-${course.section_end}节`);
    }
    if (course.week) lines.push(`第${course.week}周`);
    if (course.course_type) lines.push(`类型：${course.course_type}`);
    if (course.class_info) lines.push(`班级：${course.class_info}`);
    lines.push('', '--- 来自教务系统课表同步 ---');
    return lines.join('\n');
  }

  /**
   * 课程开始时间
   */
  getCourseStartTime(section) {
    const schedule = {
      1: { hour: 8, minute: 0 },
      2: { hour: 8, minute: 55 },
      3: { hour: 10, minute: 0 },
      4: { hour: 10, minute: 55 },
      5: { hour: 14, minute: 0 },
      6: { hour: 14, minute: 55 },
      7: { hour: 16, minute: 0 },
      8: { hour: 16, minute: 55 },
      9: { hour: 19, minute: 0 },
      10: { hour: 19, minute: 55 },
      11: { hour: 20, minute: 50 },
    };
    return schedule[section] || { hour: 8, minute: 0 };
  }

  /**
   * 课程结束时间
   */
  getCourseEndTime(section) {
    const schedule = {
      1: { hour: 8, minute: 45 },
      2: { hour: 9, minute: 40 },
      3: { hour: 10, minute: 45 },
      4: { hour: 11, minute: 40 },
      5: { hour: 14, minute: 45 },
      6: { hour: 15, minute: 40 },
      7: { hour: 16, minute: 45 },
      8: { hour: 17, minute: 40 },
      9: { hour: 19, minute: 45 },
      10: { hour: 20, minute: 40 },
      11: { hour: 21, minute: 35 },
    };
    return schedule[section] || { hour: 9, minute: 40 };
  }

  /**
   * 测试连接
   */
  async testConnection() {
    if (!this.baseUrl) {
      return { success: false, error: '未配置教务系统地址' };
    }
    if (!this.isLoggedIn) {
      return { success: false, error: '未登录或登录已过期，请重新登录' };
    }
    try {
      const valid = await this.checkLoginStatus();
      if (valid) {
        return { success: true, message: '教务系统连接正常' };
      } else {
        this.isLoggedIn = false;
        return { success: false, error: '登录已过期，请重新登录' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = JWXTService;
