// Recorder - 执行录制模块 (增强版: 支持参数化和循环)

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';

class Recorder {
  constructor(logger, storagePath = './recordings') {
    this.logger = logger;
    this.storagePath = storagePath;
    this.activeRecordings = new Map();
    
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true });
    }
  }

  // 开始新录制
  startRecording(recordingId, name = '', description = '') {
    if (this.activeRecordings.has(recordingId)) {
      return { success: false, error: '录制已存在' };
    }
    
    const recording = {
      id: recordingId,
      name: name || `Recording ${recordingId}`,
      description: description,
      createdAt: new Date().toISOString(),
      status: 'recording',
      steps: [],
      // 参数定义 (回放时可覆盖)
      parameters: {},
      metadata: {
        startTime: Date.now()
      }
    };
    
    this.activeRecordings.set(recordingId, recording);
    this.logger.info(`[Recorder] 开始录制: ${recordingId}`);
    
    return { success: true, recordingId };
  }

  // 记录一个步骤
  recordStep(recordingId, step) {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) {
      return { success: false, error: '录制不存在' };
    }
    
    if (recording.status !== 'recording') {
      return { success: false, error: '录制已停止' };
    }
    
    // 检测参数中的变量并记录
    const detectedVars = this._detectVariables(step.params);
    if (detectedVars.length > 0) {
      detectedVars.forEach(v => {
        if (!recording.parameters[v]) {
          recording.parameters[v] = { detected: true, defaultValue: null };
        }
      });
    }
    
    const stepData = {
      index: recording.steps.length,
      tool: step.tool,
      params: step.params,
      result: step.result ? {
        success: step.result.success,
        preview: typeof step.result.result === 'string' 
          ? step.result.result.substring(0, 500) 
          : JSON.stringify(step.result.result).substring(0, 500),
        errorType: step.result.errorType
      } : null,
      timestamp: new Date().toISOString(),
      duration: step.duration || 0
    };
    
    recording.steps.push(stepData);
    this.logger.info(`[Recorder] 记录步骤 ${stepData.index}: ${step.tool}`);
    
    return { success: true, stepIndex: stepData.index };
  }

  // 检测参数中的变量 {{varName}}
  _detectVariables(obj, vars = []) {
    if (typeof obj === 'string') {
      const matches = obj.match(/\{\{(\w+)\}\}/g);
      if (matches) {
        matches.forEach(m => {
          const varName = m.replace(/\{\{|\}\}/g, '');
          if (!vars.includes(varName)) vars.push(varName);
        });
      }
    } else if (Array.isArray(obj)) {
      obj.forEach(item => this._detectVariables(item, vars));
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(val => this._detectVariables(val, vars));
    }
    return vars;
  }

  // 停止录制
  stopRecording(recordingId) {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) {
      return { success: false, error: '录制不存在' };
    }
    
    recording.status = 'completed';
    recording.completedAt = new Date().toISOString();
    recording.metadata.endTime = Date.now();
    recording.metadata.totalDuration = recording.metadata.endTime - recording.metadata.startTime;
    recording.metadata.totalSteps = recording.steps.length;
    recording.metadata.successSteps = recording.steps.filter(s => s.result?.success).length;
    
    const filePath = this.saveRecording(recording);
    this.activeRecordings.delete(recordingId);
    
    this.logger.success(`[Recorder] 录制完成: ${recordingId}, ${recording.steps.length} 步`);
    
    return { 
      success: true, 
      recordingId,
      filePath,
      parameters: Object.keys(recording.parameters),
      summary: {
        totalSteps: recording.metadata.totalSteps,
        successSteps: recording.metadata.successSteps,
        duration: recording.metadata.totalDuration
      }
    };
  }

  // 保存录制到文件
  saveRecording(recording) {
    const fileName = `${recording.id}.json`;
    const filePath = path.join(this.storagePath, fileName);
    writeFileSync(filePath, JSON.stringify(recording, null, 2));
    this.logger.info(`[Recorder] 录制已保存: ${filePath}`);
    return filePath;
  }

  // 加载录制
  loadRecording(recordingId) {
    const filePath = path.join(this.storagePath, `${recordingId}.json`);
    
    if (!existsSync(filePath)) {
      return { success: false, error: '录制文件不存在' };
    }
    
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      return { success: true, recording: data };
    } catch (e) {
      return { success: false, error: `加载失败: ${e.message}` };
    }
  }

  // 替换参数变量
  _replaceVariables(obj, variables) {
    if (typeof obj === 'string') {
      let result = obj;
      for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
      return result;
    } else if (Array.isArray(obj)) {
      return obj.map(item => this._replaceVariables(item, variables));
    } else if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this._replaceVariables(value, variables);
      }
      return result;
    }
    return obj;
  }

  // 转换录制为 tool_batch 格式 (支持参数化和循环)
  toToolBatch(recording, options = {}) {
    const { variables = {}, foreach = null, foreachVar = 'item' } = options;
    
    let steps = recording.steps.map(step => ({
      tool: step.tool,
      params: this._replaceVariables(step.params, variables)
    }));
    
    // 如果有 foreach，展开循环
    if (foreach && Array.isArray(foreach)) {
      const expandedSteps = [];
      foreach.forEach((item, idx) => {
        const loopVars = { ...variables, [foreachVar]: item, __index__: idx };
        recording.steps.forEach(step => {
          expandedSteps.push({
            tool: step.tool,
            params: this._replaceVariables(step.params, loopVars)
          });
        });
      });
      steps = expandedSteps;
    }
    
    return {
      id: `replay-${recording.id}-${Date.now()}`,
      steps: steps,
      options: {
        stopOnError: options.stopOnError !== false
      },
      source: {
        type: 'recording',
        recordingId: recording.id,
        recordingName: recording.name,
        variables: variables,
        foreach: foreach
      }
    };
  }

  // 列出所有录制
  listRecordings() {
    const files = [];
    
    try {
      const entries = readdirSync(this.storagePath);
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          const filePath = path.join(this.storagePath, entry);
          try {
            const data = JSON.parse(readFileSync(filePath, 'utf-8'));
            files.push({
              id: data.id,
              name: data.name,
              description: data.description,
              createdAt: data.createdAt,
              totalSteps: data.metadata?.totalSteps || data.steps?.length || 0,
              parameters: Object.keys(data.parameters || {}),
              status: data.status
            });
          } catch (e) {
            // 跳过无效文件
          }
        }
      }
    } catch (e) {
      this.logger.error(`[Recorder] 列出录制失败: ${e.message}`);
    }
    
    return files;
  }

  // 删除录制
  deleteRecording(recordingId) {
    const filePath = path.join(this.storagePath, `${recordingId}.json`);
    
    if (!existsSync(filePath)) {
      return { success: false, error: '录制不存在' };
    }
    
    try {
      unlinkSync(filePath);
      this.logger.info(`[Recorder] 已删除录制: ${recordingId}`);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // 获取活跃录制状态
  getActiveRecording(recordingId) {
    return this.activeRecordings.get(recordingId) || null;
  }

  // 检查是否正在录制
  isRecording(recordingId) {
    const recording = this.activeRecordings.get(recordingId);
    return recording && recording.status === 'recording';
  }
  
  // 获取录制的参数列表
  getParameters(recordingId) {
    const result = this.loadRecording(recordingId);
    if (!result.success) return result;
    return { 
      success: true, 
      parameters: result.recording.parameters || {},
      description: result.recording.description
    };
  }
}

export default Recorder;
