import { spawn } from 'child_process';

/**
 * ProcessManager - 后台进程管理器
 * 最多 5 个进程槽，不占用消息通道
 * 
 * 工具:
 *   bg_run    - 后台启动命令，立即返回 slotId + PID
 *   bg_status - 查看所有槽的状态/输出 (支持 lastN 控制输出行数)
 *   bg_kill   - 终止指定槽的进程
 */

const MAX_SLOTS = 5;
const MAX_OUTPUT_LINES = 200;

class ProcessManager {
  constructor() {
    this.slots = new Map(); // slotId -> { pid, command, status, output, startTime, endTime, exitCode }
    this.nextId = 1;
  }

  run(command, options = {}, onComplete = null) {
    // 找空槽或分配新槽
    if (this.slots.size >= MAX_SLOTS) {
      // 尝试清理已完成的槽
      for (const [id, slot] of this.slots) {
        if (slot.status === 'exited' || slot.status === 'killed') {
          this.slots.delete(id);
          break;
        }
      }
      if (this.slots.size >= MAX_SLOTS) {
        return { success: false, error: `所有 ${MAX_SLOTS} 个进程槽已满，请先用 bg_kill 终止或等待完成` };
      }
    }

    const slotId = this.nextId++;
    const shell = options.shell || '/bin/bash';
    const cwd = options.cwd || process.cwd();

    try {
      const child = spawn(shell, ['-c', command], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: { ...process.env }
      });

      const slot = {
        pid: child.pid,
        command: command.length > 200 ? command.substring(0, 200) + '...' : command,
        status: 'running',
        output: [],
        startTime: Date.now(),
        endTime: null,
        exitCode: null,
        _process: child
      };

      child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l);
        for (const line of lines) {
          slot.output.push({ time: Date.now(), type: 'stdout', text: line });
          if (slot.output.length > MAX_OUTPUT_LINES) slot.output.shift();
        }
      });

      child.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l);
        for (const line of lines) {
          slot.output.push({ time: Date.now(), type: 'stderr', text: line });
          if (slot.output.length > MAX_OUTPUT_LINES) slot.output.shift();
        }
      });

      child.on('close', (code) => {
        slot.status = 'exited';
        slot.exitCode = code;
        slot.endTime = Date.now();
        console.log(`[ProcessManager] Slot #${slotId} (PID ${slot.pid}) exited with code ${code}`);
        if (onComplete) {
          const formatted = this._formatSlot(slotId, slot, );
          onComplete(formatted);
        }
      });

      child.on('error', (err) => {
        slot.status = 'error';
        slot.endTime = Date.now();
        slot.output.push({ time: Date.now(), type: 'stderr', text: `Error: ${err.message}` });
        console.error(`[ProcessManager] Slot #${slotId} error: ${err.message}`);
      });

      this.slots.set(slotId, slot);
      console.log(`[ProcessManager] Slot #${slotId} started: PID ${child.pid}, cmd: ${slot.command}`);

      return {
        success: true,
        slotId,
        pid: child.pid,
        message: `进程已后台启动 (Slot #${slotId}, PID ${child.pid})`
      };
    } catch (e) {
      return { success: false, error: `启动失败: ${e.message}` };
    }
  }

  status(slotId, options = {}) {
    const lastN = parseInt(options.lastN) || 10;

    if (slotId) {
      const slot = this.slots.get(parseInt(slotId));
      if (!slot) return { success: false, error: `Slot #${slotId} 不存在` };
      return { success: true, slot: this._formatSlot(parseInt(slotId), slot, lastN) };
    }

    // 返回所有槽
    const slots = [];
    for (const [id, slot] of this.slots) {
      slots.push(this._formatSlot(id, slot, lastN));
    }
    return { success: true, slots, total: slots.length, maxSlots: MAX_SLOTS };
  }

  kill(slotId) {
    const id = parseInt(slotId);
    const slot = this.slots.get(id);
    if (!slot) return { success: false, error: `Slot #${slotId} 不存在` };
    if (slot.status !== 'running') {
      this.slots.delete(id);
      return { success: true, message: `Slot #${slotId} 已不在运行 (${slot.status})，已清理` };
    }

    try {
      slot._process.kill('SIGTERM');
      // 3 秒后强杀
      setTimeout(() => {
        if (slot.status === 'running') {
          try { slot._process.kill('SIGKILL'); } catch {}
        }
      }, 3000);
      slot.status = 'killed';
      slot.endTime = Date.now();
      return { success: true, message: `Slot #${slotId} (PID ${slot.pid}) 已终止` };
    } catch (e) {
      return { success: false, error: `终止失败: ${e.message}` };
    }
  }

  _formatSlot(id, slot, lastN = 10) {
    const elapsed = slot.endTime
      ? ((slot.endTime - slot.startTime) / 1000).toFixed(1) + 's'
      : ((Date.now() - slot.startTime) / 1000).toFixed(1) + 's';

    const outputLines = slot.output.slice(-lastN).map(o => o.text);
    const lastOutput = outputLines.length > 0 ? outputLines.join('\n') : '(无输出)';
    const totalLines = slot.output.length;

    return {
      slotId: id,
      pid: slot.pid,
      command: slot.command,
      status: slot.status,
      exitCode: slot.exitCode,
      elapsed,
      totalLines,
      lastOutput
    };
  }
}

export default ProcessManager;
