require('dotenv').config();

const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const db = require('./database');
const booker = require('./booker');
const polling = require('./polling');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'racquetdesk-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

booker.init(io);
polling.init(io, booker);

function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login');
}

app.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.admin = true;
    res.redirect('/');
  } else {
    res.render('login', { error: 'Invalid password' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/', requireAuth, (req, res) => {
  const pollingSettings = db.getPollingSettings();
  res.render('dashboard', {
    settings: { ...db.getSettings(), rd_password: db.getSettings().rd_password ? '••••••••' : '' },
    pollingSettings: pollingSettings,
    bookingMode: pollingSettings.bookingMode || 'waitlist',
    tasks: db.getTasks(),
    favorites: db.getFavorites(),
    logs: db.getLogs(50),
    pollingState: polling.getState(),
    isLoggedIn: booker.isLoggedIn()
  });
});

// Connection check
app.get('/api/connection-check', requireAuth, async (req, res) => {
  try {
    const result = await booker.checkConnection();
    res.json({ ...result, lastActivity: booker.getLastActivity() });
  } catch (error) {
    res.status(500).json({ connected: false, error: error.message });
  }
});

app.post('/api/keep-alive', requireAuth, async (req, res) => {
  try {
    const result = await booker.keepAlive();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Settings API
app.get('/api/settings', requireAuth, (req, res) => {
  const s = db.getSettings();
  res.json({ ...s, rd_password: s.rd_password ? '••••••••' : '', captcha_api_key: s.captcha_api_key ? '••••' + s.captcha_api_key.slice(-4) : '' });
});

app.post('/api/settings', requireAuth, (req, res) => {
  try {
    const { rd_username, rd_password, rd_user_id, captcha_api_key } = req.body;
    const current = db.getSettings();
    const updated = { ...current, rd_username: rd_username || current.rd_username, rd_user_id: rd_user_id || current.rd_user_id };
    if (rd_password && rd_password !== '••••••••') updated.rd_password = rd_password;
    if (captcha_api_key && !captcha_api_key.startsWith('••••')) updated.captcha_api_key = captcha_api_key;
    db.saveSettings(updated);
    db.addLog('INFO', 'Settings updated');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Polling settings
app.get('/api/polling/settings', requireAuth, (req, res) => res.json(db.getPollingSettings()));

app.post('/api/polling/settings', requireAuth, (req, res) => {
  try {
    db.savePollingSettings(req.body);
    db.addLog('INFO', 'Polling settings updated');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== Booking Mode API ==========
app.get('/api/booking-mode', requireAuth, (req, res) => {
  const settings = db.getPollingSettings();
  res.json({ mode: settings.bookingMode || 'waitlist' });
});

app.post('/api/booking-mode', requireAuth, (req, res) => {
  const { mode } = req.body;
  if (!['book', 'waitlist'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  const current = db.getPollingSettings();
  db.savePollingSettings({ ...current, bookingMode: mode });
  io.emit('booking_mode', { mode });
  db.addLog('INFO', `Booking mode changed to: ${mode === 'book' ? '🎯 Book + Waitlist' : '📋 Waitlist Only'}`);
  res.json({ success: true, mode });
});

// RacquetDesk login/logout
app.post('/api/login-rd', requireAuth, async (req, res) => {
  try {
    db.addLog('INFO', 'Starting RacquetDesk login...');
    const result = await booker.smartLogin();
    db.addLog(result.success ? 'INFO' : 'ERROR', result.success ? 'RacquetDesk login successful' : `Login failed: ${result.error}`);
    res.json(result);
  } catch (error) {
    db.addLog('ERROR', `Login error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Manual login mode - opens browser and waits for user to complete login
app.post('/api/manual-login', requireAuth, async (req, res) => {
  try {
    db.addLog('INFO', 'Starting manual login mode (5 min timeout)...');
    const result = await booker.manualLogin(5);
    db.addLog(result.success ? 'SUCCESS' : 'ERROR', result.success ? 'Manual login successful, cookies saved!' : `Manual login failed: ${result.reason}`);
    res.json(result);
  } catch (error) {
    db.addLog('ERROR', `Manual login error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/logout-rd', requireAuth, async (req, res) => {
  try {
    await booker.logout();
    db.addLog('INFO', 'RacquetDesk session closed');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Schedule
app.get('/api/schedule/:date', requireAuth, async (req, res) => {
  try {
    db.addLog('INFO', `Fetching schedule for ${req.params.date}`);
    const result = await booker.fetchSchedule(req.params.date);
    res.json(result);
  } catch (error) {
    db.addLog('ERROR', `Fetch schedule error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ========== Book Now (with mode support) ==========
app.post('/api/book-now', requireAuth, async (req, res) => {
  try {
    const { slot, mode } = req.body;
    const bookingMode = mode || db.getPollingSettings().bookingMode || 'waitlist';
    
    db.addLog('INFO', `Booking slot ${slot.id} (mode: ${bookingMode})`);
    const result = await booker.smartBook(slot, bookingMode);
    
    if (result.success) {
      if (result.fallbackToWaitlist) {
        db.addLog('SUCCESS', `📋 Added to waitlist (direct booking failed): ${slot.resources || slot.id}`);
      } else if (result.alreadyBooked) {
        db.addLog('INFO', `Already booked: ${slot.resources || slot.id}`);
      } else if (result.alreadyOnWaitlist) {
        db.addLog('INFO', `Already on waitlist: ${slot.resources || slot.id}`);
      } else {
        db.addLog('SUCCESS', `🎯 Booked: ${slot.resources || slot.id}`);
      }
    } else {
      db.addLog('WARN', `Booking failed: ${result.message}`);
    }
    
    res.json(result);
  } catch (error) {
    db.addLog('ERROR', `Book error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/my-bookings', requireAuth, async (req, res) => {
  try {
    res.json(await booker.fetchMyBookings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== My Bookings API (新增) ==========
app.get('/api/my-bookings-data', requireAuth, async (req, res) => {
  try {
    const result = await booker.fetchMyBookingsData();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, appointments: [], waitlists: [] });
  }
});

app.post('/api/cancel-appointment', requireAuth, async (req, res) => {
  try {
    const { apptId, oId, otId } = req.body;
    const result = await booker.cancelAppointment(apptId, oId, otId);
    if (result.success) {
      db.addLog('SUCCESS', `Cancelled appointment: ${apptId}`);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/cancel-waitlist', requireAuth, async (req, res) => {
  try {
    const { aId, fxObjectID } = req.body;
    const result = await booker.cancelWaitlist(aId, fxObjectID);
    if (result.success) {
      db.addLog('SUCCESS', `Cancelled waitlist: ${aId}`);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/cancel-batch', requireAuth, async (req, res) => {
  try {
    const { items } = req.body;
    const results = [];
    
    for (const item of items) {
      let result;
      if (item.type === 'appointment') {
        result = await booker.cancelAppointment(item.id, item.oId, item.otId);
      } else {
        result = await booker.cancelWaitlist(item.id, item.fxObjectID);
      }
      results.push({ ...item, ...result });
      await new Promise(r => setTimeout(r, 500));
    }
    
    const successCount = results.filter(r => r.success).length;
    db.addLog('INFO', `Batch cancel: ${successCount}/${items.length} succeeded`);
    
    res.json({ success: true, results, successCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Tasks API
app.get('/api/tasks', requireAuth, (req, res) => res.json(db.getTasks()));

// ===== 修改：添加 mode 支持 =====
app.post('/api/tasks', requireAuth, (req, res) => {
  try {
    const { slot, scheduleDate, mode } = req.body;
    const task = db.addTask(slot, scheduleDate, mode || 'waitlist');
    const modeText = (mode || 'waitlist') === 'book' ? '🎯 Book' : '📋 Waitlist';
    db.addLog('INFO', `Task added (${modeText}): ${slot.resources || slot.id}`);
    io.emit('tasks', db.getTasks());
    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  try {
    db.removeTask(req.params.id);
    db.addLog('INFO', `Task removed: ${req.params.id}`);
    io.emit('tasks', db.getTasks());
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tasks', requireAuth, (req, res) => {
  try {
    db.clearTasks();
    db.addLog('INFO', 'All tasks cleared');
    io.emit('tasks', []);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Favorites API
app.get('/api/favorites', requireAuth, (req, res) => res.json(db.getFavorites()));

app.post('/api/favorites', requireAuth, (req, res) => {
  try {
    const favorite = db.addFavorite(req.body);
    db.addLog('INFO', `Favorite added`);
    res.json({ success: true, favorite });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/favorites/:id', requireAuth, (req, res) => {
  try {
    db.removeFavorite(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Polling API
app.get('/api/polling/status', requireAuth, (req, res) => res.json(polling.getState()));

app.post('/api/polling/start', requireAuth, async (req, res) => {
  try {
    await polling.start();
    db.addLog('INFO', 'Polling started manually');
    res.json({ success: true, state: polling.getState() });
  } catch (error) {
    db.addLog('ERROR', `Polling start error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/polling/stop', requireAuth, (req, res) => {
  try {
    polling.stop();
    db.addLog('INFO', 'Polling stopped');
    res.json({ success: true, state: polling.getState() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logs API
app.get('/api/logs', requireAuth, (req, res) => res.json(db.getLogs(parseInt(req.query.limit) || 100)));
app.delete('/api/logs', requireAuth, (req, res) => { db.clearLogs(); res.json({ success: true }); });

// Status API
app.get('/api/status', requireAuth, (req, res) => {
  const pollingSettings = db.getPollingSettings();
  res.json({ 
    isLoggedIn: booker.isLoggedIn(), 
    polling: polling.getState(), 
    tasks: db.getTasks().length, 
    favorites: db.getFavorites().length,
    bookingMode: pollingSettings.bookingMode || 'waitlist'
  });
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  const pollingSettings = db.getPollingSettings();
  socket.emit('status', { 
    isLoggedIn: booker.isLoggedIn(), 
    polling: polling.getState(),
    bookingMode: pollingSettings.bookingMode || 'waitlist'
  });
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ============ Render Anti-Sleep (防休眠) ============
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_URL;

if (RENDER_URL) {
  const pingInterval = 14 * 60 * 1000; // 14 分钟
  
  setInterval(async () => {
    try {
      const response = await fetch(`${RENDER_URL}/health`);
      console.log(`[Anti-Sleep] Ping sent: ${response.status}`);
    } catch (error) {
      console.log(`[Anti-Sleep] Ping failed: ${error.message}`);
    }
  }, pingInterval);
  
  console.log(`[Anti-Sleep] Enabled, pinging every 14 minutes`);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});




// ===== 定时登录状态检测 =====
function scheduleLoginCheck() {
  // 从设置中读取检测时间，默认 09:00, 12:00, 18:00, 21:00
  const settings = db.getSettings();
  const checkTimes = settings.login_check_times || ['09:00', '12:00', '18:00', '21:00'];
  
  setInterval(async () => {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    
    if (checkTimes.includes(timeStr)) {
      console.log('⏰ Scheduled login check at', timeStr);
      db.addLog('INFO', 'Scheduled login status check');
      
      if (!booker.isLoggedIn()) {
        console.log('🔄 Not logged in, attempting auto-login...');
        db.addLog('INFO', 'Auto-login attempt started');
        
        try {
          const result = await booker.connect(db.getSettings());
          if (result.success) {
            db.addLog('SUCCESS', '✅ Auto-login successful');
            io.emit('status', { isLoggedIn: true, message: 'Auto-login successful' });
          } else {
            db.addLog('ERROR', 'Auto-login failed: ' + result.error);
            io.emit('status', { isLoggedIn: false, message: 'Auto-login failed', needManualLogin: true });
          }
        } catch (err) {
          db.addLog('ERROR', 'Auto-login error: ' + err.message);
        }
      } else {
        db.addLog('INFO', '✅ Already logged in');
      }
    }
  }, 60000); // 每分钟检查一次时间
  
  console.log('📅 Scheduled login checks at:', checkTimes.join(', '));
}

scheduleLoginCheck();

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║   🎾 RacquetDesk Auto-Booker Web Server                       ║
║   Dashboard: http://localhost:${PORT}                            ║
║   Password:  ${ADMIN_PASSWORD}                                          ║
╚════════════════════════════════════════════════════════════════╝
  `);
  db.addLog('INFO', 'Server started on port ' + PORT);
  polling.initScheduler();
});

process.on('SIGINT', async () => { console.log('\nShutting down...'); polling.stop(); await booker.close(); process.exit(0); });
process.on('SIGTERM', async () => { console.log('\nShutting down...'); polling.stop(); await booker.close(); process.exit(0); });
