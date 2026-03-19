// core/history.js — 命令历史管理（从 index.js 提取）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dbApi from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.join(__dirname, '..');
const HISTORY_FILE = path.join(BASE_DIR, 'command-history.json');
const ARCHIVE_DIR = path.join(BASE_DIR, 'history-archives');
const MAX_HISTORY = 500;
const ARCHIVE_THRESHOLD = 400;

let commandHistory = [];
let historyIdCounter = 1;
let logger = { info: console.log, warning: console.warn };

function init(loggerInstance) {
  logger = loggerInstance;
  load();
  // 同步 SQLite 的最大 id，防止 INSERT OR IGNORE 因 id 冲突被跳过
  try {
    const row = dbApi.query('SELECT MAX(id) as maxId FROM commands');
    const dbMaxId = (row && row[0] && row[0].maxId) || 0;
    if (dbMaxId >= historyIdCounter) {
      historyIdCounter = dbMaxId + 1;
      logger.info('[History] 同步 SQLite maxId=' + dbMaxId + ', nextId=' + historyIdCounter);
    }
  } catch(e) { /* ignore */ }
}

function load() {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
      commandHistory = data.history || [];
      historyIdCounter = data.nextId || 1;
      logger.info(`加载了 ${commandHistory.length} 条历史记录`);
    }
  } catch (e) {
    logger.warning('加载历史记录失败: ' + e.message);
    commandHistory = [];
    historyIdCounter = 1;
  }
}

function save() {
  try {
    writeFileSync(HISTORY_FILE, JSON.stringify({
      history: commandHistory,
      nextId: historyIdCounter
    }, null, 2));
  } catch (e) {
    logger.warning('保存历史记录失败: ' + e.message);
  }
}

function archiveOld() {
  try {
    if (!existsSync(ARCHIVE_DIR)) {
      mkdirSync(ARCHIVE_DIR, { recursive: true });
    }
    const toArchive = commandHistory.slice(0, commandHistory.length - ARCHIVE_THRESHOLD);
    commandHistory = commandHistory.slice(-ARCHIVE_THRESHOLD);
    if (toArchive.length === 0) return;

    const date = new Date().toISOString().split('T')[0];
    const archiveFile = path.join(ARCHIVE_DIR, `archive-${date}.json`);
    let archiveData = { archived: [], meta: {} };
    if (existsSync(archiveFile)) {
      archiveData = JSON.parse(readFileSync(archiveFile, 'utf-8'));
    }
    archiveData.archived.push(...toArchive);
    archiveData.meta.lastUpdate = new Date().toISOString();
    archiveData.meta.count = archiveData.archived.length;
    archiveData.meta.idRange = {
      from: archiveData.archived[0]?.id,
      to: archiveData.archived[archiveData.archived.length - 1]?.id
    };
    writeFileSync(archiveFile, JSON.stringify(archiveData, null, 2));
    logger.info(`归档了 ${toArchive.length} 条历史记录到 ${archiveFile}`);
  } catch (e) {
    logger.warning('归档历史记录失败: ' + e.message);
    commandHistory = commandHistory.slice(-MAX_HISTORY);
  }
}

function add(tool, params, success, resultPreview, error = null) {
  const entry = {
    id: historyIdCounter++,
    timestamp: new Date().toISOString(),
    tool, params, success,
    resultPreview: (resultPreview || '').substring(0, 500),
    error: error || null
  };
  commandHistory.push(entry);
  if (commandHistory.length > MAX_HISTORY) archiveOld();
  save();
  // 同步写入 SQLite
  try { dbApi.addCommand(entry); } catch(e) { /* ignore db write errors */ }
  return entry.id;
}

function get(count = 20) {
  return commandHistory.slice(-count).reverse();
}

function getById(id) {
  return commandHistory.find(h => h.id === id);
}

function getRaw() { return commandHistory; }

function updateById(id, updates) {
  const entry = commandHistory.find(h => h.id === id);
  if (entry) Object.assign(entry, updates);
  save();
  return entry;
}

export default { init, add, get, getById, getRaw, updateById };
