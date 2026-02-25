// Health Checker - 健康检查模块
// 检测 MCP 服务器连接状态、Playwright 浏览器安装等

import { existsSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';

class HealthChecker {
  constructor(logger) {
    this.logger = logger;
    this.lastCheck = null;
    this.status = {};
  }

  // 检测 Playwright 浏览器是否安装
  checkPlaywright() {
    const possiblePaths = [
      process.env.PLAYWRIGHT_BROWSERS_PATH,
      path.join(os.homedir(), 'Library/Caches/ms-playwright'),  // macOS
      path.join(os.homedir(), '.cache/ms-playwright'),          // Linux
      path.join(os.homedir(), 'AppData/Local/ms-playwright')    // Windows
    ].filter(Boolean);

    let cacheDir = null;
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        cacheDir = p;
        break;
      }
    }

    if (!cacheDir) {
      return {
        name: 'playwright',
        healthy: false,
        issue: 'BROWSER_CACHE_NOT_FOUND',
        message: 'Playwright 浏览器缓存目录不存在',
        fix: 'npx playwright install chromium',
        autoFix: false
      };
    }

    // 检查是否有 chromium 目录
    try {
      const entries = readdirSync(cacheDir);
      const hasChromium = entries.some(e => e.startsWith('chromium'));
      
      if (!hasChromium) {
        return {
          name: 'playwright',
          healthy: false,
          issue: 'CHROMIUM_NOT_INSTALLED',
          message: 'Chromium 浏览器未安装',
          fix: 'npx playwright install chromium',
          autoFix: false
        };
      }

      return {
        name: 'playwright',
        healthy: true,
        message: 'Chromium 已安装',
        cacheDir
      };
    } catch (e) {
      return {
        name: 'playwright',
        healthy: false,
        issue: 'CHECK_ERROR',
        message: '检查失败: ' + e.message,
        fix: 'npx playwright install chromium',
        autoFix: false
      };
    }
  }

  // 检测 MCP 连接状态
  checkMCPConnections(hub) {
    const results = [];
    
    for (const [name, conn] of hub.conns) {
      const isSSE = conn.transport === 'sse';
      const isAlive = isSSE ? conn.ready : (conn.process && conn.process.exitCode === null);
      results.push({
        name: `mcp:${name}`,
        healthy: isAlive && conn.ready,
        message: isAlive ? `${conn.tools.length} 个工具${isSSE ? ' (SSE)' : ''}` : (isSSE ? 'SSE 连接断开' : '进程已退出'),
        toolCount: conn.tools.length
      });
    }
    
    return results;
  }

  // 运行所有健康检查
  async runAll(hub) {
    this.logger.info('[HealthCheck] 开始健康检查...');
    
    const checks = [];
    
    // 1. Playwright 检查
    const playwrightCheck = this.checkPlaywright();
    checks.push(playwrightCheck);
    
    // 2. MCP 连接检查
    if (hub) {
      const mcpChecks = this.checkMCPConnections(hub);
      checks.push(...mcpChecks);
    }
    
    // 汇总状态
    const unhealthy = checks.filter(c => !c.healthy);
    const healthy = checks.filter(c => c.healthy);
    
    this.status = {
      timestamp: new Date().toISOString(),
      healthy: unhealthy.length === 0,
      summary: `${healthy.length}/${checks.length} 项正常`,
      checks
    };
    
    this.lastCheck = Date.now();
    
    // 打印结果
    if (unhealthy.length > 0) {
      this.logger.warning(`[HealthCheck] ${unhealthy.length} 项异常:`);
      unhealthy.forEach(c => {
        this.logger.warning(`  - ${c.name}: ${c.message}`);
        if (c.fix) {
          this.logger.info(`    修复: ${c.fix}`);
        }
      });
    } else {
      this.logger.success(`[HealthCheck] 全部正常 (${checks.length} 项)`);
    }
    
    return this.status;
  }

  // 获取上次检查结果
  getStatus() {
    return this.status;
  }

  // 生成修复建议
  getFixSuggestions() {
    if (!this.status.checks) return [];
    
    return this.status.checks
      .filter(c => !c.healthy && c.fix)
      .map(c => ({
        issue: c.issue,
        message: c.message,
        fix: c.fix
      }));
  }
}

export default HealthChecker;
