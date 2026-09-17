const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dayjs = require('dayjs');
const logger = require('../utils/logger');

/**
 * 自定义事件和待办服务
 * 支持手动创建、编辑、删除日历事件和待办任务
 * 数据持久化到 data/custom-events.json
 */
class CustomService {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.dataFile = path.join(this.dataDir, 'custom-events.json');
    this.events = [];
    this.todos = [];

    this._initData();
  }

  _initData() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (fs.existsSync(this.dataFile)) {
      try {
        const content = fs.readFileSync(this.dataFile, 'utf-8');
        const data = JSON.parse(content);
        this.events = data.events || [];
        this.todos = data.todos || [];
        logger.info(`已加载自定义数据: ${this.events.length} 个事件, ${this.todos.length} 个待办`);
      } catch (error) {
        logger.error('加载自定义数据失败', { error: error.message });
      }
    }
  }

  _saveData() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      fs.writeFileSync(
        this.dataFile,
        JSON.stringify({ events: this.events, todos: this.todos }, null, 2),
        'utf-8'
      );
      return true;
    } catch (error) {
      logger.error('保存自定义数据失败', { error: error.message });
      return false;
    }
  }

  _generateId() {
    return `custom_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  // ==================== 事件 CRUD ====================

  getEvents() {
    return this.events.sort((a, b) => {
      const aTime = new Date(a.start.dateTime || a.start.date).getTime();
      const bTime = new Date(b.start.dateTime || b.start.date).getTime();
      return aTime - bTime;
    });
  }

  createEvent(data) {
    const event = {
      id: this._generateId(),
      subject: data.subject || '未命名事件',
      body: {
        contentType: 'text',
        content: data.description || data.body?.content || '',
      },
      start: {
        dateTime: data.startDateTime ? data.startDateTime : null,
        date: data.allDay ? data.startDate : null,
        timeZone: 'Asia/Shanghai',
      },
      end: {
        dateTime: data.endDateTime ? data.endDateTime : null,
        date: data.allDay ? data.endDate : null,
        timeZone: 'Asia/Shanghai',
      },
      location: {
        displayName: data.location || '',
      },
      categories: data.categories || ['自定义事件'],
      isAllDay: !!data.allDay,
      showAs: data.showAs || 'busy',
      // 重复规则
      recurrence: data.recurrence || null,
      // 元数据
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 处理时间
    if (!data.allDay) {
      if (data.startDate && data.startTime) {
        event.start.dateTime = `${data.startDate}T${data.startTime}:00`;
      }
      if (data.endDate && data.endTime) {
        event.end.dateTime = `${data.endDate}T${data.endTime}:00`;
      }
    } else {
      event.start.date = data.startDate || dayjs().format('YYYY-MM-DD');
      event.end.date = data.endDate || data.startDate || dayjs().format('YYYY-MM-DD');
    }

    this.events.push(event);
    this._saveData();
    logger.info('创建自定义事件', { id: event.id, subject: event.subject });
    return event;
  }

  updateEvent(id, data) {
    const index = this.events.findIndex(e => e.id === id);
    if (index === -1) return null;

    const event = this.events[index];

    if (data.subject !== undefined) event.subject = data.subject;
    if (data.description !== undefined) event.body.content = data.description;
    if (data.location !== undefined) event.location.displayName = data.location;
    if (data.categories !== undefined) event.categories = data.categories;
    if (data.showAs !== undefined) event.showAs = data.showAs;
    if (data.allDay !== undefined) event.isAllDay = !!data.allDay;

    if (data.recurrence !== undefined) event.recurrence = data.recurrence;

    // 更新时间
    if (!data.allDay) {
      if (data.startDate && data.startTime) {
        event.start.dateTime = `${data.startDate}T${data.startTime}:00`;
        event.start.date = null;
      }
      if (data.endDate && data.endTime) {
        event.end.dateTime = `${data.endDate}T${data.endTime}:00`;
        event.end.date = null;
      }
    } else {
      if (data.startDate) {
        event.start.date = data.startDate;
        event.start.dateTime = null;
      }
      if (data.endDate || data.startDate) {
        event.end.date = data.endDate || data.startDate;
        event.end.dateTime = null;
      }
    }

    event.updatedAt = new Date().toISOString();

    this.events[index] = event;
    this._saveData();
    logger.info('更新自定义事件', { id, subject: event.subject });
    return event;
  }

  deleteEvent(id) {
    const index = this.events.findIndex(e => e.id === id);
    if (index === -1) return false;

    this.events.splice(index, 1);
    this._saveData();
    logger.info('删除自定义事件', { id });
    return true;
  }

  // ==================== 待办 CRUD ====================

  getTodos() {
    return this.todos.sort((a, b) => {
      // 未完成在前，按截止时间排序
      if (a.status !== b.status) return a.status - b.status;
      const aTime = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const bTime = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return aTime - bTime;
    });
  }

  createTodo(data) {
    const todo = {
      id: this._generateId(),
      content: data.content || '未命名待办',
      description: data.description || '',
      dueDate: data.dueDate || null,
      priority: data.priority || 0, // 0普通 1重要 2紧急
      status: 0, // 0未完成 1已完成
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.todos.push(todo);
    this._saveData();
    logger.info('创建自定义待办', { id: todo.id, content: todo.content });
    return todo;
  }

  updateTodo(id, data) {
    const index = this.todos.findIndex(t => t.id === id);
    if (index === -1) return null;

    const todo = this.todos[index];

    if (data.content !== undefined) todo.content = data.content;
    if (data.description !== undefined) todo.description = data.description;
    if (data.dueDate !== undefined) todo.dueDate = data.dueDate;
    if (data.priority !== undefined) todo.priority = data.priority;

    if (data.status !== undefined) {
      todo.status = data.status;
      todo.completedAt = data.status === 1 ? new Date().toISOString() : null;
    }

    todo.updatedAt = new Date().toISOString();

    this.todos[index] = todo;
    this._saveData();
    logger.info('更新自定义待办', { id, content: todo.content });
    return todo;
  }

  deleteTodo(id) {
    const index = this.todos.findIndex(t => t.id === id);
    if (index === -1) return false;

    this.todos.splice(index, 1);
    this._saveData();
    logger.info('删除自定义待办', { id });
    return true;
  }

  // ==================== 同步转换 ====================

  /**
   * 将自定义事件转换为日历事件格式（用于同步到 Exchange）
   */
  getCalendarEvents() {
    const events = [];

    for (const event of this.events) {
      // 如果有重复规则，展开为多个事件
      if (event.recurrence && event.recurrence.type && event.recurrence.type !== 'none') {
        const expanded = this._expandRecurringEvent(event);
        events.push(...expanded);
      } else {
        events.push(this._eventToCalendarEvent(event));
      }
    }

    // 待办也转成日历事件
    for (const todo of this.todos) {
      const todoEvent = this._todoToCalendarEvent(todo);
      if (todoEvent) {
        events.push(todoEvent);
      }
    }

    logger.info('自定义事件转换完成', { total: events.length });
    return events;
  }

  _eventToCalendarEvent(event) {
    return {
      id: event.id,
      subject: event.subject,
      body: event.body,
      start: event.start,
      end: event.end,
      location: event.location,
      categories: event.categories || ['自定义事件'],
      isAllDay: event.isAllDay,
      showAs: event.showAs || 'busy',
      isCancelled: false,
      extensions: {
        source: 'custom',
        eventId: event.id,
        createdAt: event.createdAt,
      },
    };
  }

  _todoToCalendarEvent(todo) {
    if (!todo.content) return null;

    const isCompleted = todo.status === 1;
    let startDateTime, endDateTime;

    if (todo.dueDate) {
      endDateTime = dayjs(todo.dueDate);
      startDateTime = endDateTime.subtract(60, 'minute');
    } else {
      const today = dayjs().hour(9).minute(0).second(0);
      startDateTime = today;
      endDateTime = today.add(60, 'minute');
    }

    const priorityMap = { 0: '普通', 1: '重要', 2: '紧急' };

    return {
      id: `custom_todo_${todo.id}`,
      subject: `[自定义待办] ${todo.content}`,
      body: {
        contentType: 'text',
        content: [
          `待办内容：${todo.content}`,
          '',
          todo.description ? `描述：${todo.description}` : '',
          `状态：${isCompleted ? '已完成' : '未完成'}`,
          `优先级：${priorityMap[todo.priority] || '普通'}`,
          todo.dueDate ? `截止时间：${dayjs(todo.dueDate).format('YYYY-MM-DD HH:mm')}` : '',
          '',
          '--- 来自自定义待办同步 ---',
        ].filter(Boolean).join('\n'),
      },
      start: {
        dateTime: startDateTime.format('YYYY-MM-DDTHH:mm:ss'),
        timeZone: 'Asia/Shanghai',
      },
      end: {
        dateTime: endDateTime.format('YYYY-MM-DDTHH:mm:ss'),
        timeZone: 'Asia/Shanghai',
      },
      location: { displayName: '' },
      categories: ['自定义待办'],
      isAllDay: false,
      showAs: isCompleted ? 'free' : 'busy',
      isCancelled: isCompleted,
      extensions: {
        source: 'custom',
        todoId: todo.id,
        status: todo.status,
      },
    };
  }

  /**
   * 展开重复事件为未来N天的多个事件
   */
  _expandRecurringEvent(event, daysAhead = 30) {
    const events = [];
    const startDate = dayjs(event.start.dateTime || event.start.date);
    const endDate = dayjs();

    const rule = event.recurrence;
    if (!rule || !rule.type || rule.type === 'none') {
      return [this._eventToCalendarEvent(event)];
    }

    const count = rule.count || daysAhead;
    let current = startDate.clone();
    let duration = 0;

    if (event.end.dateTime && event.start.dateTime) {
      duration = dayjs(event.end.dateTime).diff(dayjs(event.start.dateTime), 'minute');
    }

    for (let i = 0; i < count; i++) {
      if (current.isAfter(dayjs().add(daysAhead, 'day'))) break;

      const expandedEvent = JSON.parse(JSON.stringify(this._eventToCalendarEvent(event)));
      expandedEvent.id = `${event.id}_${i}`;
      expandedEvent.start = {
        dateTime: current.format('YYYY-MM-DDTHH:mm:ss'),
        timeZone: 'Asia/Shanghai',
      };

      if (duration > 0) {
        const endTime = current.add(duration, 'minute');
        expandedEvent.end = {
          dateTime: endTime.format('YYYY-MM-DDTHH:mm:ss'),
          timeZone: 'Asia/Shanghai',
        };
      } else {
        expandedEvent.end = { ...expandedEvent.start };
      }

      expandedEvent.extensions.recurrenceIndex = i;
      events.push(expandedEvent);

      // 根据重复规则递增
      switch (rule.type) {
        case 'daily':
          current = current.add(rule.interval || 1, 'day');
          break;
        case 'weekly':
          current = current.add((rule.interval || 1) * 7, 'day');
          break;
        case 'monthly':
          current = current.add(rule.interval || 1, 'month');
          break;
        default:
          current = current.add(1, 'day');
      }
    }

    return events;
  }

  /**
   * 测试连接（返回数据统计）
   */
  testConnection() {
    return {
      success: true,
      events: this.events.length,
      todos: this.todos.length,
      activeTodos: this.todos.filter(t => t.status === 0).length,
    };
  }
}

// 单例
let instance = null;

function getCustomService() {
  if (!instance) {
    instance = new CustomService();
  }
  return instance;
}

module.exports = { CustomService, getCustomService };
