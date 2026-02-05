const socket = io();
let currentSchedule = [];
let selectedSlots = new Set();
let currentBookingMode = 'waitlist';
let myBookingsData = { appointments: [], waitlists: [] };
let selectedBookings = new Set();

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initEventListeners();
  initSocketListeners();
  loadBookingMode();
});

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
    });
  });
}

function initEventListeners() {
  document.getElementById('fetchSchedule')?.addEventListener('click', fetchSchedule);
  document.getElementById('bookSelectedNow')?.addEventListener('click', bookSelectedNow);
  document.getElementById('addToTasks')?.addEventListener('click', addSelectedToTasks);
  document.getElementById('clearAllTasks')?.addEventListener('click', clearAllTasks);
  document.getElementById('saveSettings')?.addEventListener('click', saveSettings);
  document.getElementById('loginRD')?.addEventListener('click', loginRD);
  document.getElementById('logoutRD')?.addEventListener('click', logoutRD);
  document.getElementById('startPolling')?.addEventListener('click', startPolling);
  document.getElementById('stopPolling')?.addEventListener('click', stopPolling);
  document.getElementById('savePollingSettings')?.addEventListener('click', savePollingSettings);
  document.getElementById('clearLogs')?.addEventListener('click', clearLogs);
  
  // Mode buttons
  document.getElementById('modeBook')?.addEventListener('click', () => setBookingMode('book'));
  document.getElementById('modeWaitlist')?.addEventListener('click', () => setBookingMode('waitlist'));
  
  // Filters
  document.getElementById('filterAM')?.addEventListener('change', applyFilters);
  document.getElementById('filterPM')?.addEventListener('change', applyFilters);
  document.getElementById('filterExclude')?.addEventListener('input', applyFilters);
  document.getElementById('filterTimeStart')?.addEventListener('change', applyFilters);
  document.getElementById('filterTimeEnd')?.addEventListener('change', applyFilters);
  
  // My Bookings
  document.getElementById('refreshMyBookings')?.addEventListener('click', refreshMyBookings);
  document.getElementById('cancelSelectedBookings')?.addEventListener('click', cancelSelectedBookings);
  
  document.querySelectorAll('.delete-task').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const taskId = e.target.closest('.task-item').dataset.id;
      deleteTask(taskId);
    });
  });
}

function initSocketListeners() {
  socket.on('status', (data) => {
    updateRDStatus(data.isLoggedIn);
    updatePollingUI(data.polling);
    if (data.bookingMode) {
      updateBookingModeUI(data.bookingMode);
    }
  });
  
  socket.on('polling', (state) => {
    updatePollingUI(state);
  });
  
  socket.on('tasks', (tasks) => {
    updateTasksList(tasks);
  });
  
  socket.on('booking_success', (data) => {
    const msg = data.result?.fallbackToWaitlist 
      ? `📋 Added to waitlist: ${data.task.slot.resources}`
      : `🎯 Booked: ${data.task.slot.resources}`;
    showMessage(msg, 'success');
    playSound('success');
  });
  
  socket.on('booking_mode', (data) => {
    updateBookingModeUI(data.mode);
  });
  
  socket.on('log', (log) => {
    addLogEntry(log);
  });
}

// ========== Booking Mode ==========
async function loadBookingMode() {
  try {
    const res = await fetch('/api/booking-mode');
    const data = await res.json();
    currentBookingMode = data.mode;
    updateBookingModeUI(data.mode);
  } catch (e) {
    console.log('Failed to load booking mode');
  }
}

function updateBookingModeUI(mode) {
  currentBookingMode = mode;
  const bookBtn = document.getElementById('modeBook');
  const waitlistBtn = document.getElementById('modeWaitlist');
  
  if (bookBtn && waitlistBtn) {
    if (mode === 'book') {
      bookBtn.classList.add('active');
      waitlistBtn.classList.remove('active');
    } else {
      waitlistBtn.classList.add('active');
      bookBtn.classList.remove('active');
    }
  }
  
  const bookNowBtn = document.getElementById('bookSelectedNow');
  if (bookNowBtn) {
    bookNowBtn.textContent = mode === 'book' ? '🎯 Book Selected Now' : '📋 Waitlist Selected Now';
  }
}

async function setBookingMode(mode) {
  try {
    const res = await fetch('/api/booking-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    const data = await res.json();
    if (data.success) {
      updateBookingModeUI(mode);
      showMessage(`Mode: ${mode === 'book' ? '🎯 Book + Waitlist' : '📋 Waitlist Only'}`, 'success');
    }
  } catch (e) {
    showMessage('Failed to change mode', 'error');
  }
}

// ========== Schedule ==========
async function fetchSchedule() {
  const date = document.getElementById('scheduleDate').value;
  if (!date) { showMessage('Please select a date', 'error'); return; }
  
  const list = document.getElementById('scheduleList');
  list.innerHTML = '<div class="empty-state">Loading...</div>';
  
  try {
    const res = await fetch(`/api/schedule/${date}`);
    const data = await res.json();
    
    if (data.success) {
      currentSchedule = data.data || [];
      applyFilters();
      showMessage(`Found ${currentSchedule.length} slots`, 'success');
    } else {
      showMessage(data.error || 'Failed to fetch schedule', 'error');
      list.innerHTML = '<div class="empty-state">Failed to load schedule</div>';
    }
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
    list.innerHTML = '<div class="empty-state">Error loading schedule</div>';
  }
}

function applyFilters() {
  const showAM = document.getElementById('filterAM').checked;
  const showPM = document.getElementById('filterPM').checked;
  const timeStart = document.getElementById('filterTimeStart')?.value || '00:00';
  const timeEnd = document.getElementById('filterTimeEnd')?.value || '23:59';
  const excludeStr = document.getElementById('filterExclude').value.toLowerCase();
  const excludeKeywords = excludeStr.split(',').map(k => k.trim()).filter(k => k);
  
  const [startH, startM] = timeStart.split(':').map(Number);
  const [endH, endM] = timeEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  
  const filtered = currentSchedule.filter(slot => {
    const startTime = new Date(slot.start);
    const hour = startTime.getHours();
    const minutes = hour * 60 + startTime.getMinutes();
    
    if (!showAM && hour < 12) return false;
    if (!showPM && hour >= 12) return false;
    if (minutes < startMinutes || minutes > endMinutes) return false;
    
    const title = (slot.title || '').toLowerCase();
    for (const kw of excludeKeywords) {
      if (title.includes(kw)) return false;
    }
    return true;
  });
  
  filtered.sort((a, b) => new Date(a.start) - new Date(b.start));
  renderScheduleList(filtered);
}

function renderScheduleList(slots) {
  const list = document.getElementById('scheduleList');
  const countEl = document.getElementById('slotCount');
  const actionsEl = document.getElementById('scheduleActions');
  
  countEl.textContent = slots.length;
  selectedSlots.clear();
  
  if (slots.length === 0) {
    list.innerHTML = '<div class="empty-state">No slots match filters</div>';
    actionsEl.style.display = 'none';
    return;
  }
  
  actionsEl.style.display = 'flex';
  list.innerHTML = slots.map(slot => {
    const startTime = new Date(slot.start);
    const endTime = new Date(slot.end);
    const timeStr = startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const endTimeStr = endTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    
    const durationMs = endTime - startTime;
    const durationMins = Math.round(durationMs / 60000);
    const durationStr = formatDuration(durationMins);
    
    const color = slot.color || '#ccc';
    
    const slotJson = JSON.stringify(slot).replace(/'/g, "\\'");
    return `
      <div class="slot-item" style="border-left-color: ${color};">
        <input type="checkbox" class="slot-checkbox" data-slot='${slotJson}'>
        <div class="slot-info">
          <div class="slot-time">
            ${timeStr} - ${endTimeStr}
            <span class="slot-duration">${durationStr}</span>
          </div>
          <div class="slot-title">${slot.resources || 'Court'} - ${slot.title || 'Available'}</div>
        </div>
        <select class="slot-mode-select" data-slot='${slotJson}'>
          <option value="book">🎯 Book</option>
          <option value="waitlist" selected>📋 Waitlist</option>
        </select>
        <button class="btn btn-small btn-success book-single" data-slot='${slotJson}'>⚡</button>
      </div>
    `;
  }).join('');
  
  list.querySelectorAll('.slot-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const slot = JSON.parse(e.target.dataset.slot);
      if (e.target.checked) selectedSlots.add(JSON.stringify(slot));
      else selectedSlots.delete(JSON.stringify(slot));
    });
  });
  
  list.querySelectorAll('.book-single').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const slot = JSON.parse(e.target.dataset.slot);
      const modeSelect = e.target.parentElement.querySelector('.slot-mode-select');
      const mode = modeSelect ? modeSelect.value : currentBookingMode;
      bookSingleSlot(slot, mode);
    });
  });
}

function formatDuration(mins) {
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (remainMins === 0) return `${hours}h`;
  return `${hours}h${remainMins}m`;
}

async function bookSingleSlot(slot, mode = null) {
  const bookingMode = mode || currentBookingMode;
  const modeText = bookingMode === 'book' ? '🎯 Booking' : '📋 Adding to waitlist';
  showMessage(`${modeText}...`, 'info');
  
  try {
    const res = await fetch('/api/book-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, mode: bookingMode })
    });
    const data = await res.json();
    
    let msg = data.message || (data.success ? 'Success!' : 'Failed');
    if (data.fallbackToWaitlist) {
      msg = '📋 Added to waitlist (slot was full)';
    } else if (data.success && bookingMode === 'book' && !data.alreadyOnWaitlist) {
      msg = '🎯 ' + msg;
    }
    
    showMessage(msg, data.success ? 'success' : 'error');
    if (data.success) playSound('success');
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
  }
}

async function bookSelectedNow() {
  if (selectedSlots.size === 0) { showMessage('Please select slots', 'error'); return; }
  
  const list = document.getElementById('scheduleList');
  const slots = Array.from(selectedSlots).map(s => JSON.parse(s));
  showMessage(`Processing ${slots.length} slots...`, 'info');
  
  for (const slot of slots) {
    const slotJson = JSON.stringify(slot);
    const checkbox = list.querySelector(`.slot-checkbox[data-slot='${slotJson.replace(/'/g, "\\'")}']`);
    const slotItem = checkbox?.closest('.slot-item');
    const modeSelect = slotItem?.querySelector('.slot-mode-select');
    const mode = modeSelect ? modeSelect.value : currentBookingMode;
    
    await bookSingleSlot(slot, mode);
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function addSelectedToTasks() {
  if (selectedSlots.size === 0) { 
    showMessage('Please select slots', 'error'); 
    return; 
  }
  
  const date = document.getElementById('scheduleDate').value;
  const list = document.getElementById('scheduleList');
  let added = 0;
  
  for (const slotJson of selectedSlots) {
    const slot = JSON.parse(slotJson);
    
    const checkbox = list.querySelector(`.slot-checkbox[data-slot='${slotJson.replace(/'/g, "\\'")}']`);
    const slotItem = checkbox?.closest('.slot-item');
    const modeSelect = slotItem?.querySelector('.slot-mode-select');
    const mode = modeSelect ? modeSelect.value : currentBookingMode;
    
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot, scheduleDate: date, mode })
      });
      const data = await res.json();
      if (data.success) added++;
    } catch (e) {
      console.error('Add task error:', e);
    }
  }
  
  showMessage(`Added ${added} tasks`, 'success');
  selectedSlots.clear();
}

async function deleteTask(taskId) {
  try {
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    document.querySelector(`.task-item[data-id="${taskId}"]`)?.remove();
    updateTaskBadge();
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
  }
}

async function clearAllTasks() {
  if (!confirm('Clear all tasks?')) return;
  try {
    await fetch('/api/tasks', { method: 'DELETE' });
    document.getElementById('tasksList').innerHTML = '<div class="empty-state">No tasks scheduled</div>';
    updateTaskBadge();
    showMessage('All tasks cleared', 'info');
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
  }
}

function updateTasksList(tasks) {
  const list = document.getElementById('tasksList');
  if (tasks.length === 0) {
    list.innerHTML = '<div class="empty-state">No tasks scheduled</div>';
  } else {
    list.innerHTML = tasks.map(task => {
      const modeClass = task.mode === 'book' ? 'book' : 'waitlist';
      const modeText = task.mode === 'book' ? '🎯 Book' : '📋 Waitlist';
      return `
        <div class="task-item" data-id="${task.id}">
          <div class="task-info">
            <strong>${task.scheduleDate}</strong>
            <span>
              ${task.slot.resources} - ${new Date(task.slot.start).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})}
              <span class="task-mode-badge ${modeClass}">${modeText}</span>
            </span>
          </div>
          <button class="btn btn-small btn-danger delete-task">✕</button>
        </div>
      `;
    }).join('');
    
    list.querySelectorAll('.delete-task').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const taskId = e.target.closest('.task-item').dataset.id;
        deleteTask(taskId);
      });
    });
  }
  updateTaskBadge();
}

function updateTaskBadge() {
  const count = document.querySelectorAll('.task-item[data-id]').length;
  document.getElementById('tasksBadge').textContent = count;
}

// ========== Settings ==========
async function saveSettings() {
  const loginCheckTimesRaw = document.getElementById('loginCheckTimes')?.value || '09:00, 12:00, 18:00, 21:00';
  const login_check_times = loginCheckTimesRaw.split(',').map(t => t.trim()).filter(t => /^\d{2}:\d{2}$/.test(t));
  
  const data = {
    rd_username: document.getElementById('rdUsername').value,
    rd_password: document.getElementById('rdPassword').value,
    rd_user_id: document.getElementById('rdUserId').value,
    captcha_api_key: document.getElementById('captchaApiKey').value,
    login_check_times: login_check_times
  };
  
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    showMessage(result.success ? 'Settings saved!' : 'Save failed', result.success ? 'success' : 'error');
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
  }
}

async function loginRD() {
  showMessage('Connecting to RacquetDesk...', 'info');
  try {
    const res = await fetch('/api/login-rd', { method: 'POST' });
    const data = await res.json();
    showMessage(data.success ? 'Connected!' : (data.error || 'Login failed'), data.success ? 'success' : 'error');
    updateRDStatus(data.success);
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
  }
}

async function logoutRD() {
  try {
    await fetch('/api/logout-rd', { method: 'POST' });
    showMessage('Disconnected', 'info');
    updateRDStatus(false);
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
  }
}

function updateRDStatus(isLoggedIn) {
  const el = document.getElementById('rdStatus');
  el.className = 'status-badge ' + (isLoggedIn ? 'online' : 'offline');
  el.textContent = isLoggedIn ? '✓ Connected' : '✗ Disconnected';
}

// ========== Polling ==========
async function startPolling() {
  showMessage('Starting polling...', 'info');
  try {
    const res = await fetch('/api/polling/start', { method: 'POST' });
    const data = await res.json();
    if (data.success) showMessage('Polling started!', 'success');
    else showMessage(data.error || 'Failed to start polling', 'error');
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
  }
}

async function stopPolling() {
  try {
    const res = await fetch('/api/polling/stop', { method: 'POST' });
    const data = await res.json();
    if (data.success) showMessage('Polling stopped', 'info');
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
  }
}

function updatePollingUI(state) {
  if (!state) return;
  
  const statusEl = document.querySelector('.polling-status');
  const textEl = document.getElementById('pollingStatusText');
  const attemptsEl = document.getElementById('pollAttempts');
  const successesEl = document.getElementById('pollSuccesses');
  const lastCheckEl = document.getElementById('pollLastCheck');
  const startBtn = document.getElementById('startPolling');
  const stopBtn = document.getElementById('stopPolling');
  
  if (state.active) {
    statusEl?.classList.add('active');
    document.querySelector('.pulse')?.classList.add('active');
  } else {
    statusEl?.classList.remove('active');
    document.querySelector('.pulse')?.classList.remove('active');
  }
  
  if (textEl) textEl.textContent = state.active ? 'Polling Active' : 'Polling Inactive';
  if (attemptsEl) attemptsEl.textContent = state.attempts || 0;
  if (successesEl) successesEl.textContent = state.successCount || 0;
  if (lastCheckEl) lastCheckEl.textContent = state.lastAttempt ? new Date(state.lastAttempt).toLocaleTimeString() : 'Never';
  if (startBtn) startBtn.disabled = state.active;
  if (stopBtn) stopBtn.disabled = !state.active;
}

async function savePollingSettings() {
  const data = {
    intervalSeconds: parseInt(document.getElementById('pollingInterval').value),
    startTime: document.getElementById('pollingStartTime').value,
    endTime: document.getElementById('pollingEndTime').value,
    maxAttempts: parseInt(document.getElementById('pollingMaxAttempts').value),
    stopOnSuccess: document.getElementById('pollingStopOnSuccess').checked
  };
  
  try {
    const res = await fetch('/api/polling/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    showMessage(result.success ? 'Polling settings saved!' : 'Save failed', result.success ? 'success' : 'error');
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
  }
}

// ========== Logs ==========
async function clearLogs() {
  try {
    await fetch('/api/logs', { method: 'DELETE' });
    document.getElementById('logsList').innerHTML = '';
    showMessage('Logs cleared', 'info');
  } catch (e) {
    showMessage('Error: ' + e.message, 'error');
  }
}

function addLogEntry(log) {
  const list = document.getElementById('logsList');
  const entry = document.createElement('div');
  entry.className = 'log-item ' + log.level.toLowerCase();
  entry.innerHTML = `
    <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
    <span class="log-level">${log.level}</span>
    <span class="log-message">${log.message}</span>
  `;
  list.insertBefore(entry, list.firstChild);
  
  while (list.children.length > 100) {
    list.removeChild(list.lastChild);
  }
}

// ========== My Bookings ==========
async function refreshMyBookings() {
  const content = document.getElementById('myBookingsContent');
  content.innerHTML = '<div class="empty-state">Loading...</div>';
  selectedBookings.clear();
  updateCancelButton();
  
  try {
    const res = await fetch('/api/my-bookings-data');
    const data = await res.json();
    
    if (!data.success) {
      content.innerHTML = `<div class="empty-state">Error: ${data.error}</div>`;
      return;
    }
    
    myBookingsData = data;
    renderMyBookings(data);
    showMessage(`Found ${data.appointments.length} appointments, ${data.waitlists.length} waitlists`, 'success');
  } catch (e) {
    content.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`;
    showMessage('Error loading bookings', 'error');
  }
}

function renderMyBookings(data) {
  const content = document.getElementById('myBookingsContent');
  
  if (data.appointments.length === 0 && data.waitlists.length === 0) {
    content.innerHTML = '<div class="empty-state">No bookings or waitlists found</div>';
    return;
  }
  
  let html = '';
  
  if (data.appointments.length > 0) {
    html += `
      <div class="booking-section">
        <h3 class="appointments">✅ Confirmed Appointments (${data.appointments.length})</h3>
        ${data.appointments.map(appt => `
          <div class="booking-item" data-type="appointment" data-id="${appt.id}" data-oid="${appt.oderId}" data-otid="${appt.otId}">
            <input type="checkbox" class="booking-checkbox">
            <div class="booking-info">
              <div class="booking-name">${appt.name}</div>
              <div class="booking-datetime">📅 ${appt.date} at ${appt.time}</div>
            </div>
            <button class="btn btn-small btn-danger cancel-single" data-type="appointment" data-id="${appt.id}" data-oid="${appt.oderId}" data-otid="${appt.otId}">Cancel</button>
          </div>
        `).join('')
        }
      </div>
    `;
  }
  
  if (data.waitlists.length > 0) {
    html += `
      <div class="booking-section">
        <h3 class="waitlists">⏳ Waitlists (${data.waitlists.length})</h3>
        ${data.waitlists.map(wl => `
          <div class="booking-item waitlist" data-type="waitlist" data-id="${wl.id}" data-fxobjectid="${wl.fxObjectID}">
            <input type="checkbox" class="booking-checkbox">
            <div class="booking-info">
              <div class="booking-name">${wl.name}</div>
              <div class="booking-datetime">📅 ${wl.date} at ${wl.time}</div>
              ${wl.position ? `<div class="booking-position">#${wl.position} on waitlist</div>` : ''}
            </div>
            <button class="btn btn-small btn-danger cancel-single" data-type="waitlist" data-id="${wl.id}" data-fxobjectid="${wl.fxObjectID}">Cancel</button>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  content.innerHTML = html;
  
  // 绑定 checkbox 事件
  content.querySelectorAll('.booking-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const item = e.target.closest('.booking-item');
      const key = `${item.dataset.type}_${item.dataset.id}`;
      if (e.target.checked) {
        selectedBookings.add(key);
      } else {
        selectedBookings.delete(key);
      }
      updateCancelButton();
    });
  });
  
  // 绑定单个取消按钮事件
  content.querySelectorAll('.cancel-single').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const type = e.target.dataset.type;
      const id = e.target.dataset.id;
      
      if (!confirm(`Cancel this ${type}?`)) return;
      
      e.target.disabled = true;
      e.target.textContent = '...';
      
      try {
        let res;
        if (type === 'appointment') {
          res = await fetch('/api/cancel-appointment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apptId: id,
              oId: e.target.dataset.oid,
              otId: e.target.dataset.otid
            })
          });
        } else {
          res = await fetch('/api/cancel-waitlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              aId: id,
              fxObjectID: e.target.dataset.fxobjectid
            })
          });
        }
        
        const data = await res.json();
        if (data.success) {
          showMessage(`Cancelled ${type}!`, 'success');
          e.target.closest('.booking-item').remove();
          
          // 检查是否还有剩余项目
          const section = content.querySelector(`.booking-section h3.${type === 'appointment' ? 'appointments' : 'waitlists'}`)?.closest('.booking-section');
          if (section && section.querySelectorAll('.booking-item').length === 0) {
            section.remove();
          }
          
          if (content.querySelectorAll('.booking-item').length === 0) {
            content.innerHTML = '<div class="empty-state">No bookings or waitlists found</div>';
          }
        } else {
          showMessage(`Failed: ${data.error}`, 'error');
          e.target.disabled = false;
          e.target.textContent = 'Cancel';
        }
      } catch (err) {
        showMessage(`Error: ${err.message}`, 'error');
        e.target.disabled = false;
        e.target.textContent = 'Cancel';
      }
    });
  });
}

function updateCancelButton() {
  const btn = document.getElementById('cancelSelectedBookings');
  if (btn) {
    btn.disabled = selectedBookings.size === 0;
    btn.textContent = selectedBookings.size > 0 
      ? `🗑️ Cancel Selected (${selectedBookings.size})` 
      : '🗑️ Cancel Selected';
  }
}

async function cancelSelectedBookings() {
  if (selectedBookings.size === 0) return;
  
  if (!confirm(`Cancel ${selectedBookings.size} selected items?`)) return;
  
  const items = [];
  const content = document.getElementById('myBookingsContent');
  
  selectedBookings.forEach(key => {
    const [type, id] = key.split('_');
    const el = content.querySelector(`.booking-item[data-type="${type}"][data-id="${id}"]`);
    if (el) {
      if (type === 'appointment') {
        items.push({
          type,
          id,
          oId: el.dataset.oid,
          otId: el.dataset.otid
        });
      } else {
        items.push({
          type,
          id,
          fxObjectID: el.dataset.fxobjectid
        });
      }
    }
  });
  
  if (items.length === 0) return;
  
  const btn = document.getElementById('cancelSelectedBookings');
  btn.disabled = true;
  btn.textContent = 'Cancelling...';
  
  try {
    const res = await fetch('/api/cancel-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    
    const data = await res.json();
    
    if (data.success) {
      showMessage(`Cancelled ${data.successCount}/${items.length} items`, 'success');
      await refreshMyBookings();
    } else {
      showMessage(`Error: ${data.error}`, 'error');
    }
  } catch (e) {
    showMessage(`Error: ${e.message}`, 'error');
  }
  
  btn.disabled = false;
  updateCancelButton();
}

// ========== Utilities ==========
function showMessage(text, type = 'info') {
  const area = document.getElementById('messageArea');
  const msg = document.createElement('div');
  msg.className = 'message ' + type;
  msg.textContent = text;
  area.appendChild(msg);
  setTimeout(() => msg.remove(), 5000);
}

function playSound(type) {
  try {
    const audio = new Audio(`/sounds/${type}.mp3`);
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch (e) {}
}

// ========== Connection Check ==========
setInterval(async () => {
  try {
    const res = await fetch('/api/connection-check');
    const data = await res.json();
    
    if (data.connected) {
      updateRDStatus(true);
    } else {
      updateRDStatus(false);
      console.log('⚠️ Connection lost:', data.reason);
    }
  } catch (e) {
    console.log('Connection check failed:', e.message);
  }
}, 30000);

// Initial check
setTimeout(async () => {
  try {
    const res = await fetch('/api/connection-check');
    const data = await res.json();
    updateRDStatus(data.connected);
  } catch (e) {}
}, 2000);
