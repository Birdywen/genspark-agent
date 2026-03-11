// Metrics — 工具调用统计
// 记录每个 tool 的调用次数、成功/失败、平均耗时

class Metrics {
  constructor(logger) {
    this.logger = logger;
    this.stats = new Map();
    this.startTime = Date.now();
  }

  record(tool, driver, duration, success) {
    if (!this.stats.has(tool)) {
      this.stats.set(tool, { count: 0, success: 0, fail: 0, totalMs: 0, driver });
    }
    const s = this.stats.get(tool);
    s.count++;
    if (success) s.success++; else s.fail++;
    s.totalMs += duration;
  }

  getSummary() {
    const result = {};
    for (const [tool, s] of this.stats) {
      result[tool] = {
        count: s.count,
        success: s.success,
        fail: s.fail,
        avgMs: s.count > 0 ? Math.round(s.totalMs / s.count) : 0,
        driver: s.driver
      };
    }
    return result;
  }

  getTopTools(n = 10) {
    return [...this.stats.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, n)
      .map(([tool, s]) => ({ tool, count: s.count, avgMs: Math.round(s.totalMs / s.count), driver: s.driver }));
  }

  reset() {
    this.stats.clear();
    this.startTime = Date.now();
  }
}

export default Metrics;
