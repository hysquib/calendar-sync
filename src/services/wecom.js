const axios = require('axios');
const dayjs = require('dayjs');
const logger = require('../utils/logger');

/**
 * 企业微信待办服务
 * 用于从企业微信获取待办事项并转换为日历事件
 *
 * API 文档: https://developer.work.weixin.qq.com/document/path/96210
 */
class WeComTodoService {
  constructor(config) {
    this.corpId = config.corpId;
    this.secret = config.secret;
    this.agentId = config.agentId;
    this.userIds = config.userIds || [];
    this.todoDuration = config.todoDuration || 60; // 默认待办时长60分钟

    this.accessToken = null;
    this.tokenExpiresAt = 0;

    this.api = axios.create({
      baseURL: 'https://qyapi.weixin.qq.com',
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * 获取 access_token
   */
  async getAccessToken() {
    const now = Date.now();

    // token 还有效（提前5分钟刷新）
    if (this.accessToken && now < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.accessToken;
    }

    try {
      logger.info('正在获取企业微信 access_token...');

      const response = await this.api.get('/cgi-bin/gettoken', {
        params: {
          corpid: this.corpId,
          corpsecret: this.secret,
        },
      });

      if (response.data.errcode === 0) {
        this.accessToken = response.data.access_token;
        this.tokenExpiresAt = now + response.data.expires_in * 1000;
        logger.info('企业微信 access_token 获取成功');
        return this.accessToken;
      }

      logger.error('获取企业微信 access_token 失败', {
        errcode: response.data.errcode,
        errmsg: response.data.errmsg,
      });
      throw new Error(`获取 access_token 失败: ${response.data.errmsg}`);
    } catch (error) {
      logger.error('获取企业微信 access_token 异常', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取用户的待办列表
   * @param {string} userId - 用户ID
   * @param {number} offset - 偏移量
   * @param {number} limit - 数量限制
   */
  async getTodoList(userId, offset = 0, limit = 100) {
    const accessToken = await this.getAccessToken();

    try {
      const response = await this.api.post('/cgi-bin/oa/gettodolist', {
        access_token: accessToken,
      }, {
        params: {
          userid: userId,
          offset,
          limit,
        },
      });

      // 注意：企业微信的API有两种调用方式，参数可能在 query 或 body 中
      // 这里使用 query 参数方式

      if (response.data.errcode === 0) {
        return response.data.todo_list || response.data.data?.todo_list || [];
      }

      logger.warn('获取待办列表失败', {
        userId,
        errcode: response.data.errcode,
        errmsg: response.data.errmsg,
      });

      // 如果 token 无效，刷新后重试
      if (response.data.errcode === 40014 || response.data.errcode === 42001) {
        this.accessToken = null;
        return this.getTodoList(userId, offset, limit);
      }

      return [];
    } catch (error) {
      logger.error('获取待办列表异常', { userId, error: error.message });
      return [];
    }
  }

  /**
   * 获取待办详情
   * @param {string} userId - 用户ID
   * @param {string} todoId - 待办ID
   */
  async getTodoDetail(userId, todoId) {
    const accessToken = await this.getAccessToken();

    try {
      const response = await this.api.get('/cgi-bin/oa/todo/get', {
        params: {
          access_token: accessToken,
          userid: userId,
          todoid: todoId,
        },
      });

      if (response.data.errcode === 0) {
        return response.data.todo_item || response.data.data || null;
      }

      logger.warn('获取待办详情失败', {
        userId,
        todoId,
        errcode: response.data.errcode,
        errmsg: response.data.errmsg,
      });

      return null;
    } catch (error) {
      logger.error('获取待办详情异常', { userId, todoId, error: error.message });
      return null;
    }
  }

  /**
   * 获取用户所有待办事项（分页获取）
   * @param {string} userId - 用户ID
   */
  async getAllTodos(userId) {
    const allTodos = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const todos = await this.getTodoList(userId, offset, limit);
      if (!todos || todos.length === 0) break;

      allTodos.push(...todos);

      if (todos.length < limit) break;
      offset += limit;

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return allTodos;
  }

  /**
   * 获取所有配置用户的待办并转换为日历事件
   * @returns {Array} 日历事件数组
   */
  async getCalendarEvents() {
    logger.info('开始获取企业微信待办数据', { userIds: this.userIds });

    const events = [];

    for (const userId of this.userIds) {
      try {
        const todos = await this.getAllTodos(userId);
        logger.info(`用户 ${userId} 获取到 ${todos.length} 条待办`);

        for (const todo of todos) {
          const event = this.todoToEvent(todo, userId);
          if (event) {
            events.push(event);
          }
        }
      } catch (error) {
        logger.error('获取用户待办失败', { userId, error: error.message });
      }
    }

    logger.info('企业微信待办获取完成', { eventCount: events.length });
    return events;
  }

  /**
   * 将待办事项转换为日历事件格式
   * @param {Object} todo - 待办数据
   * @param {string} userId - 用户ID
   */
  todoToEvent(todo, userId) {
    if (!todo || !todo.content) return null;

    // 待办状态：0-未完成，1-已完成
    const status = todo.status ?? todo.todo_status;
    const isCompleted = status === 1;

    // 截止时间
    const endTime = todo.end_time || todo.due_time || todo.endTime;
    const startTime = todo.start_time || todo.begin_time || todo.startTime;

    let startDateTime;
    let endDateTime;

    if (endTime) {
      // 有截止时间，以截止时间为结束时间，往前推默认时长
      endDateTime = dayjs.unix(endTime);
      startDateTime = endDateTime.subtract(this.todoDuration, 'minute');
    } else if (startTime) {
      startDateTime = dayjs.unix(startTime);
      endDateTime = startDateTime.add(this.todoDuration, 'minute');
    } else {
      // 没有时间的待办，放到今天工作时间
      const today = dayjs().hour(9).minute(0).second(0);
      startDateTime = today;
      endDateTime = today.add(this.todoDuration, 'minute');
    }

    // 参与人
    const attendees = (todo.attendees || todo.attendee_list || [])
      .map(a => ({
        emailAddress: {
          name: a.userid || a.name || '',
          address: a.userid ? `${a.userid}@wecom.local` : '',
        },
      }))
      .filter(a => a.emailAddress.name);

    return {
      id: `wecom_todo_${todo.todo_id || todo.id}_${userId}`,
      subject: `[待办] ${todo.content}`,
      body: {
        contentType: 'text',
        content: this.buildTodoDescription(todo, userId),
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
        displayName: '',
      },
      categories: ['企业待办'],
      isAllDay: false,
      // 已完成的待办标记为取消状态
      showAs: isCompleted ? 'free' : 'busy',
      isCancelled: isCompleted,
      attendees,
      // 扩展字段
      extensions: {
        source: 'wecom',
        todoId: todo.todo_id || todo.id,
        userId,
        status,
        priority: todo.priority || todo.priority_level || 0,
      },
    };
  }

  /**
   * 构建待办描述
   */
  buildTodoDescription(todo, userId) {
    const lines = [];

    lines.push(`待办内容：${todo.content}`);
    lines.push('');

    if (todo.description || todo.desc) {
      lines.push(`描述：${todo.description || todo.desc}`);
      lines.push('');
    }

    const status = todo.status ?? todo.todo_status;
    const statusText = status === 1 ? '已完成' : '未完成';
    lines.push(`状态：${statusText}`);

    if (todo.priority || todo.priority_level) {
      const priorityMap = { 0: '普通', 1: '重要', 2: '紧急' };
      lines.push(`优先级：${priorityMap[todo.priority || todo.priority_level] || '普通'}`);
    }

    if (todo.end_time || todo.due_time) {
      const dueDate = dayjs.unix(todo.end_time || todo.due_time);
      lines.push(`截止时间：${dueDate.format('YYYY-MM-DD HH:mm')}`);
    }

    if (todo.creator || todo.creator_userid) {
      lines.push(`创建人：${todo.creator || todo.creator_userid}`);
    }

    if (todo.attendees && todo.attendees.length > 0) {
      const attendeeNames = todo.attendees.map(a => a.userid || a.name).join(', ');
      lines.push(`参与人：${attendeeNames}`);
    }

    lines.push('', '--- 来自企业微信待办同步 ---');

    return lines.join('\n');
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      const token = await this.getAccessToken();
      return {
        success: true,
        hasToken: !!token,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = WeComTodoService;
