# 日历同步服务 (Calendar Sync Service)

将喜鹊儿课表和企业微信待办同步到 Microsoft Exchange/Outlook 日历，实现 iOS 日历原生同步。

## ✨ 功能特性

- 📚 **喜鹊儿课表同步** - 自动抓取喜鹊儿教务系统课表，同步到日历
- ✅ **企业微信待办同步** - 将企业微信待办事项同步为日历事件
- 📅 **Microsoft Graph API** - 使用官方 API 同步到 Outlook/Exchange 日历
- 📱 **iOS 原生支持** - iOS 设备通过 Exchange ActiveSync 原生同步
- 🖥️ **可视化管理后台** - 网页界面配置所有参数，无需编辑配置文件
- ⏰ **定时同步** - 可配置的定时同步策略
- 🔄 **智能增量同步** - 只创建/更新/删除有变化的事件
- 🔐 **密码保护** - 管理后台登录保护
- 🐳 **Docker 部署** - 支持 Docker 和 Docker Compose 一键部署

## 🚀 快速部署

### 方式一：宝塔面板一键部署（推荐）

1. 下载部署包 `calendar-sync-deploy.tar.gz`
2. 上传到服务器 `/root/` 目录并解压
3. 执行部署脚本：
```bash
cd /root/calendar-sync-deploy
bash deploy.sh
```
4. 访问 `http://服务器IP:3000/` 进入管理后台
5. 默认密码：`admin123`（登录后请立即修改）

> ⚠️ 请确保服务器安全组/宝塔防火墙已放行 3000 端口

### 方式二：Docker Compose 部署

```bash
git clone <repository-url>
cd calendar-sync
docker-compose up -d
```

### 方式三：Node.js 直接运行

```bash
npm install
npm start
```

## 🖥️ 管理后台使用

### 登录

访问 `http://服务器IP:3000/`，输入管理密码登录。

默认密码：`admin123`

### 仪表盘

- 查看各服务启用状态
- 查看上次同步时间和结果
- 手动触发同步
- 测试各服务连接

### 同步配置

四个配置标签页：

1. **📚 喜鹊儿课表** - 配置学号、密码、学校等
2. **✅ 企业微信** - 配置企业ID、应用Secret等
3. **📅 Exchange** - 配置 Microsoft Graph 或 EWS
4. **⚙️ 通用设置** - 同步周期、时区、修改密码

配置修改后点击「保存配置」即可生效。

### 同步日志

查看实时同步日志，支持筛选错误日志、调整显示行数、清空日志。

## 📋 配置说明

### Microsoft Graph / Azure AD 配置

要使用 Microsoft Graph API，需要先在 Azure AD 中注册应用：

1. 访问 [Azure Portal](https://portal.azure.com/) → Azure Active Directory → 应用注册 → 新注册
2. 填写应用名称，选择"仅组织目录中的账户"
3. 注册后记录：
   - 应用程序(客户端) ID → 客户端ID
   - 目录(租户) ID → 租户ID
4. 证书和密码 → 新建客户端密码 → 记录密码值 → 客户端密钥
5. API 权限 → 添加权限 → Microsoft Graph → 应用程序权限 → 添加：
   - `Calendars.ReadWrite` - 读写用户日历
6. 点击"授予管理员同意"

### 喜鹊儿配置

| 字段 | 说明 |
|------|------|
| 账号 | 喜鹊儿登录账号（学号/工号） |
| 密码 | 喜鹊儿登录密码 |
| 学校名称 | 学校全称（需与APP中一致） |
| 日历名称 | 在Exchange日历中显示的名称 |
| 提前获取天数 | 默认14天 |

### 企业微信配置

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/)
2. 应用管理 → 自建 → 创建应用
3. 记录企业ID、应用AgentId、应用Secret
4. 配置应用可见范围

## 📱 iOS 日历设置

同步完成后，在 iOS 设备上添加 Exchange 账户：

1. 打开 **设置** → **日历** → **账户** → **添加账户**
2. 选择 **Exchange**
3. 输入 Microsoft 365 邮箱和密码
   - 服务器：`outlook.office365.com`（Microsoft 365）
4. 确保"日历"开关已打开
5. 打开"日历"App，即可看到同步的日历

## 🏗️ 架构说明

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌───────────┐
│  喜鹊儿课表   │────▶│                  │────▶│  Microsoft 365   │────▶│ iOS 日历  │
└──────────────┘     │                  │     │   / Exchange     │     └───────────┘
                     │  日历同步服务     │     └──────────────────┘
┌──────────────┐     │  (含Web管理后台) │
│ 企业微信待办  │────▶│                  │
└──────────────┘     └──────────────────┘
```

## 📁 项目结构

```
calendar-sync/
├── public/                 # 管理后台前端页面
│   ├── index.html          # 主页面（仪表盘/配置/日志）
│   └── login.html          # 登录页
├── src/
│   ├── config/             # 配置管理
│   ├── routes/             # API 路由
│   │   └── admin.js        # 管理后台 API
│   ├── services/           # 业务服务
│   │   ├── xiqueer.js      # 喜鹊儿课表
│   │   ├── wecom.js        # 企业微信待办
│   │   └── graph.js        # Microsoft Graph
│   ├── sync/               # 同步逻辑
│   │   ├── sync.js         # 同步管理器
│   │   └── scheduler.js    # 定时调度器
│   ├── utils/              # 工具模块
│   │   ├── auth.js         # 认证中间件
│   │   ├── configManager.js # 配置管理器
│   │   └── logger.js       # 日志工具
│   └── index.js            # 主入口
├── data/                   # 数据目录（配置持久化）
├── logs/                   # 日志目录
├── deploy.sh               # 一键部署脚本
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 🔌 API 接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/health` | 健康检查 | 否 |
| POST | `/api/auth/login` | 登录 | 否 |
| POST | `/api/auth/logout` | 登出 | 是 |
| POST | `/api/auth/password` | 修改密码 | 是 |
| GET | `/api/config` | 获取配置 | 是 |
| POST | `/api/config` | 保存配置 | 是 |
| GET | `/api/sync/status` | 同步状态 | 是 |
| POST | `/api/sync/trigger` | 手动同步 | 是 |
| POST | `/api/sync/test` | 测试连接 | 是 |
| GET | `/api/logs` | 获取日志 | 是 |
| DELETE | `/api/logs` | 清空日志 | 是 |

## ❓ 常见问题

### Q: 管理后台打不开？

A: 请检查：
1. 服务是否启动：`docker compose ps`
2. 端口是否放行：宝塔安全组 + 云服务商安全组
3. 查看日志：`docker compose logs`

### Q: 喜鹊儿登录失败？

A: 请确认：
1. 账号密码正确
2. 学校名称与喜鹊儿中显示的完全一致
3. 学校确实使用青果软件/喜鹊儿系统

### Q: 企业微信获取不到待办？

A: 请检查：
1. 应用有足够的权限
2. 用户在应用可见范围内
3. 待办是由该应用创建的，或用户有待办读取权限

### Q: iOS 日历不显示？

A: 请检查：
1. Exchange 账户添加成功
2. 日历开关已打开
3. 在日历 App 中确认对应日历已勾选
4. 等待同步（可能需要几分钟）

## 📄 许可证

MIT License
