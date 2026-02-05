// 改进的浏览器启动配置
// 将这些改动合并到 booker.js 的 ensureBrowser 方法中

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// 配置 Stealth 插件的所有选项
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('chrome.runtime'); // 有时这个反而会暴露
puppeteer.use(stealth);

async function ensureBrowser() {
  if (!this.browser || !this.browser.isConnected()) {
    console.log('Launching browser with enhanced stealth...');
    
    this.browser = await puppeteer.launch({
      headless: false,  // 关键改动：使用有头模式，大幅降低检测率
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',  // 隐藏自动化标记
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1366,768',
        '--start-maximized',
        // 模拟真实浏览器
        '--disable-infobars',
        '--lang=en-US,en',
      ],
      defaultViewport: null,  // 使用窗口实际大小
      ignoreDefaultArgs: ['--enable-automation'],  // 移除自动化标记
    });
    
    this.page = await this.browser.newPage();
    
    // 更新的 UserAgent (Chrome 122)
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    
    // 设置更真实的 viewport
    await this.page.setViewport({ width: 1366, height: 768 });
    
    // 注入额外的反检测脚本
    await this.page.evaluateOnNewDocument(() => {
      // 覆盖 webdriver 属性
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
      // 覆盖 plugins 长度
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // 覆盖 languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      
      // Chrome 特有属性
      window.chrome = { runtime: {} };
      
      // 覆盖权限查询
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });
    
    // 模拟真实的鼠标移动（在页面加载前）
    this.page.on('load', async () => {
      await randomMouseMovement(this.page);
    });
  }
  return this.page;
}

// 随机鼠标移动函数
async function randomMouseMovement(page) {
  const width = 1366;
  const height = 768;
  
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 20) + 10 });
    await sleep(Math.random() * 500 + 200);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { ensureBrowser, randomMouseMovement };
