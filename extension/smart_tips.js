// smart_tips.js - 智能上下文提示系统
// 根据工具类型、执行结果、错误类型返回相关提示

const SmartTips = {
  // 工具相关提示
  toolTips: {
    // 浏览器操作
    'take_screenshot': '截图已保存，可用 read_media_file 查看',
    'take_snapshot': '快照包含 uid，用于 click/fill 等操作',
    'click': '点击后可能需要 wait_for 等待页面变化',
    'fill': '填写后通常需要 click 提交按钮',
    'navigate_page': '导航后用 take_snapshot 获取页面内容',
    'new_page': '新页面已创建，用 take_snapshot 查看内容',
    
    // 文件操作
    'write_file': '大文件建议用 run_command + cat/echo 写入',
    'edit_file': '小范围修改用 edit_file，大改用 write_file',
    'read_file': '读取成功，可继续处理内容',
    'read_multiple_files': '批量读取完成',
    
    // 命令执行
    'run_command': '长任务可用 nohup 后台执行',
    
    // 代码分析
    'register_project_tool': '项目已注册，可用 get_symbols/find_text 分析',
    'get_symbols': '符号列表可用于 find_usage 查引用',
    'find_text': '搜索结果包含上下文，便于定位',
  },
  
  // 错误相关提示
  errorTips: {
    'timeout': '超时了，可拆分任务或用后台执行: nohup cmd &',
    'not found': '路径不存在，先用 list_directory 确认',
    'permission': '权限不足，检查是否在允许目录内',
    'ENOENT': '文件/目录不存在，检查路径拼写',
    'EACCES': '访问被拒绝，检查文件权限',
    'JSON parse': 'JSON 解析错误，检查引号是否转义为 \\"',
    'too large': '内容过大，用 run_command + stdin 或拆分写入',
    'connection': '连接失败，检查网络或服务状态',
  },
  
  // 内容相关提示（根据输出内容触发）
  contentTips: {
    'No such file': '文件不存在，用 list_directory 查看目录',
    'command not found': '命令不存在，检查是否已安装',
    'Permission denied': '权限不足，可能需要检查文件权限',
    'syntax error': '语法错误，检查代码格式',
  },
  
  // 通用提示（兜底随机显示）
  generalTips: [
    '举例时不加@: 写 TOOL:{...} 而非 @TOOL:{...}',
    '每次只调用一个工具，等结果后再继续',
    '长内容勿塞JSON: 用 run_command + stdin 写入',
    '项目记忆: memory_manager_v2.js projects',
    '记录里程碑: memory_manager_v2.js milestone "完成XX"',
  ],
  
  /**
   * 获取智能提示
   * @param {string} tool - 工具名称
   * @param {boolean} success - 是否成功
   * @param {string} content - 输出内容
   * @param {string} error - 错误信息
   * @returns {string} 提示文本
   */
  getTip(tool, success, content = '', error = '') {
    // 1. 失败时优先匹配错误提示
    if (!success) {
      const errorText = (error + ' ' + content).toLowerCase();
      for (const [key, tip] of Object.entries(this.errorTips)) {
        if (errorText.includes(key.toLowerCase())) {
          return tip;
        }
      }
    }
    
    // 2. 检查输出内容中的关键词
    const contentLower = content.toLowerCase();
    for (const [key, tip] of Object.entries(this.contentTips)) {
      if (contentLower.includes(key.toLowerCase())) {
        return tip;
      }
    }
    
    // 3. 成功时返回工具相关提示
    if (success && this.toolTips[tool]) {
      return this.toolTips[tool];
    }
    
    // 4. 兜底：随机通用提示
    return this.generalTips[Math.floor(Math.random() * this.generalTips.length)];
  }
};

// 导出供 content.js 使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SmartTips;
}
