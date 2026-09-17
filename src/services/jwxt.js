const axios = require('axios');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const https = require('https');
const logger = require('../utils/logger');
const { getConfigManager } = require('../utils/configManager');

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

/**
 * 教务系统服务（青果 KINGOSOFT）
 * 
 * 工作方式：
 * 1. 首次通过 Puppeteer 内嵌浏览器手动登录
 * 2. 保存登录 cookie
 * 3. 后续同步直接用 cookie + axios 抓取课表页面
 * 4. cookie 失效时通知用户重新登录
 */
class JWXTService {
  constructor(config) {
    this.baseUrl = config.baseUrl || ''; // 教务系统根地址
    this.username = config.username || '';
    this.cookies = null;
    this.cookieFile = null;
    this.isLoggedIn = false;
  }

  /**
   * 初始化：加载保存的 cookie
   */
  async init() {
    const configManager = getConfigManager();
    const dataDir = configManager.getDataDir();
    this.cookieFile = path.join(dataDir, 'jwxt-cookies.json');

    // 尝试加载保存的 cookie
    try {
      if (fs.existsSync(this.cookieFile)) {
        const data = JSON.parse(fs.readFileSync(this.cookieFile, 'utf-8'));
        if (data.baseUrl === this.baseUrl && data.username === this.username) {
          this.cookies = data.cookies;
          logger.info('已加载教务系统保存的 cookie', { username: this.username });
          
          // 检查 cookie 是否有效
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
   * 保存 cookie 到文件
   */
  saveCookies(cookies, baseUrl, username) {
    this.cookies = cookies;
    this.baseUrl = baseUrl;
    this.username = username;
    this.isLoggedIn = true;

    try {
      const configManager = getConfigManager();
      const dataDir = configManager.getDataDir();
      this.cookieFile = path.join(dataDir, 'jwxt-cookies.json');

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
      
      // 尝试访问需要登录的页面
      const response = await axiosInstance.get(`${this.baseUrl}/frame/homepage`, {
        headers: {
          'Cookie': cookieStr,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        maxRedirects: 0,
        validateStatus: () => true,
      });

      // 如果跳转到登录页或返回 302，说明 cookie 失效
      if (response.status === 302 || response.status === 301) {
        return false;
      }

      // 检查页面内容是否包含登录相关字样
      const html = response.data;
      if (html.includes('登录') && html.includes('密码') && html.includes('验证码')) {
        return false;
      }

      // 检查是否有学生姓名或个人信息
      if (html.includes('学生') || html.includes('姓名') || html.includes('个人信息')) {
        return true;
      }

      // 默认认为有效（页面能正常返回）
      return response.status === 200;
    } catch (error) {
      logger.warn('检查教务系统登录状态失败', { error: error.message });
      return false;
    }
  }

  /**
   * 获取 cookie 字符串
   */
  getCookieString() {
    if (!this.cookies) return '';
    return this.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * 获取周课表
   * @param {string} weekStartDate - 周开始日期 YYYYMMDD
   */
  async getWeekSchedule(weekStartDate) {
    if (!this.isLoggedIn) {
      throw new Error('教务系统未登录，请先登录');
    }

    try {
      const cookieStr = this.getCookieString();
      
      // 青果教务系统课表地址（可能因学校而异，这里用常见路径）
      // 先尝试获取学生课表页面
      const response = await axiosInstance.get(
        `${this.baseUrl}/student/course/grkb11.jsp`,
        {
          headers: {
            'Cookie': cookieStr,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': `${this.baseUrl}/frame/homepage`,
          },
          params: {
            xnxqdm: '', // 学年学期代码
            zc: '',    // 周次
          },
          timeout: 15000,
        }
      );

      return this.parseScheduleHTML(response.data);
    } catch (error) {
      logger.error('获取周课表失败', { error: error.message });
      
      // 如果是登录失效，标记为未登录
      if (error.response?.status === 302 || 
          error.response?.status === 401 ||
          error.message?.includes('登录')) {
        this.isLoggedIn = false;
      }
      
      throw error;
    }
  }

  /**
   * 获取指定日期的课表
   */
  async getDaySchedule(dateStr) {
    // 青果教务系统通常按周返回，所以先获取本周课表再筛选
    const date = dayjs(dateStr);
    const weekStart = date.startOf('week').add(1, 'day'); // 周一为一周开始（中国习惯）
    
    const weekCourses = await this.getWeekSchedule(weekStart.format('YYYYMMDD'));
    
    // 筛选指定日期的课程
    return weekCourses.filter(course => {
      const courseDate = dayjs(course.date);
      return courseDate.isSame(date, 'day');
    });
  }

  /**
   * 获取未来 N 天的课表并转换为日历事件
   */
  async getCalendarEvents(daysAhead = 14) {
    logger.info('开始获取教务系统课表数据', { daysAhead, baseUrl: this.baseUrl });

    if (!this.isLoggedIn) {
      throw new Error('教务系统未登录');
    }

    const events = [];
    const today = dayjs();

    try {
      // 获取今天所在周的课表 + 接下来几周
      const totalWeeks = Math.ceil(daysAhead / 7) + 1;
      
      for (let w = 0; w < totalWeeks; w++) {
        const weekDate = today.add(w * 7, 'day');
        const weekCourses = await this.getWeekSchedule(weekDate.format('YYYYMMDD'));
        
        for (const course of weekCourses) {
          const courseDate = dayjs(course.date);
          // 只保留未来 N 天内的课程
          if (courseDate.isAfter(today.subtract(1, 'day')) && 
              courseDate.isBefore(today.add(daysAhead, 'day'))) {
            events.push(this.courseToEvent(course));
          }
        }

        // 避免请求过快
        await new Promise(r => setTimeout(r, 500));
      }

      logger.info(`教务系统课表获取完成，共 ${events.length} 节课`);
      return events;
    } catch (error) {
      logger.error('获取教务系统课表失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 解析课表 HTML
   * 青果教务系统课表通常是一个大表格
   */
  parseScheduleHTML(html) {
    const courses = [];
    
    try {
      const $ = cheerio.load(html, { decodeEntities: true });

      // 检查是否是框架页面（iframe），不是课表内容
      const iframes = $('iframe');
      if (iframes.length > 0 && !$('table').length) {
        logger.warn('检测到这是框架页面，不是课表内容页面', { iframes: iframes.length });
        return courses;
      }

      // 查找课表表格 — 多种选择器尝试
      let $table = null;
      const selectors = [
        '#kbgrid_table_0',
        '#kbgrid_table',
        '.kbgrid_table',
        '#1',
        'table.kbtable',
        'table[id*="kbgrid"]',
        'table[id*="kb"]',
        '#td0 > table',
        'div.kbtable > table',
        'div[id*="kb"] > table',
      ];

      for (const sel of selectors) {
        if ($(sel).length) {
          $table = $(sel).first();
          logger.info('找到课表表格', { selector: sel, rows: $table.find('tr').length });
          break;
        }
      }

      // 如果上面的选择器没找到，找含有 rowspan 且行数 > 3 的最大表格
      if (!$table || !$table.length) {
        let bestTable = null;
        let maxRows = 0;
        $('table').each((i, tbl) => {
          const $tbl = $(tbl);
          const rows = $tbl.find('tr').length;
          const hasRowspan = $tbl.find('td[rowspan]').length;
          if (rows > maxRows && (hasRowspan > 0 || rows > 5)) {
            maxRows = rows;
            bestTable = $tbl;
          }
        });
        if (bestTable) {
          $table = bestTable;
          logger.info('通过通用搜索找到可能的课表表格', { rows: maxRows });
        }
      }

      if (!$table || !$table.length) {
        // 记录所有表格信息用于调试
        const allTables = $('table').map((i, t) => ({
          idx: i,
          id: $(t).attr('id') || '',
          class: $(t).attr('class') || '',
          rows: $(t).find('tr').length,
        })).get();
        logger.warn('未找到课表表格', { totalTables: allTables.length, tables: allTables.slice(0, 10) });
        return courses;
      }

      // 获取日期行（在表头中查找）
      const dates = [];
      $table.find('tr').each((rowIdx, tr) => {
        if (rowIdx > 2) return; // 只看前3行
        $(tr).find('th, td').each((i, cell) => {
          const text = $(cell).text().trim();
          // 匹配多种日期格式：09-01, 9月1日, 09/01, 周一 09-01 等
          const dateMatch = text.match(/(\d{1,2})[-\/月](\d{1,2})/);
          if (dateMatch && !dates[i]) {
            const month = parseInt(dateMatch[1]);
            const day = parseInt(dateMatch[2]);
            const year = new Date().getFullYear();
            dates[i] = dayjs(`${year}-${month}-${day}`).format('YYYY-MM-DD');
          }
        });
      });

      logger.info('解析到日期列', { dates: dates.filter(d => d) });

      // 如果没有找到日期，使用星期几（周一到周日）推算
      if (dates.filter(d => d).length === 0) {
        const today = dayjs();
        const monday = today.subtract(today.day() - 1, 'day');
        $table.find('tr').first().find('th, td').each((i, cell) => {
          const text = $(cell).text().trim();
          if (text.includes('周一') || text.includes('星期一')) dates[i] = monday.format('YYYY-MM-DD');
          if (text.includes('周二') || text.includes('星期二')) dates[i] = monday.add(1, 'day').format('YYYY-MM-DD');
          if (text.includes('周三') || text.includes('星期三')) dates[i] = monday.add(2, 'day').format('YYYY-MM-DD');
          if (text.includes('周四') || text.includes('星期四')) dates[i] = monday.add(3, 'day').format('YYYY-MM-DD');
          if (text.includes('周五') || text.includes('星期五')) dates[i] = monday.add(4, 'day').format('YYYY-MM-DD');
          if (text.includes('周六') || text.includes('星期六')) dates[i] = monday.add(5, 'day').format('YYYY-MM-DD');
          if (text.includes('周日') || text.includes('星期日') || text.includes('星期天')) dates[i] = monday.add(6, 'day').format('YYYY-MM-DD');
        });
      }

      // 遍历每一行（每一节）
      $table.find('tr').each((rowIdx, tr) => {
        if (rowIdx < 1) return; // 跳过表头行

        const $tr = $(tr);
        const $cells = $tr.find('td');
        let sectionInfo = $cells.first().text().trim();
        let sectionMatch = sectionInfo.match(/第?(\d+)/);
        let sectionStart = sectionMatch ? parseInt(sectionMatch[1]) : rowIdx;

        $cells.each((colIdx, td) => {
          if (colIdx === 0) return; // 跳过节次列

          const $td = $(td);
          const content = $td.html();
          
          if (!content || content.trim().length < 2) return;

          // 检查是否有课程
          const courseName = this.extractCourseName(content);
          
          if (courseName) {
            const rowspan = parseInt($td.attr('rowspan')) || 1;
            const dateIdx = colIdx;
            
            const dateStr = dates[dateIdx] || '';

            courses.push({
              date: dateStr || dayjs().format('YYYY-MM-DD'),
              section_start: sectionStart,
              section_end: sectionStart + rowspan - 1,
              course_name: courseName,
              teacher: this.extractTeacher(content),
              classroom: this.extractClassroom(content),
              week: this.extractWeek(content),
              raw: content,
            });
          }
        });
      });

      logger.info(`课表解析完成，共 ${courses.length} 节课`);

    } catch (error) {
      logger.error('解析课表 HTML 失败', { error: error.message, stack: error.stack });
    }

    return courses;
  }

  /**
   * 从课表单元格中提取课程名
   */
  extractCourseName(content) {
    const $ = cheerio.load(content);
    // 尝试多种方式提取
    let name = $('font[title]').attr('title') || 
               $('a').first().text().trim() ||
               $('div').first().text().trim() ||
               $.text().trim();
    
    // 清理
    name = name.replace(/\s+/g, ' ').trim();
    // 过滤掉太短的内容
    if (name.length < 2) return null;
    // 过滤掉纯数字或节次
    if (/^\d+$/.test(name)) return null;
    
    return name.substring(0, 100);
  }

  /**
   * 提取教师名
   */
  extractTeacher(content) {
    const $ = cheerio.load(content);
    const text = $.text();
    // 常见格式：教师名、(教师名)、@教师名等
    const patterns = [
      /主讲[:：]\s*([^\n<]+)/,
      /教师[:：]\s*([^\n<]+)/,
      /@([^\n<\s]+)/,
    ];
    
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) return m[1].trim();
    }
    
    return '';
  }

  /**
   * 提取教室
   */
  extractClassroom(content) {
    const $ = cheerio.load(content);
    const text = $.text();
    // 常见格式：教室名、{教室名}、[教室名]等
    const patterns = [
      /教室[:：]\s*([^\n<]+)/,
      /地点[:：]\s*([^\n<]+)/,
      /\{([^}]+)\}/,
      /\[([^\]]+)\]/,
    ];
    
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) return m[1].trim();
    }
    
    return '';
  }

  /**
   * 提取周次信息
   */
  extractWeek(content) {
    const $ = cheerio.load(content);
    const text = $.text();
    const m = text.match(/第?(\d+[-,，\d]*)周/);
    return m ? m[0] : '';
  }

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
      subject: course.course_name,
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
    if (course.week) lines.push(`周次：${course.week}`);
    lines.push('', '--- 来自教务系统课表同步 ---');
    return lines.join('\n');
  }

  /**
   * 获取课程开始时间
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
   * 获取课程结束时间
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
