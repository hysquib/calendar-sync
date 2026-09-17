const axios = require('axios');
const dayjs = require('dayjs');
const logger = require('../utils/logger');

/**
 * 喜鹊儿课表服务
 * 用于从喜鹊儿教务系统获取课表数据
 *
 * 喜鹊儿是青果软件的产品，主要服务于高校教务系统
 * API 基础地址: https://api.xiaogj.com
 */
class XiqueerService {
  constructor(config) {
    this.username = config.username;
    this.password = config.password;
    this.school = config.school;
    this.daysAhead = config.daysAhead || 14;

    this.accessToken = null;
    this.studentId = null;
    this.schoolId = null;

    this.api = axios.create({
      baseURL: 'https://api.xiaogj.com',
      timeout: 15000,
      headers: {
        'User-Agent': 'Xiqueer/2.6.453 (Android; Mobile)',
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * 登录喜鹊儿获取 access_token
   */
  async login() {
    try {
      logger.info('正在登录喜鹊儿...', { username: this.username, school: this.school });

      // 第一步：获取学校列表，找到学校ID
      if (!this.schoolId && this.school) {
        await this.findSchoolId();
      }

      // 第二步：登录获取token
      const response = await this.api.post('/v2/login', {
        user_name: this.username,
        password: this.password,
        school_id: this.schoolId,
        device_type: 'android',
        device_id: 'calendar-sync-service',
      });

      if (response.data.errcode === 0 && response.data.data) {
        this.accessToken = response.data.data.access_token;
        this.studentId = response.data.data.student_id || response.data.data.user_id;
        logger.info('喜鹊儿登录成功', { studentId: this.studentId });
        return true;
      }

      logger.error('喜鹊儿登录失败', { errcode: response.data.errcode, errmsg: response.data.errmsg });
      throw new Error(`登录失败: ${response.data.errmsg || '未知错误'}`);
    } catch (error) {
      logger.error('喜鹊儿登录异常', { error: error.message });
      throw error;
    }
  }

  /**
   * 查找学校ID
   */
  async findSchoolId() {
    try {
      const response = await this.api.get('/v2/school/list', {
        params: { keyword: this.school },
      });

      if (response.data.errcode === 0 && response.data.data && response.data.data.length > 0) {
        const school = response.data.data.find(s =>
          s.school_name === this.school || s.school_name.includes(this.school)
        );
        if (school) {
          this.schoolId = school.school_id;
          logger.info('找到学校', { schoolName: school.school_name, schoolId: this.schoolId });
          return;
        }
      }

      logger.warn('未找到匹配的学校，将尝试直接登录');
    } catch (error) {
      logger.warn('获取学校列表失败，将尝试直接登录', { error: error.message });
    }
  }

  /**
   * 获取指定日期的课表
   * @param {string} date - 日期，格式 YYYYMMDD
   */
  async getDaySchedule(date) {
    if (!this.accessToken) {
      await this.login();
    }

    try {
      const response = await this.api.get('/v2/student/course/day', {
        params: {
          access_token: this.accessToken,
          student_id: this.studentId,
          day: date,
        },
      });

      if (response.data.errcode === 0) {
        return response.data.data || [];
      }

      // token可能过期，重新登录
      if (response.data.errcode === 401 || response.data.errcode === 40001) {
        logger.warn('access_token 过期，重新登录');
        await this.login();
        return this.getDaySchedule(date);
      }

      logger.warn('获取日课表失败', { date, errcode: response.data.errcode, errmsg: response.data.errmsg });
      return [];
    } catch (error) {
      logger.error('获取日课表异常', { date, error: error.message });
      return [];
    }
  }

  /**
   * 获取周课表
   * @param {string} weekStartDate - 周开始日期，格式 YYYYMMDD
   */
  async getWeekSchedule(weekStartDate) {
    if (!this.accessToken) {
      await this.login();
    }

    try {
      const response = await this.api.get('/v2/student/course/week', {
        params: {
          access_token: this.accessToken,
          student_id: this.studentId,
          week_start: weekStartDate,
        },
      });

      if (response.data.errcode === 0) {
        return response.data.data || [];
      }

      if (response.data.errcode === 401 || response.data.errcode === 40001) {
        logger.warn('access_token 过期，重新登录');
        await this.login();
        return this.getWeekSchedule(weekStartDate);
      }

      logger.warn('获取周课表失败', { weekStartDate, errcode: response.data.errcode, errmsg: response.data.errmsg });
      return [];
    } catch (error) {
      logger.error('获取周课表异常', { weekStartDate, error: error.message });
      return [];
    }
  }

  /**
   * 获取未来N天的所有课表，并转换为日历事件格式
   * @returns {Array} 日历事件数组
   */
  async getCalendarEvents() {
    logger.info('开始获取喜鹊儿课表数据', { daysAhead: this.daysAhead });

    const events = [];
    const today = dayjs();

    // 获取未来 N 天的课表
    for (let i = 0; i < this.daysAhead; i++) {
      const date = today.add(i, 'day');
      const dateStr = date.format('YYYYMMDD');

      try {
        const dayCourses = await this.getDaySchedule(dateStr);

        for (const course of dayCourses) {
          const event = this.courseToEvent(course, date);
          if (event) {
            events.push(event);
          }
        }
      } catch (error) {
        logger.error('获取某天课表失败', { date: dateStr, error: error.message });
      }

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    logger.info('喜鹊儿课表获取完成', { eventCount: events.length, daysAhead: this.daysAhead });
    return events;
  }

  /**
   * 将课程数据转换为日历事件格式
   * @param {Object} course - 课程数据
   * @param {dayjs.Dayjs} date - 日期
   */
  courseToEvent(course, date) {
    if (!course || !course.course_name) return null;

    // 解析上课时间（第X节）
    const startTime = this.getCourseStartTime(course.section_start || course.begin_section);
    const endTime = this.getCourseEndTime(course.section_end || course.end_section || course.section_start);

    if (!startTime || !endTime) return null;

    const startDateTime = date.hour(startTime.hour).minute(startTime.minute).second(0);
    const endDateTime = date.hour(endTime.hour).minute(endTime.minute).second(0);

    const location = course.classroom || course.room_name || course.address || '';
    const teacher = course.teacher_name || course.teacher || '';

    return {
      id: `xiqueer_${course.course_id || course.id}_${date.format('YYYYMMDD')}_${course.section_start}`,
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
        displayName: location,
      },
      categories: ['课程表'],
      isAllDay: false,
      // 扩展字段，用于去重和更新
      extensions: {
        source: 'xiqueer',
        courseId: course.course_id || course.id,
        teacher,
        week: course.week || '',
      },
    };
  }

  /**
   * 构建课程描述
   */
  buildCourseDescription(course) {
    const lines = [];

    if (course.teacher_name || course.teacher) {
      lines.push(`教师：${course.teacher_name || course.teacher}`);
    }
    if (course.classroom || course.room_name) {
      lines.push(`教室：${course.classroom || course.room_name}`);
    }
    if (course.section_start && course.section_end) {
      lines.push(`节次：第${course.section_start}-${course.section_end}节`);
    } else if (course.section_start) {
      lines.push(`节次：第${course.section_start}节`);
    }
    if (course.week) {
      lines.push(`周次：${course.week}`);
    }
    if (course.course_type) {
      lines.push(`课程类型：${course.course_type}`);
    }
    if (course.credit) {
      lines.push(`学分：${course.credit}`);
    }

    lines.push('', '--- 来自喜鹊儿课表同步 ---');

    return lines.join('\n');
  }

  /**
   * 获取课程开始时间
   * 不同学校作息时间可能不同，这里提供默认值
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

    return schedule[section] || null;
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

    return schedule[section] || null;
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      await this.login();
      const today = dayjs().format('YYYYMMDD');
      const schedule = await this.getDaySchedule(today);
      return {
        success: true,
        studentId: this.studentId,
        todayCourses: schedule.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = XiqueerService;
