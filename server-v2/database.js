const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILES = {
  settings: path.join(DATA_DIR, 'settings.json'),
  tasks: path.join(DATA_DIR, 'tasks.json'),
  favorites: path.join(DATA_DIR, 'favorites.json'),
  cookies: path.join(DATA_DIR, 'cookies.json'),
  logs: path.join(DATA_DIR, 'logs.json'),
  polling: path.join(DATA_DIR, 'polling.json')
};

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULTS = {
  settings: {
    rd_username: process.env.RD_USERNAME || '',
    rd_password: process.env.RD_PASSWORD || '',
    rd_user_id: process.env.RD_USER_ID || '',
    captcha_api_key: process.env.CAPTCHA_API_KEY || ''
  },
  tasks: [],
  favorites: [],
  cookies: [],
  logs: [],
  polling: {
    enabled: true,
    intervalSeconds: 3,
    startTime: '12:00:00',
    endTime: '12:20:00',
    maxAttempts: 500,
    stopOnSuccess: true
  }
};

function readFile(file, defaultValue) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${file}:`, e.message);
  }
  return defaultValue;
}

function writeFile(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error writing ${file}:`, e.message);
  }
}

function getSettings() { return readFile(FILES.settings, DEFAULTS.settings); }
function saveSettings(settings) { writeFile(FILES.settings, settings); }
function getPollingSettings() { return readFile(FILES.polling, DEFAULTS.polling); }
function savePollingSettings(settings) { 
  const current = getPollingSettings();
  writeFile(FILES.polling, { ...current, ...settings }); 
}
function getTasks() { return readFile(FILES.tasks, DEFAULTS.tasks); }

// ===== 修改：添加 mode 参数 =====
function addTask(slot, scheduleDate, mode = 'waitlist') {
  const tasks = getTasks();
  const exists = tasks.some(t => t.slot.id === slot.id && t.scheduleDate === scheduleDate);
  if (exists) throw new Error('Task already exists');
  
  const task = {
    id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    slot,
    scheduleDate,
    mode,
    createdAt: Date.now()
  };
  tasks.push(task);
  writeFile(FILES.tasks, tasks);
  return task;
}

function removeTask(taskId) {
  const tasks = getTasks().filter(t => t.id !== taskId);
  writeFile(FILES.tasks, tasks);
}

function clearTasks() { writeFile(FILES.tasks, []); }

function updateTask(taskId, updates) {
  const tasks = getTasks();
  const index = tasks.findIndex(t => t.id === taskId);
  if (index !== -1) {
    tasks[index] = { ...tasks[index], ...updates };
    writeFile(FILES.tasks, tasks);
  }
}

function getFavorites() { return readFile(FILES.favorites, DEFAULTS.favorites); }

function addFavorite(favorite) {
  const favorites = getFavorites();
  const exists = favorites.some(f => f.timeKey === favorite.timeKey);
  if (exists) throw new Error('Favorite already exists');
  
  const fav = { id: `fav_${Date.now()}`, ...favorite };
  favorites.push(fav);
  writeFile(FILES.favorites, favorites);
  return fav;
}

function removeFavorite(favId) {
  const favorites = getFavorites().filter(f => f.id !== favId);
  writeFile(FILES.favorites, favorites);
}

function getCookies() { return readFile(FILES.cookies, DEFAULTS.cookies); }
function saveCookies(cookies) { writeFile(FILES.cookies, cookies); }
function clearCookies() { writeFile(FILES.cookies, []); }

function getLogs(limit = 100) {
  const logs = readFile(FILES.logs, DEFAULTS.logs);
  return logs.slice(-limit).reverse();
}

function addLog(level, message) {
  const logs = readFile(FILES.logs, DEFAULTS.logs);
  const log = { id: Date.now(), level, message, timestamp: new Date().toISOString() };
  logs.push(log);
  if (logs.length > 1000) logs.splice(0, logs.length - 1000);
  writeFile(FILES.logs, logs);
  const prefix = { INFO: '📘', WARN: '⚠️', ERROR: '❌', SUCCESS: '✅' }[level] || '📝';
  console.log(`${prefix} [${level}] ${message}`);
  return log;
}

function clearLogs() { writeFile(FILES.logs, []); }

module.exports = {
  getSettings, saveSettings,
  getPollingSettings, savePollingSettings,
  getTasks, addTask, removeTask, clearTasks, updateTask,
  getFavorites, addFavorite, removeFavorite,
  getCookies, saveCookies, clearCookies,
  getLogs, addLog, clearLogs
};
