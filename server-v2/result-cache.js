/**
 * 执行结果缓存模块
 * 避免短时间内重复执行相同的只读操作
 */

export default class ResultCache {
  constructor(logger) {
    this.logger = logger;
    this.cache = new Map();
    this.stats = { hits: 0, misses: 0 };
    
    // 默认 TTL（毫秒）
    this.defaultTTL = 30000; // 30秒
    
    // 可缓存的工具（只读操作）
    this.cacheableTools = new Set([
      'read_file',
      'read_text_file', 
      'read_multiple_files',
      'list_directory',
      'list_directory_with_sizes',
      'directory_tree',
      'get_file_info',
      'search_files',
      'list_allowed_directories',
      'get_symbols',
      'get_ast',
      'find_text',
      'list_projects_tool',
      'list_languages',
      'get_dependencies'
    ]);
    
    // 工具特定的 TTL 配置
    this.toolTTL = {
      'read_file': 60000,           // 1分钟
      'list_directory': 30000,      // 30秒
      'directory_tree': 60000,      // 1分钟
      'get_file_info': 30000,       // 30秒
      'search_files': 20000,        // 20秒（可能变化较快）
      'get_symbols': 120000,        // 2分钟（代码分析较稳定）
      'get_ast': 120000,            // 2分钟
      'list_projects_tool': 300000  // 5分钟
    };
    
    // 自动清理过期缓存
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * 生成缓存键
   */
  generateKey(tool, params) {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {});
    return `${tool}:${JSON.stringify(sortedParams)}`;
  }

  /**
   * 检查是否可缓存
   */
  isCacheable(tool) {
    return this.cacheableTools.has(tool);
  }

  /**
   * 获取缓存
   */
  get(tool, params) {
    if (!this.isCacheable(tool)) {
      return null;
    }
    
    const key = this.generateKey(tool, params);
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    this.stats.hits++;
    this.logger?.debug(`[Cache] 命中: ${tool} (${key.slice(0, 50)}...)`);
    
    return {
      ...entry.result,
      cached: true,
      cachedAt: entry.cachedAt,
      age: Date.now() - entry.cachedAt
    };
  }

  /**
   * 设置缓存
   */
  set(tool, params, result) {
    if (!this.isCacheable(tool)) {
      return;
    }
    
    // 不缓存错误结果
    if (result.error || result.success === false) {
      return;
    }
    
    const key = this.generateKey(tool, params);
    const ttl = this.toolTTL[tool] || this.defaultTTL;
    
    this.cache.set(key, {
      result,
      cachedAt: Date.now(),
      expiresAt: Date.now() + ttl,
      tool,
      params
    });
    
    this.logger?.debug(`[Cache] 存储: ${tool} (TTL: ${ttl/1000}s)`);
  }

  /**
   * 使缓存失效（当文件被修改时调用）
   */
  invalidate(pattern) {
    let invalidated = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      // 按路径匹配
      if (pattern && entry.params?.path) {
        if (entry.params.path.includes(pattern) || pattern.includes(entry.params.path)) {
          this.cache.delete(key);
          invalidated++;
        }
      }
      // 按目录匹配
      if (pattern && entry.tool === 'list_directory') {
        const dir = entry.params.path;
        if (pattern.startsWith(dir) || dir.startsWith(pattern)) {
          this.cache.delete(key);
          invalidated++;
        }
      }
    }
    
    if (invalidated > 0) {
      this.logger?.info(`[Cache] 已失效 ${invalidated} 个缓存条目 (pattern: ${pattern})`);
    }
    
    return invalidated;
  }

  /**
   * 清理过期缓存
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger?.debug(`[Cache] 清理 ${cleaned} 个过期条目`);
    }
  }

  /**
   * 清空所有缓存
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.logger?.info(`[Cache] 已清空 ${size} 个缓存条目`);
    return size;
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(1) + '%' : '0%',
      entries: Array.from(this.cache.entries()).map(([key, entry]) => ({
        tool: entry.tool,
        path: entry.params?.path?.slice(-50),
        age: Math.round((Date.now() - entry.cachedAt) / 1000) + 's',
        ttl: Math.round((entry.expiresAt - Date.now()) / 1000) + 's'
      }))
    };
  }

  /**
   * 销毁（停止清理定时器）
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}
