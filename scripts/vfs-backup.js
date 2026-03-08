#!/usr/bin/env node
/**
 * VFS 2.0 Backup/Restore Script
 * Runs standalone on any server with Node.js - no browser needed.
 *
 * Usage:
 *   node vfs-backup.js backup [--output FILE]
 *   node vfs-backup.js restore <FILE>
 *   node vfs-backup.js export <CONVERSATION_ID>
 *   node vfs-backup.js ls
 *
 * Requires: GENSPARK_COOKIE env var or ~/.genspark-cookie file
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://www.genspark.ai';
const REGISTRY_ID = '9045a811-9a4c-4d33-ad79-31c12cebd911';

function getCookie() {
  if (process.env.GENSPARK_COOKIE) return process.env.GENSPARK_COOKIE;
  var cookieFile = path.join(process.env.HOME || '/root', '.genspark-cookie');
  if (fs.existsSync(cookieFile)) return fs.readFileSync(cookieFile, 'utf8').trim();
  console.error('ERROR: Set GENSPARK_COOKIE env var or create ~/.genspark-cookie');
  process.exit(1);
}

function apiCall(id, updates) {
  return new Promise(function(resolve, reject) {
    var payload = Object.assign({ id: id, request_not_update_permission: true }, updates || {});
    var body = JSON.stringify(payload);
    var opts = {
      hostname: 'www.genspark.ai',
      port: 443,
      path: '/api/project/update',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Cookie': getCookie()
      }
    };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.data) resolve(json.data);
          else reject(new Error('API error: ' + data.substring(0, 200)));
        } catch(e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function readSlot(id) {
  var data = await apiCall(id);
  return data.name || '';
}

async function readSlotFull(id) {
  return apiCall(id);
}

async function writeSlot(id, text) {
  var data = await apiCall(id, { name: text });
  return (data.name || '').length;
}

async function readSlotMessages(id) {
  var data = await apiCall(id);
  return (data.session_state && data.session_state.messages) || [];
}

async function writeSlotMessages(id, messages) {
  var data = await readSlotFull(id);
  var ss = data.session_state || {};
  ss.messages = messages;
  var result = await apiCall(id, { session_state: ss });
  return (result.session_state && result.session_state.messages) ? result.session_state.messages.length : 0;
}

async function getRegistry() {
  var raw = await readSlot(REGISTRY_ID);
  if (!raw) throw new Error('Registry empty');
  return JSON.parse(raw);
}

async function cmdLs() {
  var reg = await getRegistry();
  var slots = reg.slots || {};
  var names = Object.keys(slots);
  console.log('VFS Slots (' + names.length + '):');
  console.log('────────────────────────────────────────');
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var info = slots[name];
    var content = await readSlot(info.id);
    var msgs = await readSlotMessages(info.id);
    console.log('  ' + name);
    console.log('    id: ' + info.id);
    console.log('    name channel: ' + (content || '').length + ' chars');
    console.log('    messages: ' + msgs.length + ' entries');
    console.log('    desc: ' + (info.desc || '-'));
  }
}

async function cmdBackup(outputFile) {
  var reg = await getRegistry();
  var slotsResult = {};
  var names = Object.keys(reg.slots);
  console.log('Backing up ' + names.length + ' slots...');
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var info = reg.slots[name];
    process.stdout.write('  ' + name + '... ');
    var content = await readSlot(info.id);
    var msgs = [];
    try { msgs = await readSlotMessages(info.id); } catch(e) {}
    slotsResult[name] = {
      name: name, id: info.id, desc: info.desc || '',
      created: info.created || '', content: content, messages: msgs
    };
    console.log('name=' + (content || '').length + 'c, msgs=' + msgs.length);
  }
  var snap = {
    meta: {
      version: 2, timestamp: new Date().toISOString(),
      slot_count: names.length, includesMessages: true, source: 'vfs-backup.js'
    },
    slots: slotsResult
  };
  var json = JSON.stringify(snap, null, 2);
  var file = outputFile || ('vfs-backup-' + new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19) + '.json');
  fs.writeFileSync(file, json);
  console.log('\nBackup saved: ' + file + ' (' + (json.length / 1024).toFixed(1) + ' KB)');
}

async function cmdRestore(inputFile) {
  if (!fs.existsSync(inputFile)) { console.error('File not found: ' + inputFile); process.exit(1); }
  var snap = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  var version = (snap.meta && snap.meta.version) || 1;
  var names = Object.keys(snap.slots);
  console.log('Restoring ' + names.length + ' slots (backup v' + version + ')...');
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var s = snap.slots[name];
    process.stdout.write('  ' + name + '... ');
    var nameLen = await writeSlot(s.id, s.content || '');
    var msgCount = 0;
    if (version >= 2 && s.messages && s.messages.length > 0) {
      try { msgCount = await writeSlotMessages(s.id, s.messages); } catch(e) { msgCount = -1; }
    }
    console.log('name=' + nameLen + 'c, msgs=' + msgCount);
  }
  console.log('\nRestore complete.');
}

async function cmdExport(conversationId) {
  console.log('Exporting conversation ' + conversationId + '...');
  var data = await readSlotFull(conversationId);
  var msgs = (data.session_state && data.session_state.messages) || [];
  var result = {
    id: data.id, name: data.name, type: data.type,
    ctime: data.ctime, mtime: data.mtime,
    messages: msgs.map(function(m) { return { id: m.id, role: m.role, content: m.content, ctime: m.ctime }; })
  };
  var json = JSON.stringify(result, null, 2);
  var file = 'conversation-' + conversationId.substring(0, 8) + '-' + new Date().toISOString().substring(0, 10) + '.json';
  fs.writeFileSync(file, json);
  console.log('Exported: ' + file + ' (' + msgs.length + ' messages, ' + (json.length / 1024).toFixed(1) + ' KB)');
}

async function main() {
  var args = process.argv.slice(2);
  var cmd = args[0];
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log('Usage:');
    console.log('  node vfs-backup.js ls                          List VFS slots');
    console.log('  node vfs-backup.js backup [--output FILE]      Backup all slots');
    console.log('  node vfs-backup.js restore <FILE>              Restore from backup');
    console.log('  node vfs-backup.js export <CONVERSATION_ID>    Export conversation');
    return;
  }
  try {
    switch(cmd) {
      case 'ls': await cmdLs(); break;
      case 'backup':
        var outIdx = args.indexOf('--output');
        await cmdBackup(outIdx >= 0 ? args[outIdx + 1] : null);
        break;
      case 'restore':
        if (!args[1]) { console.error('Usage: restore <FILE>'); process.exit(1); }
        await cmdRestore(args[1]);
        break;
      case 'export':
        if (!args[1]) { console.error('Usage: export <CONVERSATION_ID>'); process.exit(1); }
        await cmdExport(args[1]);
        break;
      default: console.error('Unknown command: ' + cmd); process.exit(1);
    }
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
