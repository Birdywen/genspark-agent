/**
 * Notification helper - writes messages that extension can pick up
 */
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';

const NOTIFY_FILE = '/tmp/genspark-agent-notify.json';

export function notify(message, type = 'info') {
  const notification = {
    timestamp: new Date().toISOString(),
    type,
    message,
    read: false
  };
  writeFileSync(NOTIFY_FILE, JSON.stringify(notification, null, 2));
  console.log(`[notify] ${type}: ${message}`);
}

export function getNotification() {
  if (!existsSync(NOTIFY_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(NOTIFY_FILE, 'utf-8'));
    return data;
  } catch {
    return null;
  }
}

export function clearNotification() {
  if (existsSync(NOTIFY_FILE)) {
    unlinkSync(NOTIFY_FILE);
  }
}
