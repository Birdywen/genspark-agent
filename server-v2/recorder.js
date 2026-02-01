// Recorder - 执行录制模块

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

class Recorder {
  constructor(logger, storagePath = './recordings') {
    this.logger = logger;
    this.storagePath = storagePath;
    this.activeRecordings = new Map(); // recordingId -> recording data
    
    // 确保存储目录存在
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true });
    }
  }

  // 开始新录制
  startRecording(recordingId, name = '') {
    if (this.activeRecordings.has(recordingId)) {
      return { success: false, error: '录制已存在' };
    }
    
    const recording = {
      id: recordingId,
      name: name || `Recording ${recordingId}`,
      createdAt: new Date().toISOString(),
      status: 'recording',
      steps: [],
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
    
    const stepData = {
      index: recording.steps.length,
      tool: step.tool,
      params: step.params,
      result: step.result ? {
        success: step.result.success,
        // 只保存结果摘要，避免录制文件过大
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
    
    // 保存到文件
    const filePath = this.saveRecording(recording);
    
    // 从活跃录制中移除
    this.activeRecordings.delete(recordingId);
    
    this.logger.success(`[Recorder] 录制完成: ${recordingId}, ${recording.steps.length} 步`);
    
    return { 
      success: true, 
      recordingId,
      filePath,
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

  // 转换录制为 tool_batch 格式
  toToolBatch(recording) {
    return {
      id: `replay-${recording.id}-${Date.now()}`,
      steps: recording.steps.map(step => ({
        tool: step.tool,
        params: step.params
      })),
      options: {
        stopOnError: true
      },
      source: {
        type: 'recording',
        recordingId: recording.id,
        recordingName: recording.name
      }
    };
  }

  // 列出所有录制
  listRecordings() {
    const files = [];
    
    try {
      const entries = require('fs').readdirSync(this.storagePath);
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          const filePath = path.join(this.storagePath, entry);
          try {
            const data = JSON.parse(readFileSync(filePath, 'utf-8'));
            files.push({
              id: data.id,
              name: data.name,
              createdAt: data.createdAt,
              totalSteps: data.metadata?.totalSteps || data.steps?.length || 0,
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
      require('fs').unlinkSync(filePath);
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
}

export default Recorder;
