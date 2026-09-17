FROM node:18-slim

WORKDIR /app

# 安装 Puppeteer/Chrome 所需的系统依赖
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 设置 Puppeteer 环境变量
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# 安装依赖
COPY package*.json ./
RUN npm install --production

# 复制源码
COPY src/ ./src/
COPY public/ ./public/

# 创建日志和数据目录
RUN mkdir -p logs data

# 数据卷（配置和日志持久化）
VOLUME ["/app/data", "/app/logs"]

# 环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# 启动
CMD ["node", "src/index.js"]
