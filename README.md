# 日历同步服务 Calendar Sync

> 将喜鹊儿课表、教务系统课表、企业微信待办、自定义事件一键同步到 iOS 日历

[![GitHub](https://img.shields.io/badge/Gituthub-hysquib/calendar--sync-181717?logo=github)](https://github.com/hysquib/calendar-sync)
[![Docker](https://img.shields.io/badge/Docker-✓-2496ED?logo=docker)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js)](https://nodejs.org/)
[![CalDAV](https://img.shields.io/badge/CalDAV-✓-667eea)](https://datatracker.ietf.org/doc/html/rfc4791)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

**GitHub 仓库**: https://github.com/hysquib/calendar-sync

---

## 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [架构概览](#架构概览)
- [快速部署](#快速部署)
- [使用教程](#使用教程)
- [iOS 日历配置](#ios-日历配置)
- [配置参考](#配置参考)
- [API 接口文档](#api-接口文档)
- [Nginx 反向代理](#nginx-反向代理配置https)
- [常见问题](#常见问题)
- [运维指南](#运维指南)
- [项目结构](#项目结构)
- [技术栈](#技术栈)

---

## 项目简介

这是一个部署在私有服务器上的日历同步服务，支持将多种课表和待办数据源同步到自建的 CalDAV 日历服务器。iOS 设备通过原生 CalDAV 账户即可实时查看同步的日历事件，无需安装任何第三方 App。

### 支持的数据源

| 数据源 | 说明 | 同步方式 |
|--------|------|----------|
| 喜鹊儿课表 | 通过喜鹊儿 API 获取课程表 | API 自动同步 |
| 教务系统课表 | 通过浏览器抓取教务系统课表（支持青果 KINGOSOFT） | 本地导入 + 缓存同步 |
| 企业微信待办 | 通过企业微信 API 获取待办事项 | API 自动同步 |
| 自定义事件 | 手动创建的日历事件和待办 | 管理后台 CRUD |

### 同步目标

| 目标 | 说明 | 推荐度 |
|------|------|--------|
| **CalDAV（推荐）** | 自建 Radicale 服务器，iOS 原生支持，零成本，数据完全自主 | ★★★★★ |
| Microsoft Exchange | 通过 Microsoft Graph API 同步到 Outlook/Exchange | ★★★☆☆ |

---

## 功能特性

- **多数据源聚合**：喜鹊儿、教务系统、企业微信待办、自定义事件统一同步
- **CalDAV 自建服务器**：内置 Radicale，无需第三方依赖，数据完全自主可控
- **教务系统课表导入**：支持浏览器抓取代码 + MHTML/HTML 文件上传，不依赖校园网持续连接
- **课表缓存机制**：导入的课表数据本地缓存，断网也能正常同步
- **课程教室标注**：日历事件标题自动包含教室信息，一目了然
- **可视化管理后台**：响应式 Web 界面，支持移动端访问，统一设计风格
- **定时自动同步**：Cron 表达式自定义同步频率，配置变更即时生效
- **自定义事件管理**：支持日历事件和待办的增删改查，支持重复规则
- **iOS 原生兼容**：CalDAV 协议，iOS 日历开箱即用
- **安全认证**：管理后台密码保护，API Token 鉴权，敏感信息掩码
- **增量同步**：基于事件 ID 去重，重复导入不会产生重复事件

---

## 架构概览

```
┌──────────────────────────────────────────────────────────┐
│                     iOS 设备 / 其他客户端                  │
│              (通过 CalDAV 协议订阅日历)                    │
└────────────────────────┬─────────────────────────────────┘
                         │ CalDAV (HTTPS)
┌────────────────────────▼─────────────────────────────────┐
│                  Docker 容器集群                           │
│                                                          │
│  ┌──────────────────┐       ┌──────────────────────┐    │
│  │  calendar-sync   │──────▶│     radicale         │    │
│  │  (Node.js 应用)   │ HTTP  │  (CalDAV 服务器)     │    │
│  │                  │       │                      │    │
│  │  - 管理后台 :3000 │       │  - CalDAV 服务 :5232 │    │
│  │  - 同步引擎       │       │  - 用户认证          │    │
│  │  - API 接口       │       │  - 日历存储          │    │
│  │  - WebSocket      │       │                      │    │
│  └────────┬─────────┘       └──────────────────────┘    │
│           │                                              │
└───────────┼──────────────────────────────────────────────┘
            │
   ┌────────┼────────┬────────────────┐
   ▼        ▼        ▼                ▼
 喜鹊儿API  教务系统  企业微信API    自定义事件
 (课表)    (课表缓存)  (待办)       (本地存储)
```

---

## 快速部署

### 环境要求

- Linux 服务器（推荐 Debian/Ubuntu）
- Docker + Docker Compose
- 1GB 以上可用内存
- 开放端口：3000（管理后台）、5232（CalDAV）

### 方式一：一键部署（推荐）

```bash
# 1. 克隆项目到服务器
git clone https://github.com/hysquib/calendar-sync.git /www/wwwroot/calendar-sync
cd /www/wwwroot/calendar-sync

# 2. 运行部署脚本（自动安装 Docker、部署文件、放行端口、启动服务）
chmod +x deploy.sh
./deploy.sh
```

部署脚本会自动完成：
1. 检查并安装 Docker 和 Docker Compose
2. 部署项目文件到 `/www/wwwroot/calendar-sync`
3. 放行 3000 和 5232 端口（ufw / iptables / 宝塔面板）
4. 构建 Docker 镜像并启动服务
5. 验证服务状态并输出部署信息

### 方式二：手动部署

```bash
# 1. 克隆项目
git clone https://github.com/hysquib/calendar-sync.git calendar-sync
cd calendar-sync

# 2. 复制环境配置文件
cp .env.example .env
# 编辑 .env 填写配置（或稍后在管理后台可视化配置）

# 3. 构建并启动
docker compose build
docker compose up -d

# 4. 检查服务状态
docker compose ps
```

### 部署后验证

```bash
# 健康检查（返回 JSON 状态信息）
curl http://localhost:3000/health

# 查看应用日志
docker compose logs -f calendar-sync

# 查看 CalDAV 服务器日志
docker compose logs -f radicale
```

---

## 使用教程

### 第一步：登录管理后台

1. 打开浏览器访问 `http://你的服务器IP:3000/`
2. 输入默认密码 `admin123` 登录

> **安全提示**：请登录后立即在「同步配置 → 通用设置」中修改管理密码。

### 第二步：确认 CalDAV 配置

默认已配置好自建 Radicale CalDAV 服务器，通常无需修改。如需自定义：

1. 进入「同步配置 → CalDAV」标签页
2. 确认以下配置：
   - 服务器地址：`http://radicale:5232/`（Docker 内部通信地址，不要改）
   - 用户名：`admin`
   - 密码：`admin123`
3. 点击「保存配置」

> 如果需要通过域名或 HTTPS 访问 CalDAV，请参考 [Nginx 反向代理](#nginx-反向代理配置https) 章节。

### 第三步：设置同步周期

1. 进入「同步配置 → 通用设置」标签页
2. 同步目标选择 `CalDAV（推荐，自建服务器）`
3. 设置同步周期（Cron 表达式，默认每小时一次）
4. 点击「保存配置」

> 配置保存后会立即生效，无需重启服务。

### 第四步：导入教务系统课表

> 适用于使用青果 KINGOSOFT 教务系统的学校。导入后数据会缓存到服务器，后续同步不依赖校园网连接。

1. 进入「教务系统」页面
2. **填写基本信息**：
   - 教务系统地址：`https://jw.yourschool.edu.cn/jwxt`（到根路径，不含 `/cas/login.action`）
   - 学号
   - 学期开始日期（第一周周一的日期，影响日期转换准确性）
3. **获取课表数据**（三种方式任选其一）：

   **方式 A：控制台抓取（推荐）**
   - 在校园网环境下登录教务系统，进入课表页面
   - 点击管理后台的「获取抓取代码」按钮复制代码
   - 在教务系统课表页面按 `F12` 打开开发者工具 → Console 标签
   - 粘贴代码并回车执行，课表将自动上传到服务器

   **方式 B：直接打开课表页**
   - 点击「直接打开课表页」按钮（如果教务系统可访问）
   - 系统会自动抓取并导入

   **方式 C：上传 HTML 文件**
   - 在教务系统课表页面按 `Ctrl+S` 保存为 MHTML 或 HTML 文件
   - 在管理后台上传该文件

4. 导入成功后会显示课程数量和事件数量
5. 课表数据缓存到 `data/jwxt-schedule-cache.json`，后续同步自动读取

> **重复导入不会产生重复事件**：同步引擎使用事件 ID（课程名+日期+节次）做去重，同一课程只会保留一个事件。

### 第五步：配置喜鹊儿课表（可选）

1. 进入「同步配置 → 喜鹊儿课表」标签页
2. 填写喜鹊儿登录账号、密码、学校名称
3. 点击「保存配置」

### 第六步：配置企业微信待办（可选）

1. 进入「同步配置 → 企业微信」标签页
2. 填写企业微信企业ID、应用Secret、AgentId
3. 填写待办同步的用户ID（多个用逗号分隔）
4. 点击「保存配置」

> 企业微信 API 文档：https://developer.work.weixin.qq.com/document/path/96210

### 第七步：创建自定义事件

1. 进入「自定义事件」页面
2. 点击「+ 新建事件」创建日历事件
   - 支持设置标题、描述、地点、时间
   - 支持全天事件、忙碌/空闲状态
   - 支持重复规则（每日/每周/每月）
3. 切换到「待办任务」标签创建待办
   - 支持优先级（普通/重要/紧急）
   - 待办会自动转换为日历事件同步

### 第八步：手动触发同步

1. 进入「仪表盘」页面
2. 点击「立即同步」按钮
3. 查看同步结果详情（创建/更新/删除/错误统计）
4. 也可点击「测试连接」验证各数据源连通性

---

## iOS 日历配置

### 通过 CalDAV 添加日历（推荐）

1. 在 iPhone/iPad 上打开「设置」
2. 进入「日历」→「账户」→「添加账户」
3. 选择「其他」→「添加 CalDAV 账户」
4. 填写以下信息：
   - **服务器**：`http://你的服务器IP:5232/`（含尾部斜杠）
   - **用户名**：`admin`
   - **密码**：`admin123`
   - **描述**：我的日历（自定义）
5. 点击「下一步」验证，然后保存
6. 打开「日历」App，稍等片刻即可看到同步的课程表和事件
7. 在日历 App 底部点击「日历」，确保勾选了新添加的日历

### 通过 HTTPS 访问（推荐生产环境）

如果配置了 Nginx 反向代理 + SSL 证书：

1. iOS 设置中 CalDAV 服务器填写：`https://caldav.yourdomain.com/`
2. 其余配置不变

> **HTTPS 提示**：iOS 对 HTTPS CalDAV 支持更好，建议配置 SSL 证书。参考 [Nginx 反向代理](#nginx-反向代理配置https) 章节。

### 验证 CalDAV 连接

在终端中执行以下命令验证 CalDAV 服务器是否正常：

```bash
# 测试连接（应返回 302 重定向）
curl -v -u admin:admin123 http://localhost:5232/

# 测试 PROPFIND（应返回 207 Multi-Status）
curl -v -u admin:admin123 \
  -X PROPFIND \
  -H "Depth: 0" \
  -H "Content-Type: application/xml" \
  --data '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>' \
  http://localhost:5232/admin/
```

---

## 配置参考

### 环境变量 (.env)

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `3000` | 管理后台端口 |
| `SYNC_CRON` | `0 * * * *` | 同步频率（Cron 表达式） |
| `TIMEZONE` | `Asia/Shanghai` | 时区 |
| `ADMIN_PASSWORD` | `admin123` | 管理后台密码 |
| `CALDAV_ENABLED` | `true` | 启用 CalDAV |
| `CALDAV_SERVER_URL` | `http://radicale:5232/` | CalDAV 服务器地址 |
| `CALDAV_USERNAME` | `admin` | CalDAV 用户名 |
| `CALDAV_PASSWORD` | `admin123` | CalDAV 密码 |
| `CALDAV_DEFAULT_CALENDAR` | `calendar` | 默认日历名称 |
| `SYNC_TARGET` | `caldav` | 同步目标（caldav / graph） |
| `XIQUEER_USERNAME` | - | 喜鹊儿账号 |
| `XIQUEER_PASSWORD` | - | 喜鹊儿密码 |
| `XIQUEER_SCHOOL` | - | 学校名称 |
| `JWXT_BASE_URL` | - | 教务系统地址 |
| `JWXT_USERNAME` | - | 学号 |
| `WECOM_CORP_ID` | - | 企业微信企业ID |
| `WECOM_SECRET` | - | 企业微信应用Secret |
| `WECOM_AGENT_ID` | - | 企业微信应用AgentId |
| `WECOM_USER_IDS` | - | 待办同步用户ID（逗号分隔） |
| `MS_GRAPH_CLIENT_ID` | - | Azure AD 应用客户端ID |
| `MS_GRAPH_CLIENT_SECRET` | - | Azure AD 应用密钥 |
| `MS_GRAPH_TENANT_ID` | - | Azure AD 租户ID |
| `MS_GRAPH_USER_EMAIL` | - | 同步目标邮箱 |

> **提示**：环境变量仅在首次启动时使用。后续配置保存在 `data/config.json` 中，通过管理后台修改会覆盖环境变量值。

### Cron 表达式示例

| 表达式 | 说明 |
|--------|------|
| `0 * * * *` | 每小时整点同步 |
| `0 */30 * * *` | 每30分钟同步 |
| `0 8 * * *` | 每天早上8点同步 |
| `0 8,12,18 * * *` | 每天8点、12点、18点同步 |
| `0 8 * * 1-5` | 工作日早上8点同步 |
| `0 */6 * * *` | 每6小时同步 |

### 课表时间映射

默认作息时间表（可在 `src/services/jwxt.js` 的 `getCourseStartTime` 和 `getCourseEndTime` 方法中修改）：

| 节次 | 开始时间 | 结束时间 |
|------|----------|----------|
| 第1节 | 08:00 | 08:45 |
| 第2节 | 08:50 | 09:35 |
| 第3节 | 10:00 | 10:45 |
| 第4节 | 10:50 | 11:35 |
| 第5节 | 14:00 | 14:45 |
| 第6节 | 14:50 | 15:35 |
| 第7节 | 16:00 | 16:45 |
| 第8节 | 16:50 | 17:35 |
| 第9节 | 19:00 | 19:45 |
| 第10节 | 19:50 | 20:35 |
| 第11节 | 20:40 | 21:25 |
| 第12节 | 21:30 | 21:35 |

### 日历事件格式

同步到 CalDAV 的事件使用标准 iCalendar (ICS) 格式：

- **事件标题**：课程名 @ 教室（自动包含教室信息）
- **事件描述**：教师、教室、节次、周次、课程类型、班级
- **事件位置**：教室名称
- **来源标记**：通过 `X-CALSYNC-SOURCE` 和 `X-CALSYNC-ID` 自定义字段标识同步来源，用于增量更新和去重

---

## API 接口文档

所有 API（除 `/health` 和 `/api/jwxt-import/*`）需要认证。认证方式：Cookie 或 `Authorization: Bearer <token>`。

### 认证

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | `/api/auth/login` | 登录获取 Token | `{ "password": "admin123" }` |
| POST | `/api/auth/logout` | 登出 | - |
| POST | `/api/auth/password` | 修改密码 | `{ "oldPassword": "...", "newPassword": "..." }` |

### 同步管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sync/status` | 获取同步状态和服务状态 |
| POST | `/api/sync/trigger` | 触发立即同步 |
| POST | `/api/sync/test` | 测试所有数据源连接 |

### 配置管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 获取配置（敏感信息已掩码） |
| POST | `/api/config` | 更新配置（掩码字段不会覆盖原值） |

### 自定义事件

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/custom/events` | 获取所有事件 |
| POST | `/api/custom/events` | 创建事件 |
| PUT | `/api/custom/events/:id` | 更新事件 |
| DELETE | `/api/custom/events/:id` | 删除事件 |
| POST | `/api/custom/events/batch-delete` | 批量删除 |

### 自定义待办

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/custom/todos` | 获取所有待办 |
| POST | `/api/custom/todos` | 创建待办 |
| PUT | `/api/custom/todos/:id` | 更新待办 |
| DELETE | `/api/custom/todos/:id` | 删除待办 |

### 教务系统导入

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/jwxt-import/schedule` | 导入课表 HTML/MHTML |
| GET | `/api/jwxt-import/snippet` | 获取控制台抓取代码 |

### 浏览器自动化

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/browser/start` | 启动浏览器页面 |
| POST | `/api/browser/:pageId/click` | 模拟点击 |
| POST | `/api/browser/:pageId/type` | 模拟输入 |
| POST | `/api/browser/:pageId/navigate` | 导航到 URL |
| GET | `/api/browser/:pageId/screenshot` | 获取截图 |
| GET | `/api/browser/:pageId/cookies` | 获取 Cookie |
| POST | `/api/browser/:pageId/close` | 关闭页面 |
| WS | `/api/browser/ws` | WebSocket 实时交互 |

### 日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs?type=combined&lines=100` | 获取日志（type: combined/error） |
| DELETE | `/api/logs` | 清空日志 |

### 健康检查

```bash
GET /health
```

无需认证，返回服务状态和各数据源启用情况。

---

## Nginx 反向代理配置（HTTPS）

如果需要通过 HTTPS 访问（iOS CalDAV 推荐使用 HTTPS），配置 Nginx 反向代理：

```nginx
# CalDAV 反向代理
server {
    listen 443 ssl http2;
    server_name caldav.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:5232;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # CalDAV 必须传递 Authorization 头
        proxy_pass_request_headers on;

        # 支持 PROPFIND、REPORT、MKCALENDAR 等 CalDAV 方法
        proxy_method $request_method;

        # 支持大请求体（课表导入）
        client_max_body_size 50m;

        # CalDAV 长连接超时设置
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
    }
}

# 管理后台反向代理
server {
    listen 443 ssl http2;
    server_name admin.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 支持 WebSocket（浏览器自动化功能需要）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        client_max_body_size 50m;
    }
}
```

### CDN 注意事项

> **重要**：如果使用 Cloudflare 等 CDN，请确保 CDN 不会拦截 CalDAV 的 PROPFIND、REPORT、MKCALENDAR 等 HTTP 方法。建议对 CalDAV 域名关闭 CDN 代理（Cloudflare 中设置为 DNS only / 灰色云朵），否则可能导致 iOS 无法连接或认证失败。

---

## 常见问题

### Q: iOS 添加 CalDAV 账户提示"无法验证"？

1. 确认服务器地址正确（必须含尾部斜杠 `/`）
2. 确认用户名密码与 Radicale 配置一致
3. 检查服务器 5232 端口是否开放（防火墙 + 云服务商安全组）
4. 如果使用域名，检查 DNS 解析和 Nginx 反代配置
5. 尝试在 iOS 的 CalDAV 高级设置中关闭 SSL（如果使用 HTTP）
6. 在服务器上验证 CalDAV 是否正常：
   ```bash
   curl -v -u admin:admin123 http://localhost:5232/
   ```
7. 查看 Radicale 日志排查：
   ```bash
   docker compose logs radicale
   ```

### Q: CalDAV 同步报 401 认证失败？

1. 检查管理后台「同步配置 → CalDAV」中的密码是否正确
2. 确认 Radicale 的 users 文件中的密码与配置一致
3. 如果通过 Nginx 反代，确保配置了 `proxy_pass_request_headers on`
4. 重启服务使配置生效：
   ```bash
   docker compose restart
   ```

### Q: 教务系统课表导入失败？

1. 确保在校园网环境下登录教务系统
2. 确保课表页面已完全加载后再执行抓取代码
3. 尝试使用「上传 HTML 文件」方式导入
4. 检查学期开始日期是否正确（影响日期转换）
5. 查看管理后台「同步日志」排查错误
6. 确认教务系统地址格式正确（不含 `/cas/login.action` 后缀）

### Q: 同步后 iOS 日历没有显示事件？

1. 在 iOS 日历 App 中检查是否勾选了新添加的日历
2. 下拉刷新日历强制同步
3. 检查管理后台「仪表盘」的同步结果
4. 查看 CalDAV 服务器是否有数据：
   ```bash
   docker compose logs radicale
   ```
5. 确认事件日期在可见范围内（iOS 默认只显示近期待办和近期事件）
6. 等待几分钟，iOS CalDAV 同步有延迟

### Q: 重新导入课表会出现重复事件吗？

不会。同步引擎使用事件 ID（格式：`jwxt_课程名_日期_起始节次`）做去重。同一课程在同一时间段只会保留一个事件。重复导入会更新已有事件而非创建新事件。

### Q: 教务系统课表需要持续连接校园网吗？

不需要。课表数据在导入时缓存到服务器的 `data/jwxt-schedule-cache.json` 文件中。后续同步自动从缓存读取，不依赖教务系统在线连接。如需更新课表，重新导入即可。

### Q: 如何修改 Radicale CalDAV 用户密码？

**方法一：使用 plain 加密（简单）**

```bash
cd /www/wwwroot/calendar-sync

# 修改 Radicale 配置使用 plain 加密
sed -i 's/htpasswd_encryption = bcrypt/htpasswd_encryption = plain/' radicale/config/config

# 写入新密码（替换 your_password）
echo "admin:your_password" > radicale/config/users

# 重启 Radicale
docker compose restart radicale

# 同时在管理后台「同步配置 → CalDAV」中更新密码
```

**方法二：使用 bcrypt 加密（更安全）**

```bash
cd /www/wwwroot/calendar-sync

# 在宿主机生成 bcrypt 哈希（需要 htpasswd 工具）
htpasswd -bnBC 12 admin your_password > radicale/config/users

# 或使用 Python 生成（需要 passlib）
pip3 install passlib --break-system-packages
python3 -c "from passlib.hash import bcrypt; print('admin:' + bcrypt.using(rounds=12).hash('your_password'))" > radicale/config/users

# 重启 Radicale
docker compose restart radicale
```

> 修改密码后，记得在管理后台「同步配置 → CalDAV」和 iOS 设备的 CalDAV 账户中同步更新密码。

### Q: 服务无法启动怎么办？

```bash
# 查看应用日志
docker compose logs calendar-sync

# 查看 CalDAV 日志
docker compose logs radicale

# 常见问题排查
# 1. 端口被占用
lsof -i:3000
lsof -i:5232

# 2. 配置文件错误（检查是否为合法 JSON）
cat data/config.json | python3 -m json.tool

# 3. 权限问题
chown -R 1000:1000 data/ logs/

# 4. 内存不足
docker stats

# 5. 重新构建镜像
docker compose build --no-cache
docker compose up -d
```

### Q: 喜鹊儿课表同步失败？

1. 确认喜鹊儿账号密码正确
2. 确认学校名称与喜鹊儿中显示的完全一致
3. 检查网络连接
4. 查看同步日志中的具体错误信息
5. 尝试在管理后台「测试连接」验证

### Q: 企业微信待办同步失败？

1. 确认企业ID、Secret、AgentId 正确
2. 确认企业微信应用有待办权限
3. 确认 userIds 正确（企业微信后台 → 通讯录 → 成员详情 → 账号）
4. 检查 IP 白名单是否包含服务器 IP

---

## 运维指南

### 备份数据

```bash
# 备份配置和课表缓存
cp -r /www/wwwroot/calendar-sync/data/ /backup/calendar-sync-data-$(date +%Y%m%d)/

# 备份 CalDAV 日历数据
cp -r /www/wwwroot/calendar-sync/radicale/data/ /backup/radicale-data-$(date +%Y%m%d)/
```

### 恢复数据

```bash
# 恢复配置和课表缓存
cp -r /backup/calendar-sync-data-YYYYMMDD/* /www/wwwroot/calendar-sync/data/

# 恢复 CalDAV 日历数据
cp -r /backup/radicale-data-YYYYMMDD/* /www/wwwroot/calendar-sync/radicale/data/

# 重启服务
cd /www/wwwroot/calendar-sync
docker compose restart
```

### 更新服务

```bash
cd /www/wwwroot/calendar-sync

# 拉取最新代码
git pull origin main

# 重新构建并启动
docker compose build
docker compose up -d

# 查看日志确认启动正常
docker compose logs -f calendar-sync
```

### 常用命令速查

| 操作 | 命令 |
|------|------|
| 查看状态 | `docker compose ps` |
| 查看日志 | `docker compose logs -f calendar-sync` |
| 查看 CalDAV 日志 | `docker compose logs -f radicale` |
| 重启服务 | `docker compose restart` |
| 停止服务 | `docker compose down` |
| 重新构建 | `docker compose build --no-cache && docker compose up -d` |
| 进入容器 | `docker exec -it calendar-sync sh` |
| 查看配置 | `docker exec calendar-sync cat /app/data/config.json` |
| 查看课表缓存 | `docker exec calendar-sync cat /app/data/jwxt-schedule-cache.json \| head -50` |
| 检查端口 | `lsof -i:3000 && lsof -i:5232` |

### 安全建议

1. **修改默认密码**：部署后立即修改管理后台密码和 CalDAV 密码
2. **启用 HTTPS**：通过 Nginx 反向代理配置 SSL 证书
3. **限制访问**：在防火墙层面限制 3000 端口的访问来源
4. **定期备份**：定期备份 `data/` 目录和 Radicale 数据
5. **更新依赖**：定期更新 Docker 镜像和依赖包
6. **关闭 CDN**：CalDAV 域名不要使用 CDN 代理，避免 HTTP 方法被拦截

---

## 项目结构

```
calendar-sync/
├── src/
│   ├── config/
│   │   └── index.js              # 配置入口（动态获取最新配置）
│   ├── routes/
│   │   ├── admin.js              # 管理 API（认证/配置/同步/事件/日志）
│   │   ├── browser.js            # 浏览器自动化 API + WebSocket
│   │   └── jwxt-import.js        # 教务系统课表导入 API
│   ├── services/
│   │   ├── xiqueer.js            # 喜鹊儿课表服务
│   │   ├── jwxt.js               # 教务系统服务（MHTML 解析/课表转换）
│   │   ├── wecom.js              # 企业微信待办服务
│   │   ├── caldav.js             # CalDAV 日历同步服务
│   │   ├── graph.js              # Microsoft Graph 日历服务
│   │   └── custom.js            # 自定义事件/待办服务
│   ├── sync/
│   │   ├── sync.js               # 同步管理器（协调所有数据源）
│   │   └── scheduler.js          # 定时任务调度器
│   ├── utils/
│   │   ├── configManager.js      # 配置管理器（文件读写/热更新/掩码）
│   │   ├── auth.js               # 认证中间件（Token 生成/验证）
│   │   ├── browserManager.js     # Puppeteer 浏览器管理
│   │   └── logger.js             # 日志组件（Winston）
│   └── index.js                  # 应用入口（Express + WebSocket）
├── public/                       # 前端页面（原生 HTML/CSS/JS）
│   ├── index.html                # 仪表盘 + 同步配置 + 日志
│   ├── jwxt.html                 # 教务系统课表导入
│   ├── custom.html               # 自定义事件管理
│   └── login.html                # 登录页
├── radicale/
│   └── config/
│       ├── config                # Radicale 配置
│       └── users                 # 用户密码文件（bcrypt）
├── Dockerfile                    # Docker 构建文件（Node 20 + Chromium）
├── docker-compose.yml            # Docker Compose 编排
├── deploy.sh                     # 一键部署脚本
├── .env.example                  # 环境变量模板
├── .gitignore                    # Git 忽略规则
└── README.md                     # 本文件
```

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端 | Node.js 20 + Express | 主服务，端口 3000 |
| 前端 | 原生 HTML/CSS/JS | 响应式设计，无框架依赖 |
| 日历服务 | Radicale | 轻量级 CalDAV 服务器，端口 5232 |
| 浏览器自动化 | Puppeteer + Chromium | 教务系统登录和课表抓取 |
| 定时任务 | node-cron | Cron 表达式调度 |
| HTTP 客户端 | Axios | API 调用 |
| HTML 解析 | Cheerio | 课表 HTML 解析 |
| 日志 | Winston | 文件 + 控制台日志 |
| 容器化 | Docker + Docker Compose | 一键部署和编排 |

---

## License

MIT
