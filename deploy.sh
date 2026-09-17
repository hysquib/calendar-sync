#!/bin/bash
# 日历同步服务一键部署脚本
# 适用于 Debian/Ubuntu + 宝塔面板环境

set -e

echo "========================================="
echo "  日历同步服务 - 一键部署脚本 v2.0"
echo "========================================="
echo ""

# 检查是否为 root
if [ "$EUID" -ne 0 ]; then
    echo "❌ 请使用 root 用户运行此脚本"
    exit 1
fi

INSTALL_DIR="/www/wwwroot/calendar-sync"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "📦 安装目录: $INSTALL_DIR"
echo ""

# ---- 步骤1: 安装 Docker ----
echo "▶ 步骤 1/6: 检查 Docker 环境..."

if command -v docker &> /dev/null; then
    echo "✅ Docker 已安装: $(docker --version)"
else
    echo "📥 正在安装 Docker（第一次可能需要几分钟）..."
    apt-get update -qq
    apt-get install -y -qq curl gnupg lsb-release ca-certificates

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
    echo "✅ Docker 安装完成"
fi

# 检查 docker compose
if docker compose version &> /dev/null; then
    echo "✅ Docker Compose 已安装"
elif command -v docker-compose &> /dev/null; then
    echo "✅ Docker Compose 已安装"
else
    echo "📥 正在安装 Docker Compose..."
    apt-get install -y -qq docker-compose-plugin 2>/dev/null || true
    if ! docker compose version &> /dev/null; then
        # 回退到 docker-compose
        apt-get install -y -qq docker-compose 2>/dev/null || true
    fi
    echo "✅ Docker Compose 安装完成"
fi

echo ""

# ---- 步骤2: 部署项目文件 ----
echo "▶ 步骤 2/6: 部署项目文件..."

mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/logs"
mkdir -p "$INSTALL_DIR/data"
mkdir -p "$INSTALL_DIR/radicale"
mkdir -p "$INSTALL_DIR/radicale/data"
mkdir -p "$INSTALL_DIR/radicale/config"

# 从脚本目录复制项目文件
if [ -f "$SCRIPT_DIR/package.json" ]; then
    echo "📋 复制项目文件..."
    cp -r "$SCRIPT_DIR"/src "$INSTALL_DIR/" 2>/dev/null || true
    cp -r "$SCRIPT_DIR"/public "$INSTALL_DIR/" 2>/dev/null || true
    cp -r "$SCRIPT_DIR"/radicale "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR"/package.json "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR"/package-lock.json "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR"/Dockerfile "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR"/docker-compose.yml "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR"/README.md "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR"/.env.example "$INSTALL_DIR/.env.example" 2>/dev/null || true
fi

# 如果 .env 不存在，从 .env.example 复制
if [ ! -f "$INSTALL_DIR/.env" ]; then
    if [ -f "$SCRIPT_DIR/.env.example" ]; then
        cp "$SCRIPT_DIR/.env.example" "$INSTALL_DIR/.env"
    fi
fi

echo "✅ 项目文件已部署"
echo ""

# ---- 步骤3: 放行端口 ----
echo "▶ 步骤 3/6: 配置防火墙和端口..."

# ufw
if command -v ufw &> /dev/null; then
    ufw allow 3000/tcp 2>/dev/null || true
    ufw allow 5232/tcp 2>/dev/null || true
    echo "✅ 已放行 3000 和 5232 端口 (ufw)"
fi

# iptables
iptables -I INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p tcp --dport 5232 -j ACCEPT 2>/dev/null || true

# 宝塔面板端口
if [ -d "/www/server/panel" ]; then
    # 尝试通过宝塔API放行端口
    if [ -f "/www/server/panel/data/port.pl" ]; then
        if ! grep -q "^3000$" /www/server/panel/data/port.pl 2>/dev/null; then
            echo "3000" >> /www/server/panel/data/port.pl 2>/dev/null || true
        fi
        if ! grep -q "^5232$" /www/server/panel/data/port.pl 2>/dev/null; then
            echo "5232" >> /www/server/panel/data/port.pl 2>/dev/null || true
        fi
        echo "✅ 已添加到宝塔端口列表"
    fi
    echo "ℹ️  如无法访问，请在宝塔面板 → 安全 → 放行 3000 和 5232 端口"
    echo "ℹ️  同时请在云服务商控制台的安全组中放行 3000 和 5232 端口"
fi

echo ""

# ---- 步骤4: 构建并启动服务 ----
echo "▶ 步骤 4/6: 构建并启动服务..."

cd "$INSTALL_DIR"

# 确定 compose 命令
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

echo "🔨 构建 Docker 镜像（第一次可能需要5-10分钟，请耐心等待）..."
$COMPOSE_CMD build 2>&1 | tail -5

echo "🚀 启动服务..."
$COMPOSE_CMD up -d

echo ""

# ---- 步骤5: 验证服务 ----
echo "▶ 步骤 5/6: 验证服务状态..."

sleep 8

if $COMPOSE_CMD ps | grep -q "Up"; then
    echo ""
    echo "🎉  部署成功！服务已启动"
    echo ""
    echo "========================================="
    echo "  📅 日历同步服务 - 部署信息"
    echo "========================================="
    echo ""
    echo "  🌐 管理后台地址:"
    echo "     http://$(hostname -I | awk '{print $1}'):3000/"
    echo ""
    echo "  🔑 默认管理密码: admin123"
    echo "     ⚠️  请登录后立即修改密码！"
    echo ""
    echo "  📡 CalDAV 服务器 (Radicale):"
    echo "     地址: http://$(hostname -I | awk '{print $1}'):5232/"
    echo "     用户: admin"
    echo "     密码: admin123"
    echo "     ⚠️  建议修改默认密码！"
    echo ""
    echo "  📁 安装目录: $INSTALL_DIR"
    echo "  💾 配置文件: $INSTALL_DIR/data/config.json"
    echo "  📝 日志目录: $INSTALL_DIR/logs/"
    echo ""
    echo "  常用命令："
    echo "    查看状态: cd $INSTALL_DIR && $COMPOSE_CMD ps"
    echo "    查看日志: cd $INSTALL_DIR && $COMPOSE_CMD logs -f"
    echo "    重启服务: cd $INSTALL_DIR && $COMPOSE_CMD restart"
    echo "    停止服务: cd $INSTALL_DIR && $COMPOSE_CMD down"
    echo ""
    echo "  📱 iOS 日历设置（推荐 CalDAV 方式）："
    echo "     设置 → 日历 → 账户 → 添加账户 → 其他 → 添加 CalDAV 账户"
    echo "     服务器: http://$(hostname -I | awk '{print $1}'):5232/"
    echo "     用户名: admin"
    echo "     密码: admin123"
    echo ""
    echo "========================================="
    echo ""
    echo "💡 下一步操作："
    echo "   1. 打开管理后台，用默认密码 admin123 登录"
    echo "   2. 在「同步配置」中填写喜鹊儿/企业微信配置"
    echo "   3. 确认 CalDAV 设置正确（默认已配置）"
    echo "   4. 点击「保存配置」后，去「仪表盘」点击「立即同步」测试"
    echo "   5. 在 iOS 设备上添加 CalDAV 账户即可看到同步的日历"
    echo ""
else
    echo "❌ 服务启动失败，请查看日志："
    echo "   cd $INSTALL_DIR && $COMPOSE_CMD logs"
    exit 1
fi

echo ""
echo "▶ 步骤 6/6: 完成 ✅"
