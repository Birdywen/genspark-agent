# RacquetDesk Booker 优化方案

## 一、验证码问题解决方案

### 方案 A：Session 复用（推荐）

**原理**：人工登录一次，保存 cookies，后续复用 session 避免重复登录。

**实现**：
1. 添加 "手动登录" 模式 - 打开真实浏览器让用户登录
2. 登录成功后保存完整 cookies 到文件
3. 后续启动时加载 cookies，跳过登录流程
4. Session 过期时才需要重新人工登录

**优点**：
- 完全避免验证码
- 不需要 2Captcha API 费用
- 登录成功率 100%

**缺点**：
- 需要人工介入登录（但只需偶尔一次）
- Session 有效期取决于网站设置

### 方案 B：增强反检测（当前已实现部分）

已实现：
- Stealth 插件
- 禁用 AutomationControlled
- 随机延迟和鼠标移动
- 自定义 UserAgent

可继续增强：
- 使用真实浏览器指纹
- 添加更多人类行为模拟

### 方案 C：代理 IP

使用住宅代理 IP 而非数据中心 IP，降低被标记风险。

---

## 二、功能优化建议

### 1. Cookie 持久化增强

```javascript
// booker.js 添加
async saveCookies() {
  if (!this.page) return;
  const cookies = await this.page.cookies();
  db.saveCookies(cookies);
  console.log(`Saved ${cookies.length} cookies`);
}

async loadCookies() {
  const cookies = db.getCookies();
  if (cookies && cookies.length > 0) {
    await this.page.setCookie(...cookies);
    console.log(`Loaded ${cookies.length} cookies`);
    return true;
  }
  return false;
}

async trySessionLogin() {
  await this.ensureBrowser();
  this.page = await this.browser.newPage();
  
  // 加载保存的 cookies
  const loaded = await this.loadCookies();
  if (!loaded) {
    return { success: false, reason: 'No saved cookies' };
  }
  
  // 访问 dashboard 检查 session
  await this.page.goto('https://www.racquetdesk.net/entity/dashboard/indexAction.html');
  await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  
  // 检查是否跳转到登录页
  if (this.page.url().includes('login')) {
    return { success: false, reason: 'Session expired' };
  }
  
  this.loggedIn = true;
  this.lastActivity = Date.now();
  return { success: true, method: 'session' };
}
```

### 2. 智能登录流程

```javascript
async smartLogin() {
  // 1. 先尝试 session 复用
  console.log('Trying session login...');
  const sessionResult = await this.trySessionLogin();
  if (sessionResult.success) {
    console.log('✓ Session login successful');
    return sessionResult;
  }
  
  // 2. Session 失效，尝试正常登录
  console.log('Session expired, trying normal login...');
  return await this.login();
}
```

### 3. 心跳优化

当前：每 3 分钟检查一次
建议：每次成功操作后更新 lastActivity，心跳检查时如果最近有活动则跳过

```javascript
async checkConnection() {
  // 如果最近 2 分钟内有活动，跳过检查
  if (this.lastActivity && Date.now() - this.lastActivity < 2 * 60 * 1000) {
    console.log('Recent activity, skipping heartbeat check');
    return { connected: true };
  }
  // ... 原有逻辑
}
```

### 4. 预订窗口优化

```javascript
// 提前 5 分钟预登录，避免开抢时还在登录
async preLogin() {
  if (this.booker.isLoggedIn()) {
    console.log('Already logged in, refreshing session...');
    await this.booker.keepAlive();
  } else {
    console.log('Pre-login starting...');
    await this.booker.smartLogin();
  }
}
```

### 5. 并发预订（多个时段）

```javascript
async pollParallel(tasks) {
  // 并发处理多个任务，但限制并发数
  const CONCURRENCY = 3;
  const chunks = [];
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    chunks.push(tasks.slice(i, i + CONCURRENCY));
  }
  
  for (const chunk of chunks) {
    await Promise.all(chunk.map(task => this.processTask(task)));
  }
}
```

---

## 三、Render.com 部署优化

### 1. 环境变量配置

```env
HEADLESS=true           # Render 上必须无头
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RD_USERNAME=your_username
RD_PASSWORD=your_password
CAPTCHA_API_KEY=your_2captcha_key  # 备用
```

### 2. Dockerfile 优化

```dockerfile
FROM node:18-slim

# 安装 Chromium 和依赖
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    dumb-init \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV HEADLESS=true

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

# 使用 dumb-init 处理信号
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
```

### 3. 持久化存储

Render 的文件系统是临时的，需要持久化 cookies：
- 方案 A：使用 Render 的 Persistent Disk
- 方案 B：存储到外部数据库（如 Redis/MongoDB）
- 方案 C：每次部署后手动登录一次

---

## 四、代码重构建议

### 1. 错误处理统一

```javascript
class BookerError extends Error {
  constructor(message, code, recoverable = true) {
    super(message);
    this.code = code;
    this.recoverable = recoverable;
  }
}

const ErrorCodes = {
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  CAPTCHA_FAILED: 'CAPTCHA_FAILED',
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  NETWORK_ERROR: 'NETWORK_ERROR'
};
```

### 2. 配置集中管理

```javascript
// config.js
module.exports = {
  site: {
    baseUrl: 'https://www.racquetdesk.net',
    loginUrl: '/entity/dashboard/loginAction.html',
    dashboardUrl: '/entity/dashboard/indexAction.html'
  },
  timing: {
    heartbeatInterval: 3 * 60 * 1000,
    pollingInterval: 3 * 1000,
    preLoginMinutes: 5
  },
  browser: {
    headless: process.env.HEADLESS === 'true',
    viewport: { width: 1366, height: 768 }
  }
};
```

---

## 五、优先级建议

| 优先级 | 优化项 | 预期效果 |
|--------|--------|----------|
| 🔴 高 | Cookie/Session 复用 | 避免 90% 的验证码 |
| 🔴 高 | 智能登录流程 | 提升登录成功率 |
| 🟡 中 | 心跳优化 | 减少不必要的请求 |
| 🟡 中 | 预登录机制 | 开抢时更快响应 |
| 🟢 低 | 并发预订 | 多任务效率提升 |
| 🟢 低 | 代码重构 | 可维护性提升 |
