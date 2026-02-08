/**
 * 面板增强模块
 * 进度条、状态图、实时监控
 */

const PanelEnhancer = {
  // 进度条容器
  progressContainer: null,
  
  // 状态面板
  statusPanel: null,
  
  // 初始化
  init() {
    this.createProgressContainer();
    this.createStatusPanel();
    this.setupStyles();
  },

  // 创建进度条容器
  createProgressContainer() {
    if (document.getElementById('agent-progress-container')) return;
    
    const container = document.createElement('div');
    container.id = 'agent-progress-container';
    container.innerHTML = `
      <div class="progress-header">
        <span class="progress-title">任务进度</span>
        <span class="progress-stats"></span>
      </div>
      <div class="progress-bar-wrapper">
        <div class="progress-bar"></div>
      </div>
      <div class="progress-steps"></div>
    `;
    container.style.display = 'none';
    
    // 插入到面板中
    const panel = document.getElementById('agent-panel');
    if (panel) {
      const header = panel.querySelector('.agent-panel-header');
      if (header) {
        header.after(container);
      }
    }
    
    this.progressContainer = container;
  },

  // 创建状态面板
  createStatusPanel() {
    if (document.getElementById('agent-status-panel')) return;
    
    const panel = document.createElement('div');
    panel.id = 'agent-status-panel';
    panel.innerHTML = `
      <div class="status-grid">
        <div class="status-item">
          <div class="status-value" id="status-tools">0</div>
          <div class="status-label">工具</div>
        </div>
        <div class="status-item">
          <div class="status-value" id="status-calls">0</div>
          <div class="status-label">调用</div>
        </div>
        <div class="status-item">
          <div class="status-value" id="status-cache">0%</div>
          <div class="status-label">缓存</div>
        </div>
        <div class="status-item">
          <div class="status-value" id="status-uptime">0s</div>
          <div class="status-label">运行</div>
        </div>
      </div>
    `;
    
    const agentPanel = document.getElementById('agent-panel');
    if (agentPanel) {
      const content = agentPanel.querySelector('.agent-panel-content');
      if (content) {
        content.prepend(panel);
      }
    }
    
    this.statusPanel = panel;
  },

  // 设置样式
  setupStyles() {
    if (document.getElementById('panel-enhancer-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'panel-enhancer-styles';
    styles.textContent = `
      #agent-progress-container {
        padding: 8px 12px;
        background: rgba(0, 100, 255, 0.05);
        border-bottom: 1px solid rgba(0, 100, 255, 0.1);
      }
      
      .progress-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
        font-size: 12px;
      }
      
      .progress-title {
        font-weight: 600;
        color: #333;
      }
      
      .progress-stats {
        color: #666;
      }
      
      .progress-bar-wrapper {
        height: 6px;
        background: #e0e0e0;
        border-radius: 3px;
        overflow: hidden;
      }
      
      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #4CAF50, #8BC34A);
        border-radius: 3px;
        transition: width 0.3s ease;
        width: 0%;
      }
      
      .progress-bar.error {
        background: linear-gradient(90deg, #f44336, #ff5722);
      }
      
      .progress-steps {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 8px;
        max-height: 60px;
        overflow-y: auto;
      }
      
      .progress-step {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 3px;
        background: #f0f0f0;
        color: #666;
      }
      
      .progress-step.running {
        background: #fff3e0;
        color: #ff9800;
        animation: pulse 1s infinite;
      }
      
      .progress-step.success {
        background: #e8f5e9;
        color: #4caf50;
      }
      
      .progress-step.error {
        background: #ffebee;
        color: #f44336;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
      
      #agent-status-panel {
        padding: 8px 12px;
        border-bottom: 1px solid #eee;
      }
      
      .status-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        text-align: center;
      }
      
      .status-item {
        padding: 4px;
      }
      
      .status-value {
        font-size: 16px;
        font-weight: 600;
        color: #333;
      }
      
      .status-label {
        font-size: 10px;
        color: #999;
        margin-top: 2px;
      }
      
      .goal-progress-container {
        margin-top: 8px;
        padding: 8px;
        background: rgba(156, 39, 176, 0.05);
        border-radius: 4px;
      }
      
      .goal-title {
        font-size: 11px;
        font-weight: 600;
        color: #9c27b0;
        margin-bottom: 4px;
      }
      
      .goal-criteria {
        font-size: 10px;
        color: #666;
      }
      
      .goal-criteria-item {
        display: flex;
        align-items: center;
        gap: 4px;
        margin: 2px 0;
      }
      
      .goal-criteria-item.met {
        color: #4caf50;
      }
      
      .goal-criteria-item.unmet {
        color: #f44336;
      }
    `;
    
    document.head.appendChild(styles);
  },

  // 显示批量任务进度
  showBatchProgress(batchId, totalSteps) {
    if (!this.progressContainer) return;
    
    this.progressContainer.style.display = 'block';
    this.progressContainer.querySelector('.progress-title').textContent = `批量任务: ${batchId.slice(-8)}`;
    this.progressContainer.querySelector('.progress-stats').textContent = `0/${totalSteps}`;
    this.progressContainer.querySelector('.progress-bar').style.width = '0%';
    
    // 创建步骤指示器
    const stepsContainer = this.progressContainer.querySelector('.progress-steps');
    stepsContainer.innerHTML = '';
    
    for (let i = 0; i < totalSteps; i++) {
      const step = document.createElement('span');
      step.className = 'progress-step';
      step.textContent = `步骤${i + 1}`;
      step.dataset.stepIndex = i;
      stepsContainer.appendChild(step);
    }
  },

  // 更新步骤状态
  updateStepStatus(stepIndex, status, toolName) {
    if (!this.progressContainer) return;
    
    const step = this.progressContainer.querySelector(`[data-step-index="${stepIndex}"]`);
    if (step) {
      step.className = `progress-step ${status}`;
      step.textContent = toolName ? `${stepIndex + 1}:${toolName.slice(0, 8)}` : `步骤${stepIndex + 1}`;
    }
  },

  // 更新进度条
  updateProgress(completed, total, hasError = false) {
    if (!this.progressContainer) return;
    
    const percent = Math.round((completed / total) * 100);
    const bar = this.progressContainer.querySelector('.progress-bar');
    const stats = this.progressContainer.querySelector('.progress-stats');
    
    bar.style.width = `${percent}%`;
    bar.className = `progress-bar ${hasError ? 'error' : ''}`;
    stats.textContent = `${completed}/${total} (${percent}%)`;
  },

  // 隐藏进度
  hideProgress() {
    if (this.progressContainer) {
      this.progressContainer.style.display = 'none';
    }
  },

  // 显示目标进度
  showGoalProgress(goalId, description, criteria) {
    const container = document.createElement('div');
    container.className = 'goal-progress-container';
    container.id = `goal-${goalId}`;
    container.innerHTML = `
      <div class="goal-title">🎯 ${description || goalId}</div>
      <div class="goal-criteria">
        ${criteria?.map((c, i) => `
          <div class="goal-criteria-item" data-index="${i}">
            <span>○</span>
            <span>${c.type}: ${c.path || c.text || c.command || ''}</span>
          </div>
        `).join('') || ''}
      </div>
    `;
    
    if (this.progressContainer) {
      this.progressContainer.after(container);
    }
  },

  // 更新目标条件状态
  updateGoalCriteria(goalId, criteriaIndex, met) {
    const container = document.getElementById(`goal-${goalId}`);
    if (!container) return;
    
    const item = container.querySelector(`[data-index="${criteriaIndex}"]`);
    if (item) {
      item.className = `goal-criteria-item ${met ? 'met' : 'unmet'}`;
      item.querySelector('span').textContent = met ? '✓' : '✗';
    }
  },

  // 移除目标进度
  removeGoalProgress(goalId) {
    const container = document.getElementById(`goal-${goalId}`);
    if (container) {
      container.remove();
    }
  },

  // 更新状态面板
  updateStatusPanel(stats) {
    if (!this.statusPanel) return;
    
    if (stats.tools !== undefined) {
      document.getElementById('status-tools').textContent = stats.tools;
    }
    if (stats.calls !== undefined) {
      document.getElementById('status-calls').textContent = stats.calls;
    }
    if (stats.cacheHitRate !== undefined) {
      document.getElementById('status-cache').textContent = stats.cacheHitRate;
    }
    if (stats.uptime !== undefined) {
      document.getElementById('status-uptime').textContent = this.formatUptime(stats.uptime);
    }
  },

  // 格式化运行时间
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h${minutes % 60}m`;
  },

  // 显示 Toast 通知
  showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `agent-toast agent-toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-size: 13px;
      z-index: 10001;
      animation: slideIn 0.3s ease;
      background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196f3'};
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PanelEnhancer;
} else {
  window.PanelEnhancer = PanelEnhancer;
}
