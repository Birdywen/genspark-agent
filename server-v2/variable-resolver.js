// Variable Resolver - 高级变量解析引擎
// 支持: 模板替换、数组访问、管道处理、默认值、类型转换

class VariableResolver {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * 解析模板字符串或对象
   * 支持:
   *   {{varName}}              - 简单变量
   *   {{var.field}}            - 对象字段
   *   {{var[0]}}               - 数组索引
   *   {{var | default('x')}}   - 默认值
   *   {{var | json}}           - JSON格式化
   *   {{var | length}}         - 长度
   *   {{var | first}}          - 第一个元素
   *   {{var | join(',')}}      - 数组连接
   */
  resolve(template, variables) {
    // 如果是对象，递归处理每个字段
    if (typeof template === 'object' && template !== null && !Array.isArray(template)) {
      const resolved = {};
      for (const [key, value] of Object.entries(template)) {
        resolved[key] = this.resolve(value, variables);
      }
      return resolved;
    }
    
    // 如果是数组，递归处理每个元素
    if (Array.isArray(template)) {
      return template.map(item => this.resolve(item, variables));
    }
    
    // 如果不是字符串，直接返回
    if (typeof template !== 'string') {
      return template;
    }
    
    // 解析模板字符串
    return this._resolveString(template, variables);
  }

  /**
   * 解析字符串模板
   */
  _resolveString(template, variables) {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
      try {
        const value = this._evaluateExpression(expression.trim(), variables);
        return this._formatValue(value);
      } catch (e) {
        this.logger?.warn(`[VariableResolver] 解析失败: ${expression}, ${e.message}`);
        return match; // 保持原样
      }
    });
  }

  /**
   * 评估表达式
   * 支持管道操作符: var | filter1 | filter2
   */
  _evaluateExpression(expression, variables) {
    // 分割管道
    const parts = expression.split('|').map(p => p.trim());
    const varPath = parts[0];
    const filters = parts.slice(1);
    
    // 获取变量值
    let value = this._getVariable(varPath, variables);
    
    // 应用过滤器
    for (const filter of filters) {
      value = this._applyFilter(value, filter);
    }
    
    return value;
  }

  /**
   * 获取变量值，支持复杂路径
   * 例: var.field, var[0], var.arr[0].name
   */
  _getVariable(path, variables) {
    const tokens = this._tokenizePath(path);
    let value = variables;
    
    for (const token of tokens) {
      if (value === null || value === undefined) {
        return undefined;
      }
      
      if (token.type === 'property') {
        value = value[token.name];
      } else if (token.type === 'index') {
        value = value[token.index];
      }
    }
    
    return value;
  }

  /**
   * 分词路径
   * 例: "var.arr[0].name" -> [{type:'property',name:'var'}, {type:'property',name:'arr'}, {type:'index',index:0}, {type:'property',name:'name'}]
   */
  _tokenizePath(path) {
    const tokens = [];
    let current = '';
    let inBracket = false;
    
    for (let i = 0; i < path.length; i++) {
      const char = path[i];
      
      if (char === '[') {
        if (current) {
          tokens.push({ type: 'property', name: current });
          current = '';
        }
        inBracket = true;
      } else if (char === ']') {
        if (inBracket) {
          tokens.push({ type: 'index', index: parseInt(current) });
          current = '';
          inBracket = false;
        }
      } else if (char === '.' && !inBracket) {
        if (current) {
          tokens.push({ type: 'property', name: current });
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    if (current) {
      tokens.push({ type: 'property', name: current });
    }
    
    return tokens;
  }

  /**
   * 应用过滤器
   */
  _applyFilter(value, filterExpr) {
    // 解析过滤器名称和参数
    const match = filterExpr.match(/^(\w+)(?:\((.*)\))?$/);
    if (!match) return value;
    
    const filterName = match[1];
    const argsStr = match[2];
    const args = argsStr ? this._parseArgs(argsStr) : [];
    
    // 内置过滤器
    switch (filterName) {
      case 'default':
        return value !== undefined && value !== null ? value : args[0];
      
      case 'json':
        return JSON.stringify(value, null, args[0] || 2);
      
      case 'length':
        if (Array.isArray(value)) return value.length;
        if (typeof value === 'string') return value.length;
        if (typeof value === 'object' && value !== null) return Object.keys(value).length;
        return 0;
      
      case 'first':
        if (Array.isArray(value)) return value[0];
        return value;
      
      case 'last':
        if (Array.isArray(value)) return value[value.length - 1];
        return value;
      
      case 'join':
        if (Array.isArray(value)) return value.join(args[0] !== undefined ? args[0] : ',');
        return value;
      
      case 'split':
        if (typeof value === 'string') return value.split(args[0] || ',');
        return value;
      
      case 'upper':
        return typeof value === 'string' ? value.toUpperCase() : value;
      
      case 'lower':
        return typeof value === 'string' ? value.toLowerCase() : value;
      
      case 'trim':
        return typeof value === 'string' ? value.trim() : value;
      
      case 'slice':
        const start = args[0] !== undefined ? parseInt(args[0]) : 0;
        const end = args[1] !== undefined ? parseInt(args[1]) : undefined;
        if (Array.isArray(value) || typeof value === 'string') {
          return value.slice(start, end);
        }
        return value;
      
      case 'map':
        // 简单的字段提取: arr | map('name')
        if (Array.isArray(value) && args[0]) {
          return value.map(item => item?.[args[0]]);
        }
        return value;
      
      case 'filter':
        // 简单过滤: arr | filter('active')
        if (Array.isArray(value) && args[0]) {
          return value.filter(item => item?.[args[0]]);
        }
        return value;
      
      case 'sum':
        if (Array.isArray(value)) {
          return value.reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
        }
        return value;
      
      case 'avg':
        if (Array.isArray(value) && value.length > 0) {
          const sum = value.reduce((s, v) => s + (parseFloat(v) || 0), 0);
          return sum / value.length;
        }
        return value;
      
      case 'min':
        if (Array.isArray(value) && value.length > 0) {
          return Math.min(...value.map(v => parseFloat(v) || Infinity));
        }
        return value;
      
      case 'max':
        if (Array.isArray(value) && value.length > 0) {
          return Math.max(...value.map(v => parseFloat(v) || -Infinity));
        }
        return value;
      
      case 'unique':
        if (Array.isArray(value)) {
          return [...new Set(value)];
        }
        return value;
      
      case 'reverse':
        if (Array.isArray(value)) return [...value].reverse();
        if (typeof value === 'string') return value.split('').reverse().join('');
        return value;
      
      case 'sort':
        if (Array.isArray(value)) return [...value].sort();
        return value;
      
      case 'keys':
        if (typeof value === 'object' && value !== null) {
          return Object.keys(value);
        }
        return value;
      
      case 'values':
        if (typeof value === 'object' && value !== null) {
          return Object.values(value);
        }
        return value;
      
      case 'entries':
        if (typeof value === 'object' && value !== null) {
          return Object.entries(value).map(([k, v]) => ({ key: k, value: v }));
        }
        return value;
      
      case 'replace':
        if (typeof value === 'string' && args.length >= 2) {
          return value.replace(new RegExp(args[0], 'g'), args[1]);
        }
        return value;
      
      case 'match':
        if (typeof value === 'string' && args[0]) {
          const matches = value.match(new RegExp(args[0], 'g'));
          return matches || [];
        }
        return value;
      
      case 'abs':
        return Math.abs(parseFloat(value) || 0);
      
      case 'round':
        const decimals = args[0] !== undefined ? parseInt(args[0]) : 0;
        const num = parseFloat(value) || 0;
        return decimals > 0 ? parseFloat(num.toFixed(decimals)) : Math.round(num);
      
      case 'floor':
        return Math.floor(parseFloat(value) || 0);
      
      case 'ceil':
        return Math.ceil(parseFloat(value) || 0);
      
      default:
        this.logger?.warn(`[VariableResolver] 未知过滤器: ${filterName}`);
        return value;
    }
  }

  /**
   * 解析参数
   * 例: "'hello', 2" -> ['hello', 2]
   */
  _parseArgs(argsStr) {
    if (!argsStr) return [];
    
    const args = [];
    let current = '';
    let inString = false;
    let stringChar = null;
    
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      
      if ((char === '"' || char === "'") && !inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar && inString) {
        inString = false;
        stringChar = null;
      } else if (char === ',' && !inString) {
        args.push(this._parseValue(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      args.push(this._parseValue(current.trim()));
    }
    
    return args;
  }

  /**
   * 解析值类型
   */
  _parseValue(str) {
    // 字符串（带引号）
    if ((str.startsWith('"') && str.endsWith('"')) || 
        (str.startsWith("'") && str.endsWith("'"))) {
      return str.slice(1, -1);
    }
    
    // 数字
    if (/^-?\d+(\.\d+)?$/.test(str)) {
      return parseFloat(str);
    }
    
    // 布尔值
    if (str === 'true') return true;
    if (str === 'false') return false;
    
    // null/undefined
    if (str === 'null') return null;
    if (str === 'undefined') return undefined;
    
    // 其他作为字符串
    return str;
  }

  /**
   * 格式化输出值
   */
  _formatValue(value) {
    if (value === null) return '';
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * 验证模板语法
   */
  validate(template) {
    if (typeof template !== 'string') return { valid: true };
    
    const errors = [];
    const regex = /\{\{([^}]+)\}\}/g;
    let match;
    
    while ((match = regex.exec(template)) !== null) {
      const expression = match[1];
      
      // 检查是否有未闭合的括号
      const openBrackets = (expression.match(/\[/g) || []).length;
      const closeBrackets = (expression.match(/\]/g) || []).length;
      
      if (openBrackets !== closeBrackets) {
        errors.push(`未闭合的括号: ${expression}`);
      }
      
      // 检查管道语法
      const parts = expression.split('|');
      if (parts.length > 1) {
        for (let i = 1; i < parts.length; i++) {
          const filter = parts[i].trim();
          if (!filter.match(/^\w+(?:\([^)]*\))?$/)) {
            errors.push(`无效的过滤器语法: ${filter}`);
          }
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export default VariableResolver;
