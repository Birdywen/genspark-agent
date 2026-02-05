const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const CaptchaSolver = require('./captcha-solver');
const db = require('./database');

puppeteer.use(StealthPlugin());

const USER_ID = '355252';
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Booker {
  constructor() {
    this.browser = null;
    this.page = null;
    this.loggedIn = false;
    this.io = null;
    this.heartbeatInterval = null;
    this.lastActivity = null;
  }

  init(io) { 
    this.io = io; 
    this.startHeartbeat();
  }
  
  emit(event, data) { 
    if (this.io) this.io.emit(event, data); 
  }
  
  isLoggedIn() { 
    return this.loggedIn; 
  }

  getLastActivity() {
    return this.lastActivity;
  }

  startHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(async () => {
      if (this.loggedIn) {
        await this.checkConnection();
      }
    }, 3 * 60 * 1000);
    console.log('💓 Heartbeat started (every 3 minutes)');
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('💓 Heartbeat stopped');
    }
  }

  async checkConnection() {
    if (!this.loggedIn || !this.page) {
      return { connected: false, reason: 'Not logged in' };
    }

    try {
      console.log('💓 Heartbeat: Checking connection...');
      
      const result = await this.page.evaluate(async () => {
        try {
          const response = await fetch('https://www.racquetdesk.net/entity/dashboard/indexAction.html', {
            method: 'GET',
            credentials: 'include'
          });
          
          if (response.url.includes('login')) {
            return { connected: false, reason: 'Session expired (redirected to login)' };
          }
          
          if (response.ok) {
            return { connected: true };
          }
          
          return { connected: false, reason: `HTTP ${response.status}` };
        } catch (e) {
          return { connected: false, reason: e.message };
        }
      });

      if (result.connected) {
        this.lastActivity = Date.now();
        console.log('💓 Heartbeat: Connection OK');
        this.emit('status', { isLoggedIn: true, lastCheck: this.lastActivity });
      } else {
        console.log('💔 Heartbeat: Connection lost -', result.reason);
        this.loggedIn = false;
        this.emit('status', { isLoggedIn: false, reason: result.reason });
        db.addLog('WARN', `Session expired: ${result.reason}`);
      }

      return result;
    } catch (error) {
      console.log('💔 Heartbeat error:', error.message);
      this.loggedIn = false;
      this.emit('status', { isLoggedIn: false, reason: error.message });
      return { connected: false, reason: error.message };
    }
  }

  async keepAlive() {
    if (!this.loggedIn || !this.page) {
      return { success: false, reason: 'Not logged in' };
    }

    try {
      console.log('🔄 Keep-alive: Refreshing session...');
      
      const result = await this.page.evaluate(async () => {
        try {
          const response = await fetch('https://www.racquetdesk.net/entity/dashboard/indexAction.html', {
            method: 'GET',
            credentials: 'include'
          });
          
          if (response.url.includes('login')) {
            return { success: false, reason: 'Session expired' };
          }
          
          return { success: response.ok };
        } catch (e) {
          return { success: false, reason: e.message };
        }
      });
      
      if (result.success) {
        this.lastActivity = Date.now();
        console.log('✓ Keep-alive successful');
        return { success: true };
      } else {
        this.loggedIn = false;
        return result;
      }
    } catch (error) {
      console.log('✗ Keep-alive failed:', error.message);
      return { success: false, reason: error.message };
    }
  }

  async ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      console.log('Launching browser with enhanced stealth...');
      
      this.browser = await puppeteer.launch({
        headless: process.env.HEADLESS === 'true' ? 'new' : false,  // 使用有头模式，大幅降低检测率
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--window-size=1366,768',
          '--disable-infobars',
          '--lang=en-US,en',
        ],
        defaultViewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
      });
      
      this.page = await this.browser.newPage();
      
      // 更新的 UserAgent
      await this.page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      );
      
      // 注入反检测脚本
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      });
    }
    return this.page;
  }


  // ============ Cookie/Session 管理 ============
  async saveCookies() {
    if (!this.page) return false;
    try {
      const cookies = await this.page.cookies();
      db.saveCookies(cookies);
      console.log('💾 Saved ' + cookies.length + ' cookies');
      return true;
    } catch (e) {
      console.error('Failed to save cookies:', e.message);
      return false;
    }
  }

  async loadCookies() {
    try {
      const cookies = db.getCookies();
      if (cookies && cookies.length > 0) {
        await this.page.setCookie(...cookies);
        console.log('📂 Loaded ' + cookies.length + ' cookies');
        return true;
      }
    } catch (e) {
      console.error('Failed to load cookies:', e.message);
    }
    return false;
  }

  // 尝试使用已保存的 session 登录（无需验证码）
  async trySessionLogin() {
    console.log('🔄 Attempting session login...');
    this.emit('status', { state: 'session_login', message: 'Trying saved session...' });
    
    try {
      await this.ensureBrowser();
      
      if (!this.page) {
        this.page = await this.browser.newPage();
        await this.setupPage();
      }
      
      // 加载保存的 cookies
      const loaded = await this.loadCookies();
      if (!loaded) {
        console.log('❌ No saved cookies found');
        return { success: false, reason: 'No saved cookies' };
      }
      
      // 访问 dashboard 检查 session 是否有效
      await this.page.goto('https://www.racquetdesk.net/entity/dashboard/indexAction.html', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // 等待页面加载
      await new Promise(r => setTimeout(r, 2000));
      
      const currentUrl = this.page.url();
      
      // 检查是否被重定向到登录页
      if (currentUrl.includes('login')) {
        console.log('❌ Session expired (redirected to login)');
        this.emit('status', { state: 'session_expired', message: 'Session expired, need fresh login' });
        return { success: false, reason: 'Session expired' };
      }
      
      // Session 有效！
      console.log('✅ Session login successful!');
      this.loggedIn = true;
      this.lastActivity = Date.now();
      this.emit('status', { isLoggedIn: true, method: 'session' });
      
      // 更新 cookies（可能有新的）
      await this.saveCookies();
      
      return { success: true, method: 'session' };
      
    } catch (error) {
      console.error('Session login error:', error.message);
      return { success: false, reason: error.message };
    }
  }

  // 智能登录：先尝试 session，失败再用完整登录流程

  // ============ 手动登录模式 ============
  // 打开浏览器让用户手动完成登录，然后保存 cookies
  async manualLogin(timeoutMinutes = 5) {
    console.log('🖐️ Manual login mode - you have ' + timeoutMinutes + ' minutes to login');
    this.emit('status', { state: 'manual_login', message: 'Please login manually in the browser window...' });
    
    try {
      await this.ensureBrowser();
      
      if (!this.page) {
        this.page = await this.browser.newPage();
        await this.setupPage();
      }
      
      // 打开登录页
      await this.page.goto('https://www.racquetdesk.net/entity/dashboard/loginAction.html', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      console.log('⏳ Waiting for you to login manually...');
      console.log('   Complete the login in the browser window');
      console.log('   You have ' + timeoutMinutes + ' minutes');
      
      // 等待用户手动登录，检测 URL 变化到 dashboard
      const timeoutMs = timeoutMinutes * 60 * 1000;
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeoutMs) {
        await new Promise(r => setTimeout(r, 2000)); // 每2秒检查一次
        
        const currentUrl = this.page.url();
        
        // 检测是否已登录成功（URL 不再是登录页）
        if (!currentUrl.includes('login') && currentUrl.includes('racquetdesk.net')) {
          console.log('✅ Login detected! Saving cookies...');
          
          // 等待页面完全加载
          await new Promise(r => setTimeout(r, 2000));
          
          // 保存 cookies
          await this.saveCookies();
          
          this.loggedIn = true;
          this.lastActivity = Date.now();
          this.emit('status', { isLoggedIn: true, method: 'manual' });
          
          db.addLog('SUCCESS', '✅ Manual login successful, cookies saved');
          return { success: true, method: 'manual' };
        }
        
        // 每30秒提醒一次
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed % 30 === 0 && elapsed > 0) {
          const remaining = Math.floor((timeoutMs - (Date.now() - startTime)) / 1000);
          console.log('⏳ Still waiting... ' + remaining + 's remaining');
        }
      }
      
      console.log('❌ Manual login timeout');
      return { success: false, reason: 'Timeout waiting for manual login' };
      
    } catch (error) {
      console.error('Manual login error:', error.message);
      return { success: false, reason: error.message };
    }
  }

    async smartLogin() {
    // 1. 先尝试 session 复用（快速、无验证码）
    const sessionResult = await this.trySessionLogin();
    if (sessionResult.success) {
      db.addLog('SUCCESS', '✅ Session login successful (no captcha needed)');
      return sessionResult;
    }
    
    console.log('Session login failed:', sessionResult.reason);
    console.log('Falling back to full login...');
    
    // 2. Session 失效，使用完整登录流程
    return await this.login();
  }

    async login() {
    const settings = db.getSettings();
    if (!settings.rd_username || !settings.rd_password) {
      return { success: false, error: 'Username/password not configured' };
    }

    try {
      this.emit('status', { state: 'logging_in', message: 'Opening browser...' });
      
      await this.ensureBrowser();
      await this.page.goto('https://www.racquetdesk.net/login.html', { waitUntil: 'networkidle2' });
      
      await this.page.evaluate(() => {
        document.getElementById('j_username').value = '';
        document.getElementById('j_password').value = '';
      });
      
      await this.page.type('#j_username', settings.rd_username, { delay: 50 });
      await this.page.type('#j_password', settings.rd_password, { delay: 50 });
      
      this.emit('status', { state: 'captcha', message: 'Handling captcha...' });
      
      const recaptchaFrame = this.page.frames().find(f => f.url().includes('recaptcha/api2/anchor'));
      
      let captchaPassed = false;
      
      if (recaptchaFrame) {
        try {
          await recaptchaFrame.waitForSelector('#recaptcha-anchor', { timeout: 5000 });
          
          const checkbox = await recaptchaFrame.$('#recaptcha-anchor');
          if (checkbox) {
            const box = await checkbox.boundingBox();
            if (box) {
              const x = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
              const y = box.y + box.height / 2 + (Math.random() - 0.5) * 10;
              await this.page.mouse.move(x, y, { steps: 10 });
              await sleep(200 + Math.random() * 300);
              await this.page.mouse.click(x, y);
            } else {
              await recaptchaFrame.click('#recaptcha-anchor');
            }
          }
          
          console.log('Clicked captcha checkbox, waiting...');
          
          for (let i = 0; i < 60; i++) {
            await sleep(1000);
            
            try {
              captchaPassed = await recaptchaFrame.evaluate(() => {
                const anchor = document.querySelector('#recaptcha-anchor');
                return anchor?.getAttribute('aria-checked') ===  'true';
              });
              
              if (captchaPassed) {
                console.log(`✓ Captcha passed without challenge! (took ${i + 1}s)`);
                this.emit('status', { state: 'logging_in', message: 'Captcha passed! Logging in...' });
                break;
              }
            } catch (e) {}
            
            const challengeFrame = this.page.frames().find(f => f.url().includes('recaptcha/api2/bframe'));
            if (challengeFrame) {
              console.log('Challenge popup detected - waiting for manual completion...');
              this.emit('status', { state: 'manual_captcha', message: 'Please complete the captcha manually...' });
              // 继续等待，不要 break
            }
          }
        } catch (e) {
          console.log('Captcha checkbox error:', e.message);
        }
      }
      
      if (!captchaPassed) {
        console.log('Challenge appeared, using 2Captcha...');
        
        if (!settings.captcha_api_key) {
          return { success: false, error: 'Captcha challenge appeared but no API key configured' };
        }
        
        this.emit('status', { state: 'solving_captcha', message: 'Solving captcha with 2Captcha (30-60s)...' });
        db.addLog('INFO', 'Solving captcha with 2Captcha...');
        
        const solver = new CaptchaSolver(settings.captcha_api_key);
        const token = await solver.solve(
          '6LdU1pYfAAAAAO1pdKyL_PD4plva_tOqmewsDaTF',
          'https://www.racquetdesk.net/login.html'
        );
        
        await this.page.evaluate((t) => {
          const textarea = document.getElementById('g-recaptcha-response');
          if (textarea) {
            textarea.style.display = 'block';
            textarea.value = t;
          }
        }, token);
        
        console.log('Captcha token injected');
        this.emit('status', { state: 'logging_in', message: 'Captcha solved! Logging in...' });
      }
      
      // 模拟点击登录按钮而非直接提交表单（更自然）
      const submitBtn = await this.page.$('button[type="submit"], input[type="submit"], #btn-login, .btn-login, .login-btn');
      if (submitBtn) {
        await submitBtn.click();
        console.log('Clicked submit button');
      } else {
        // 备用：直接提交表单
        await this.page.evaluate(() => {
          document.getElementById('form-login').submit();
        });
        console.log('Submitted form directly');
      }
      
      await this.page.waitForNavigation({ timeout: 15000 }).catch(() => {});
      
      // 等待更长时间让页面完全跳转
      await sleep(5000);
      
      // 多次检查URL，给手动验证码更多时间
      let currentUrl = this.page.url();
      let attempts = 0;
      while (currentUrl.includes('login') && attempts < 30) {
        console.log('Still on login page, waiting... attempt', attempts + 1);
        await sleep(2000);
        currentUrl = this.page.url();
        attempts++;
      }
      console.log('Current URL after login:', currentUrl);
      
      if (!currentUrl.includes('login')) {
        this.loggedIn = true;
        this.lastActivity = Date.now();
        this.emit('status', { state: 'ready', message: 'Logged in', isLoggedIn: true });
        db.addLog("SUCCESS", "Login successful");
        await this.saveCookies();
        return { success: true };
      } else {
        const errorText = await this.page.evaluate(() => {
          const error = document.querySelector('.alert-danger, .error, .login-error');
          return error ? error.textContent.trim() : null;
        });
        throw new Error(errorText || 'Login failed - still on login page');
      }

    } catch (error) {
      console.error('Login error:', error);
      this.emit('status', { state: 'error', message: error.message });
      db.addLog('ERROR', 'Login failed: ' + error.message);
      return { success: false, error: error.message };
    }
  }

  async fetchSchedule(date) {
    if (!this.loggedIn || !this.page) {
      return { success: false, error: 'Not logged in', sessionExpired: true };
    }

    try {
      const settings = db.getSettings();
      const userId = settings.rd_user_id || USER_ID;
      
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);
      const endDateStr = endDate.toISOString().split('T')[0];
      const timestamp = Date.now();

      const result = await this.page.evaluate(async (scheduleDate, startDate, endDate, uid, ts) => {
        const fullUrl = `https://www.racquetdesk.net/api/events.cfc?method=getEvents&developerHash=d8db537eefbf3cc8459a4dd19d50119a&fxObjectID=0&listObjectTypeID=2&datePart=D&scheduleDate=${encodeURIComponent(scheduleDate)}&fullcalendar=yes&editUrl=/entity/dashboard/indexAction.html?src=setEditVars&s=0&addUrl=/entity/scheduler/indexAction.html?src=setSchedulerVars&exclude=&apptSalesSummary=1&ad=0&smUserID=${uid}&entityID=111&start=${startDate}&end=${endDate}&_=${ts}`;
        
        try {
          const response = await fetch(fullUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json, text/javascript, */*; q=0.01',
              'X-Requested-With': 'XMLHttpRequest',
              'Referer': 'https://www.racquetdesk.net/entity/dashboard/indexAction.html'
            }
          });
          
          if (response.url.includes('login')) {
            return { success: false, error: 'Session expired', sessionExpired: true };
          }
          
          if (!response.ok) {
            return { success: false, error: `HTTP ${response.status}` };
          }
          
          const text = await response.text();
          
          if (text.startsWith('[') || text.startsWith('{')) {
            return { success: true, data: JSON.parse(text) };
          }
          
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            return { success: true, data: JSON.parse(jsonMatch[0]) };
          }
          
          return { success: false, error: 'Invalid response format' };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }, date, date, endDateStr, userId, timestamp);

      if (!result.success) {
        if (result.sessionExpired) {
          this.loggedIn = false;
          this.emit('status', { isLoggedIn: false, reason: 'Session expired' });
          db.addLog('WARN', 'Session expired during fetchSchedule');
        }
        return result;
      }

      this.lastActivity = Date.now();
      return { success: true, data: result.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async fetchMyBookings() {
    if (!this.loggedIn || !this.page) {
      return { success: false, error: 'Not logged in' };
    }

    try {
      const result = await this.page.evaluate(async () => {
        try {
          const response = await fetch('https://www.racquetdesk.net/entity/dashboard/indexAction.html?src=getMyAppointments', {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json, text/javascript, */*; q=0.01',
              'X-Requested-With': 'XMLHttpRequest'
            }
          });
          
          if (response.url.includes('login')) {
            return { success: false, sessionExpired: true };
          }
          
          const text = await response.text();
          return { success: true, data: text };
        } catch (e) {
          return { success: false, error: e.message };
        }
      });

      if (result.sessionExpired) {
        this.loggedIn = false;
        this.emit('status', { isLoggedIn: false });
      }

      this.lastActivity = Date.now();
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ============ My Bookings - 获取并解析 (新增) ============
  async fetchMyBookingsData() {
    if (!this.loggedIn || !this.page) {
      return { success: false, error: 'Not logged in', appointments: [], waitlists: [] };
    }

    try {
      const settings = db.getSettings();
      const userId = settings.rd_user_id || USER_ID;
      
      const result = await this.page.evaluate(async (uid) => {
        try {
          const response = await fetch(`https://www.racquetdesk.net/facilities/myAppointmentsByUser.cfm?uID=${uid}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'X-Requested-With': 'XMLHttpRequest'
            }
          });
          
          if (response.url.includes('login')) {
            return { success: false, error: 'Session expired', sessionExpired: true };
          }
          
          const html = await response.text();
          return { success: true, html };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }, userId);

      if (!result.success) {
        if (result.sessionExpired) {
          this.loggedIn = false;
          this.emit('status', { isLoggedIn: false });
        }
        return { success: false, error: result.error, appointments: [], waitlists: [] };
      }

      const parsed = this.parseMyBookingsHtml(result.html);
      this.lastActivity = Date.now();
      
      return { success: true, ...parsed };
    } catch (error) {
      return { success: false, error: error.message, appointments: [], waitlists: [] };
    }
  }

  parseMyBookingsHtml(html) {
    const appointments = [];
    const waitlists = [];
    
    // 解析 Appointments
    const apptSection = html.match(/<legend>Appointments for[\s\S]*?<\/fieldset>/);
    if (apptSection) {
      const section = apptSection[0];
      const nameMatches = [...section.matchAll(/([A-Za-z]+)<br\s*\/?>\s*(\d{2}\/\d{2}\/\d{4}) at (\d{1,2}:\d{2} [AP]M)/g)];
      const idMatches = [...section.matchAll(/src=delApptMember&apptID=(\d+)&oID=(\d+)&otID=(\d+)/g)];
      
      for (let i = 0; i < Math.min(nameMatches.length, idMatches.length); i++) {
        appointments.push({
          id: idMatches[i][1],
          oderId: idMatches[i][2],
          otId: idMatches[i][3],
          name: nameMatches[i][1],
          date: nameMatches[i][2],
          time: nameMatches[i][3],
          type: 'appointment'
        });
      }
    }
    
    // 解析 Waitlists
    const waitlistSection = html.match(/<legend>Waitlists for[\s\S]*?<\/fieldset>/);
    if (waitlistSection) {
      const section = waitlistSection[0];
      const waitlistBlocks = section.split(/<tr>/);
      
      for (const block of waitlistBlocks) {
        if (!block.includes('aID')) continue;
        
        const nameMatch = block.match(/([A-Za-z]+)<br\s*\/?>\s*(\d{2}\/\d{2}\/\d{4}) at (\d{1,2}:\d{2} [AP]M)/);
        const positionMatch = block.match(/number <strong[^>]*>(\d+)<\/strong>/);
        const aidMatch = block.match(/name="aID" value="(\d+)"/);
        const fxObjectMatch = block.match(/name="fxObjectID" value="(\d+)"/);
        
        if (nameMatch && aidMatch) {
          waitlists.push({
            id: aidMatch[1],
            fxObjectID: fxObjectMatch ? fxObjectMatch[1] : '',
            name: nameMatch[1],
            date: nameMatch[2],
            time: nameMatch[3],
            position: positionMatch ? parseInt(positionMatch[1]) : null,
            type: 'waitlist'
          });
        }
      }
    }
    
    return { appointments, waitlists };
  }

  // ============ 取消预订 (新增) ============
  async cancelAppointment(apptId, oId, otId) {
    if (!this.loggedIn || !this.page) {
      return { success: false, error: 'Not logged in' };
    }

    try {
      const result = await this.page.evaluate(async (apptID, oID, otID) => {
        try {
          const url = `https://www.racquetdesk.net/entity/dashboard/indexAction.html?src=delApptMember&apptID=${apptID}&oID=${oID}&otID=${otID}&`;
          
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });
          
          if (response.url.includes('login')) {
            return { success: false, error: 'Session expired', sessionExpired: true };
          }
          
          return { success: response.ok };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }, apptId, oId, otId);

      if (result.sessionExpired) {
        this.loggedIn = false;
        this.emit('status', { isLoggedIn: false });
      }
      
      if (result.success) {
        this.lastActivity = Date.now();
      }
      
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ============ 取消 Waitlist (新增) ============
  async cancelWaitlist(aId, fxObjectID) {
    if (!this.loggedIn || !this.page) {
      return { success: false, error: 'Not logged in' };
    }

    try {
      const settings = db.getSettings();
      const userId = settings.rd_user_id || USER_ID;
      const fxObjId = fxObjectID || userId;
      
      const result = await this.page.evaluate(async (aid, fxObjID) => {
        try {
          const response = await fetch('https://www.racquetdesk.net/entity/dashboard/indexAction.html?src=cancelWaitlist', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: `fxObjectID=${fxObjID}&fListObjectTypeID=1&aID=${aid}`
          });
          
          if (response.url.includes('login')) {
            return { success: false, error: 'Session expired', sessionExpired: true };
          }
          
          return { success: response.ok };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }, aId, fxObjId);

      if (result.sessionExpired) {
        this.loggedIn = false;
        this.emit('status', { isLoggedIn: false });
      }
      
      if (result.success) {
        this.lastActivity = Date.now();
      }
      
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ============ 直接预订 (Direct Book) ============
  async directBook(slot) {
    if (!this.loggedIn || !this.page) {
      return { success: false, message: 'Not logged in', sessionExpired: true };
    }

    try {
      const settings = db.getSettings();
      const userId = settings.rd_user_id || USER_ID;
      
      db.addLog('INFO', `🎯 Direct booking: ${slot.resources || slot.id}`);
      
      const result = await this.page.evaluate(async (slotId, uID) => {
        const modalUrl = `https://www.racquetdesk.net/entity/dashboard/modalMember.html?aID=${slotId}`;
        const baseUrl = 'https://www.racquetdesk.net/entity/dashboard/';
        
        try {
          // Step 1: 获取 modal 页面
          const checkResponse = await fetch(modalUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'X-Requested-With': 'XMLHttpRequest',
              'Referer': baseUrl + 'indexAction.html'
            }
          });
          
          if (checkResponse.url.includes('login')) {
            return { success: false, message: 'Session expired', sessionExpired: true };
          }
          
          if (!checkResponse.ok) {
            return { success: false, message: `HTTP ${checkResponse.status}` };
          }
          
          const html = await checkResponse.text();
          
          // 已经预订了
          if (html.includes('Cancel my booking') || html.includes('You are booked')) {
            return { success: true, message: 'Already booked', alreadyBooked: true };
          }
          
          // 已在候补
          if (html.includes('Remove me from the waitlist')) {
            return { success: true, message: 'Already on waitlist', alreadyOnWaitlist: true };
          }
          
          // 检查是否有 Book 按钮
          if (!html.includes('src=setCourtReservationVars') && !html.includes('value="Book"')) {
            if (html.includes('Add me to the waitlist')) {
              return { success: false, message: 'Slot full, waitlist available', needsWaitlist: true };
            }
            return { success: false, message: 'Booking not available' };
          }
          
          // Step 2: 发送预订请求
          const step1Url = baseUrl + 'indexAction.html?src=setCourtReservationVars';
          const step1Body = `uID=${uID}&aID=${slotId}`;
          
          const step1Response = await fetch(step1Url, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              'Origin': 'https://www.racquetdesk.net',
              'Referer': modalUrl
            },
            body: step1Body
          });
          
          if (!step1Response.ok) {
            return { success: false, message: `Step 1 failed: HTTP ${step1Response.status}`, needsWaitlist: true };
          }
          
          // Step 3: 确认预订 (点击 Save)
          const step2Url = baseUrl + 'indexAction.html?src=bookCourtTime';
          
          const step2Response = await fetch(step2Url, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              'Origin': 'https://www.racquetdesk.net',
              'Referer': step1Url
            },
            body: ''
          });
          
          if (!step2Response.ok) {
            // 释放锁
            await fetch(baseUrl + 'indexAction.html?src=unlockCourtTime', { credentials: 'include' });
            return { success: false, message: `Step 2 failed: HTTP ${step2Response.status}`, needsWaitlist: true };
          }
          
          const step2Html = await step2Response.text();
          
          if (step2Html.includes('error') || step2Html.includes('Error') || step2Html.includes('failed')) {
            await fetch(baseUrl + 'indexAction.html?src=unlockCourtTime', { credentials: 'include' });
            return { success: false, message: 'Booking confirmation failed', needsWaitlist: true };
          }
          
          // Step 4: 验证预订成功
          await new Promise(r => setTimeout(r, 500));
          
          const verifyRes = await fetch(modalUrl, { 
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });
          const verifyHtml = await verifyRes.text();
          
          if (verifyHtml.includes('Cancel my booking') || verifyHtml.includes('You are booked')) {
            return { success: true, message: 'Successfully booked!' };
          }
          
          if (verifyHtml.includes('Add me to the waitlist')) {
            return { success: false, message: 'Booking failed, slot full', needsWaitlist: true };
          }
          
          return { success: true, message: 'Booking likely successful' };
          
        } catch (e) {
          try {
            await fetch('https://www.racquetdesk.net/entity/dashboard/indexAction.html?src=unlockCourtTime', {
              credentials: 'include'
            });
          } catch (unlockErr) {}
          
          return { success: false, message: e.message, needsWaitlist: true };
        }
      }, slot.id, userId);

      if (result.sessionExpired) {
        this.loggedIn = false;
        this.emit('status', { isLoggedIn: false });
        db.addLog('WARN', 'Session expired during direct booking');
      } else if (result.success) {
        this.lastActivity = Date.now();
        db.addLog('SUCCESS', `🎯 Direct booked: ${slot.resources || slot.id}`);
      }
      
      return result;
    } catch (error) {
      db.addLog('ERROR', `Direct book error: ${error.message}`);
      return { success: false, message: error.message, needsWaitlist: true };
    }
  }

  // ============ 候补预订 (Waitlist) ============
  async waitlistBook(slot) {
    if (!this.loggedIn || !this.page) {
      return { success: false, message: 'Not logged in', sessionExpired: true };
    }

    try {
      db.addLog('INFO', `📋 Waitlist booking: ${slot.resources || slot.id}`);
      
      const result = await this.page.evaluate(async (slotId) => {
        const checkUrl = `https://www.racquetdesk.net/entity/dashboard/modalMember.html?aID=${slotId}`;
        
        try {
          const checkResponse = await fetch(checkUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'X-Requested-With': 'XMLHttpRequest',
              'Referer': 'https://www.racquetdesk.net/entity/dashboard/indexAction.html'
            }
          });
          
          if (checkResponse.url.includes('login')) {
            return { success: false, message: 'Session expired', sessionExpired: true };
          }
          
          if (!checkResponse.ok) {
            return { success: false, message: `HTTP ${checkResponse.status}` };
          }
          
          const html = await checkResponse.text();
          
          if (html.includes('Remove me from the waitlist')) {
            return { success: true, message: 'Already on waitlist', alreadyOnWaitlist: true };
          }
          
          if (html.includes('Cancel my booking') || html.includes('You are booked')) {
            return { success: true, message: 'Already booked', alreadyBooked: true };
          }
          
          if (!html.includes('Add me to the waitlist')) {
            if (html.includes('not available')) {
              return { success: false, message: 'Slot not available yet' };
            }
            return { success: false, message: 'Waitlist option not available' };
          }
          
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const form = doc.querySelector('form[action*="addToWaitlist"]');
          
          if (!form) {
            return { success: false, message: 'Add to waitlist form not found' };
          }
          
          const fxObjectID = form.querySelector('input[name="fxObjectID"]')?.value;
          const fListObjectTypeID = form.querySelector('input[name="fListObjectTypeID"]')?.value;
          const aID = form.querySelector('input[name="aID"]')?.value;
          
          if (!fxObjectID || !fListObjectTypeID || !aID) {
            return { success: false, message: 'Missing form fields' };
          }
          
          const postBody = `fxObjectID=${fxObjectID}&fListObjectTypeID=${fListObjectTypeID}&aID=${aID}`;
          
          const bookResponse = await fetch('https://www.racquetdesk.net/entity/dashboard/indexAction.html?src=addToWaitlist', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              'Origin': 'https://www.racquetdesk.net',
              'Referer': checkUrl
            },
            body: postBody
          });
          
          if (!bookResponse.ok) {
            return { success: false, message: `POST failed: HTTP ${bookResponse.status}` };
          }
          
          await new Promise(r => setTimeout(r, 1000));
          
          const verifyRes = await fetch(checkUrl, { 
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });
          const verifyHtml = await verifyRes.text();
          
          if (verifyHtml.includes('Remove me from the waitlist')) {
            return { success: true, message: 'Successfully added to waitlist' };
          }
          
          return { success: false, message: 'Verification failed' };
        } catch (e) {
          return { success: false, message: e.message };
        }
      }, slot.id);

      if (result.sessionExpired) {
        this.loggedIn = false;
        this.emit('status', { isLoggedIn: false });
        db.addLog('WARN', 'Session expired during waitlist booking');
      } else if (result.success) {
        this.lastActivity = Date.now();
        db.addLog('SUCCESS', `📋 Waitlist: ${slot.resources || slot.id}`);
      }
      
      return result;
    } catch (error) {
      db.addLog('ERROR', `Waitlist error: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  // ============ 智能预订 (根据模式选择) ============
  async smartBook(slot, mode = 'waitlist') {
    db.addLog('INFO', `Smart booking (${mode}): ${slot.resources || slot.id}`);
    
    // 仅候补模式
    if (mode === 'waitlist') {
      return await this.waitlistBook(slot);
    }
    
    // 抢订+候补模式：先尝试直接预订
    const directResult = await this.directBook(slot);
    
    if (directResult.success) {
      return directResult;
    }
    
    if (directResult.alreadyBooked || directResult.alreadyOnWaitlist) {
      return directResult;
    }
    
    if (directResult.sessionExpired) {
      return directResult;
    }
    
    // 直接预订失败，自动切换到候补
    if (directResult.needsWaitlist) {
      db.addLog('INFO', `📋 Direct failed, trying waitlist: ${slot.resources || slot.id}`);
      const waitlistResult = await this.waitlistBook(slot);
      return {
        ...waitlistResult,
        fallbackToWaitlist: true,
        originalError: directResult.message
      };
    }
    
    return directResult;
  }

  // 保持向后兼容
  async bookSlot(slot) {
    return await this.waitlistBook(slot);
  }

  async logout() {
    console.log('Logging out...');
    this.loggedIn = false;
    this.lastActivity = null;
    
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {
        console.log('Browser close error:', e.message);
      }
      this.browser = null;
      this.page = null;
    }
    
    this.emit('status', { state: 'logged_out', isLoggedIn: false });
    db.addLog('INFO', 'Logged out');
  }

  async close() {
    this.stopHeartbeat();
    await this.logout();
  }
}

module.exports = new Booker();

