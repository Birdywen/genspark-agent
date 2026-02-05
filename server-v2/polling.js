const db = require('./database');

class PollingEngine {
  constructor() {
    this.io = null;
    this.booker = null;
    this.active = false;
    this.intervalId = null;
    this.schedulerIntervalId = null;
    this.preLoginDone = false;
    this.state = {
      active: false,
      attempts: 0,
      successCount: 0,
      lastAttempt: null,
      lastResult: null,
      startedAt: null
    };
  }

  init(io, booker) {
    this.io = io;
    this.booker = booker;
  }

  emit(event, data) {
    if (this.io) this.io.emit(event, data);
  }

  getState() {
    return { ...this.state };
  }

  async ensureLoggedIn() {
    if (this.booker.isLoggedIn()) {
      return { success: true };
    }

    console.log('Session expired, attempting re-login...');
    db.addLog('WARN', 'Session expired, attempting re-login...');
    this.emit('log', { level: 'WARN', message: 'Re-logging in...', timestamp: new Date().toISOString() });

    try {
      const loginResult = await this.booker.smartLogin();
      
      if (loginResult.success) {
        db.addLog('SUCCESS', 'Re-login successful');
        this.emit('log', { level: 'SUCCESS', message: 'Re-login successful', timestamp: new Date().toISOString() });
        return { success: true };
      } else {
        db.addLog('ERROR', `Re-login failed: ${loginResult.error}`);
        return { success: false, error: loginResult.error };
      }
    } catch (error) {
      db.addLog('ERROR', `Re-login error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  isWithinPreLoginWindow(settings) {
    const PRE_LOGIN_SECONDS = 5 * 60; // 5 minutes in seconds
    
    const now = new Date();
    const nyTimeStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nyTime = new Date(nyTimeStr);
    const currentSeconds = nyTime.getHours() * 3600 + nyTime.getMinutes() * 60 + nyTime.getSeconds();
    
    const startParts = settings.startTime.split(':').map(Number);
    const startSeconds = startParts[0] * 3600 + startParts[1] * 60 + (startParts[2] || 0);
    const preLoginStart = startSeconds - PRE_LOGIN_SECONDS;

    return currentSeconds >= preLoginStart && currentSeconds < startSeconds;
  }

  async preLogin() {
    if (this.preLoginDone || this.booker.isLoggedIn()) {
      return;
    }

    const tasks = db.getTasks();
    const today = new Date().toISOString().split('T')[0];
    const pendingTasks = tasks.filter(t => t.scheduleDate >= today);
    
    if (pendingTasks.length === 0) return;

    console.log('⏰ Pre-login: Logging in before polling window...');
    db.addLog('INFO', 'Pre-login: Preparing session before polling starts');
    this.emit('log', { level: 'INFO', message: 'Pre-login: Solving captcha now...', timestamp: new Date().toISOString() });

    try {
      const result = await this.booker.smartLogin();
      if (result.success) {
        this.preLoginDone = true;
        db.addLog('SUCCESS', 'Pre-login successful, ready for polling');
        this.emit('log', { level: 'SUCCESS', message: '✓ Ready! Waiting for polling window...', timestamp: new Date().toISOString() });
      } else {
        db.addLog('ERROR', `Pre-login failed: ${result.error}`);
      }
    } catch (error) {
      db.addLog('ERROR', `Pre-login error: ${error.message}`);
    }
  }

  async start() {
    if (this.active) {
      console.log('Polling already active');
      return;
    }

    const settings = db.getPollingSettings();
    const bookingMode = settings.bookingMode || 'waitlist';
    console.log('Starting polling with settings:', settings);

    const loginCheck = await this.ensureLoggedIn();
    if (!loginCheck.success) {
      throw new Error(loginCheck.error || 'Login failed');
    }

    this.active = true;
    this.state = {
      active: true,
      attempts: 0,
      successCount: 0,
      lastAttempt: null,
      lastResult: null,
      startedAt: Date.now()
    };

    const modeText = bookingMode === 'book' ? '🎯 Book + Waitlist' : '📋 Waitlist Only';
    db.addLog('INFO', `🚀 Polling started! Mode: ${modeText}, Interval: ${settings.intervalSeconds}s`);
    this.emit('polling', this.state);

    await this.poll();

    this.intervalId = setInterval(async () => {
      if (this.active) await this.poll();
    }, settings.intervalSeconds * 1000);
  }

  stop() {
    console.log('Stopping polling...');
    this.active = false;
    this.preLoginDone = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.state.active = false;
    db.addLog('INFO', 'Polling stopped');
    this.emit('polling', this.state);
  }

  async poll() {
    if (!this.active) return;

    const settings = db.getPollingSettings();
    const bookingMode = settings.bookingMode || 'waitlist';
    
    if (!this.isWithinTimeWindow(settings)) {
      console.log('Outside polling time window');
      return;
    }

    if (this.state.attempts >= settings.maxAttempts) {
      console.log('Max attempts reached');
      db.addLog('WARN', `Polling stopped: max attempts (${settings.maxAttempts}) reached`);
      this.stop();
      return;
    }

    const loginCheck = await this.ensureLoggedIn();
    if (!loginCheck.success) {
      db.addLog('ERROR', 'Poll skipped: not logged in');
      return;
    }

    this.state.attempts++;
    this.state.lastAttempt = Date.now();
    
    console.log(`Poll attempt ${this.state.attempts}/${settings.maxAttempts}`);
    this.emit('polling', this.state);

    const tasks = db.getTasks();
    const today = new Date().toISOString().split('T')[0];
    const pendingTasks = tasks.filter(t => t.scheduleDate >= today);

    if (pendingTasks.length === 0) {
      console.log('No pending tasks');
      return;
    }

    console.log(`Polling ${pendingTasks.length} tasks...`);
    const results = [];

    for (const task of pendingTasks) {
      try {
        // ===== 修改：使用 task 自己的 mode =====
        const taskMode = task.mode || bookingMode;
        console.log(`Processing slot ${task.slot.id} in ${taskMode} mode...`);
        
        const result = await this.booker.smartBook(task.slot, taskMode);
        
        results.push({
          taskId: task.id,
          slotId: task.slot.id,
          ...result
        });

        if (result.success || result.alreadyOnWaitlist || result.alreadyBooked) {
          this.state.successCount++;
          db.removeTask(task.id);
          
          let successMsg = '';
          if (result.alreadyBooked) {
            successMsg = `✓ Already booked: ${task.slot.resources || task.slot.id}`;
          } else if (result.fallbackToWaitlist) {
            successMsg = `📋 Added to waitlist (slot full): ${task.slot.resources || task.slot.id}`;
          } else if (result.alreadyOnWaitlist) {
            successMsg = `✓ Already on waitlist: ${task.slot.resources || task.slot.id}`;
          } else if (taskMode === 'book') {
            successMsg = `🎯 Booked: ${task.slot.resources || task.slot.id}`;
          } else {
            successMsg = `📋 Waitlisted: ${task.slot.resources || task.slot.id}`;
          }
          
          db.addLog('SUCCESS', successMsg);
          this.emit('booking_success', { task, result });
        } else if (result.message && result.message.includes('not available')) {
          console.log(`Slot ${task.slot.id} not yet available, will retry...`);
        } else if (result.sessionExpired) {
          db.addLog('WARN', 'Session expired during polling, will re-login on next poll');
          break;
        } else {
          console.log(`Slot ${task.slot.id}: ${result.message}`);
        }

        await this.sleep(300);
      } catch (error) {
        console.error(`Error polling task ${task.id}:`, error);
        results.push({ taskId: task.id, success: false, error: error.message });
        
        if (error.message.includes('Not logged in') || error.message.includes('401')) {
          db.addLog('WARN', 'Session expired during polling');
          break;
        }
      }
    }

    this.state.lastResult = {
      timestamp: Date.now(),
      results,
      successCount: results.filter(r => r.success).length
    };

    this.emit('polling', this.state);
    this.emit('tasks', db.getTasks());

    const remainingTasks = db.getTasks().filter(t => t.scheduleDate >= today);
    if (remainingTasks.length === 0 && settings.stopOnSuccess) {
      console.log('All tasks completed!');
      db.addLog('SUCCESS', '🎉 All tasks completed!');
      this.stop();
    }
  }

  isWithinTimeWindow(settings) {
    const now = new Date();
    const nyTimeStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nyTime = new Date(nyTimeStr);
    const currentSeconds = nyTime.getHours() * 3600 + nyTime.getMinutes() * 60 + nyTime.getSeconds();
    
    const startParts = settings.startTime.split(':').map(Number);
    const endParts = settings.endTime.split(':').map(Number);
    const startSeconds = startParts[0] * 3600 + startParts[1] * 60 + (startParts[2] || 0);
    const endSeconds = endParts[0] * 3600 + endParts[1] * 60 + (endParts[2] || 0);

    if (endSeconds < startSeconds) {
      return currentSeconds >= startSeconds || currentSeconds <= endSeconds;
    }
    return currentSeconds >= startSeconds && currentSeconds <= endSeconds;
  }

  initScheduler() {
    console.log('Initializing polling scheduler...');
    
    this.schedulerIntervalId = setInterval(() => {
      this.checkScheduledStart();
    }, 10000);

    this.checkScheduledStart();
  }

  checkScheduledStart() {
    const settings = db.getPollingSettings();
    if (!settings.enabled) return;

    const tasks = db.getTasks();
    const today = new Date().toISOString().split('T')[0];
    const pendingTasks = tasks.filter(t => t.scheduleDate >= today);
    
    if (pendingTasks.length === 0) return;

    if (!this.active && !this.preLoginDone && this.isWithinPreLoginWindow(settings)) {
      console.log('Within pre-login window, logging in early...');
      this.preLogin().catch(e => {
        console.error('Pre-login failed:', e);
      });
      return;
    }

    if (!this.active && this.isWithinTimeWindow(settings)) {
      console.log('Within polling window, starting...');
      db.addLog('INFO', '🚀 Auto-starting polling!');
      this.start().catch(e => {
        console.error('Auto-start failed:', e);
        db.addLog('ERROR', `Auto-start failed: ${e.message}`);
      });
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new PollingEngine();


