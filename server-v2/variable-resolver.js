// Variable Resolver v2 - 完整实现
// 支持: {{var.field}}, ${var.field}, 深度访问, 对象/数组参数递归替换, 表达式求值

export default class VariableResolver {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * 递归解析模板 - 支持字符串、对象、数组中的变量替换
   */
  resolve(template, vars = {}) {
    if (typeof template === 'string') {
      return this._resolveString(template, vars);
    }
    if (Array.isArray(template)) {
      return template.map(item => this.resolve(item, vars));
    }
    if (template && typeof template === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(template)) {
        result[this._resolveString(key, vars)] = this.resolve(value, vars);
      }
      return result;
    }
    return template;
  }

  /**
   * 字符串模板替换
   * 支持: {{var}}, {{var.field}}, {{var[0]}}, {{var.length}}, ${var}
   * 管道: {{var | json}}, {{var | length}}, {{var | default:fallback}}
   */
  _resolveString(str, vars) {
    if (typeof str !== 'string') return str;

    // 如果整个字符串就是一个模板变量，直接返回原始值（保留类型）
    const wholeMatch = str.match(/^\{\{(.+?)\}\}$/);
    if (wholeMatch) {
      const expr = wholeMatch[1].trim();
      const pipeIndex = expr.indexOf('|');
      if (pipeIndex === -1) {
        const value = this._accessValue(expr, vars);
        if (value !== undefined) return value;
      }
    }

    return str.replace(/\{\{(.+?)\}\}|\$\{(.+?)\}/g, (match, g1, g2) => {
      const expr = (g1 || g2).trim();
      
      // 检查管道操作符
      const pipeIndex = expr.indexOf('|');
      if (pipeIndex !== -1) {
        const varExpr = expr.substring(0, pipeIndex).trim();
        const pipe = expr.substring(pipeIndex + 1).trim();
        const value = this._accessValue(varExpr, vars);
        return this._applyPipe(value, pipe, match);
      }

      const value = this._accessValue(expr, vars);
      if (value === undefined) return match;
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }

  /**
   * 深度访问变量值
   * 支持: var, var.field, var[0], var[0].field, var.length
   */
  _accessValue(expr, vars) {
    // 解析路径: "results[0].name" -> ["results", "0", "name"]
    const parts = expr.replace(/\[(\d+)\]/g, '.$1').split('.');
    
    let value = vars;
    for (const part of parts) {
      if (value == null) return undefined;
      
      // 内置属性
      if (part === 'length') {
        if (Array.isArray(value)) return value.length;
        if (typeof value === 'string') return value.length;
        if (typeof value === 'object') return Object.keys(value).length;
        return undefined;
      }
      
      // v2.2: 虚拟属性 failure = !success（用于 when 条件）
      if (part === 'failure' && value && typeof value === 'object' && 'success' in value) {
        return !value.success;
      }
      
      // 数组索引或对象属性
      value = value[part];
    }
    return value;
  }

  /**
   * 管道操作
   * json: 转 JSON 字符串
   * length: 返回长度
   * upper/lower: 大小写
   * trim: 去空白
   * default:value: 默认值
   * split:sep: 分割为数组
   * join:sep: 数组合并为字符串
   * first/last: 数组第一个/最后一个
   * keys/values: 对象的键/值数组
   * type: 返回类型
   * int/float: 数值转换
   */
  _applyPipe(value, pipe, fallback) {
    const [pipeName, ...pipeArgs] = pipe.split(':');
    const pipeArg = pipeArgs.join(':'); // 支持 default:http://xxx 这种包含冒号的值

    switch (pipeName.trim()) {
      case 'json':
        return value !== undefined ? JSON.stringify(value, null, 2) : fallback;
      case 'length':
        if (Array.isArray(value)) return String(value.length);
        if (typeof value === 'string') return String(value.length);
        if (value && typeof value === 'object') return String(Object.keys(value).length);
        return '0';
      case 'upper':
        return typeof value === 'string' ? value.toUpperCase() : fallback;
      case 'lower':
        return typeof value === 'string' ? value.toLowerCase() : fallback;
      case 'trim':
        return typeof value === 'string' ? value.trim() : fallback;
      case 'default':
        return value !== undefined && value !== null && value !== '' ? String(value) : pipeArg;
      case 'split': {
        if (typeof value !== 'string') return fallback;
        // 支持转义分隔符: \n → 换行, \t → tab
        let sep = pipeArg || ',';
        sep = sep.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        return JSON.stringify(value.split(sep).filter(s => s.length > 0));
      }
      case 'join':
        return Array.isArray(value) ? value.join(pipeArg || ',') : fallback;
      case 'first':
        return Array.isArray(value) && value.length > 0 ? String(value[0]) : fallback;
      case 'last':
        return Array.isArray(value) && value.length > 0 ? String(value[value.length - 1]) : fallback;
      case 'keys':
        return value && typeof value === 'object' ? JSON.stringify(Object.keys(value)) : fallback;
      case 'values':
        return value && typeof value === 'object' ? JSON.stringify(Object.values(value)) : fallback;
      case 'type':
        return Array.isArray(value) ? 'array' : typeof value;
      case 'int':
        return String(parseInt(value, 10) || 0);
      case 'float':
        return String(parseFloat(value) || 0);
      default:
        return value !== undefined ? String(value) : fallback;
    }
  }

  /**
   * 表达式求值 - 用于条件判断
   * 支持: >, <, >=, <=, ==, !=, &&, ||, !, in, includes
   * 安全: 不使用 eval，手动解析
   */
  evaluateExpression(expr, vars) {
    expr = expr.trim();

    // 逻辑运算符 (优先级低，先拆分)
    const orParts = this._splitLogical(expr, '||');
    if (orParts.length > 1) {
      return orParts.some(part => this.evaluateExpression(part, vars));
    }

    const andParts = this._splitLogical(expr, '&&');
    if (andParts.length > 1) {
      return andParts.every(part => this.evaluateExpression(part, vars));
    }

    // 取反
    if (expr.startsWith('!')) {
      return !this.evaluateExpression(expr.substring(1).trim(), vars);
    }

    // 括号
    if (expr.startsWith('(') && expr.endsWith(')')) {
      return this.evaluateExpression(expr.slice(1, -1), vars);
    }

    // 比较运算符
    const comparisons = ['>=', '<=', '!=', '==', '>', '<'];
    for (const op of comparisons) {
      const idx = expr.indexOf(op);
      if (idx !== -1) {
        const left = this._resolveExprValue(expr.substring(0, idx).trim(), vars);
        const right = this._resolveExprValue(expr.substring(idx + op.length).trim(), vars);
        return this._compare(left, right, op);
      }
    }

    // includes 操作符: "array includes value"
    const includesIdx = expr.indexOf(' includes ');
    if (includesIdx !== -1) {
      const left = this._resolveExprValue(expr.substring(0, includesIdx).trim(), vars);
      const right = this._resolveExprValue(expr.substring(includesIdx + 10).trim(), vars);
      if (Array.isArray(left)) return left.includes(right);
      if (typeof left === 'string') return left.includes(String(right));
      return false;
    }

    // 算术运算: +, -, *, /
    const arithmeticOps = ['+', '-', '*', '/'];
    for (const op of arithmeticOps) {
      // 找到不在字符串内的运算符
      const idx = expr.lastIndexOf(op);
      if (idx > 0 && expr[idx-1] !== '=' && expr[idx-1] !== '!' && expr[idx-1] !== '>' && expr[idx-1] !== '<') {
        const left = this._resolveExprValue(expr.substring(0, idx).trim(), vars);
        const right = this._resolveExprValue(expr.substring(idx + 1).trim(), vars);
        const numL = typeof left === 'number' ? left : parseFloat(left);
        const numR = typeof right === 'number' ? right : parseFloat(right);
        if (!isNaN(numL) && !isNaN(numR)) {
          switch(op) {
            case '+': return numL + numR;
            case '-': return numL - numR;
            case '*': return numL * numR;
            case '/': return numR !== 0 ? numL / numR : 0;
          }
        }
      }
    }

    const val = this._resolveExprValue(expr, vars);
    return !!val;
  }

  /**
   * 按逻辑运算符拆分，尊重括号
   */
  _splitLogical(expr, operator) {
    const parts = [];
    let depth = 0;
    let current = '';
    
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') depth--;
      
      if (depth === 0 && expr.substring(i, i + operator.length) === operator) {
        parts.push(current.trim());
        current = '';
        i += operator.length - 1;
      } else {
        current += expr[i];
      }
    }
    parts.push(current.trim());
    return parts.filter(p => p.length > 0);
  }

  /**
   * 解析表达式中的值
   */
  _resolveExprValue(token, vars) {
    // 字符串字面量
    if ((token.startsWith("'") && token.endsWith("'")) ||
        (token.startsWith('"') && token.endsWith('"'))) {
      return token.slice(1, -1);
    }
    // 数字
    if (/^-?\d+(\.\d+)?$/.test(token)) {
      return parseFloat(token);
    }
    // 布尔
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (token === 'undefined') return undefined;
    
    // 变量访问
    return this._accessValue(token, vars);
  }

  /**
   * 比较操作
   */
  _compare(left, right, op) {
    // 数值比较时自动转换
    const numLeft = typeof left === 'string' ? parseFloat(left) : left;
    const numRight = typeof right === 'string' ? parseFloat(right) : right;
    const useNum = !isNaN(numLeft) && !isNaN(numRight);
    
    switch (op) {
      case '==': return useNum ? numLeft === numRight : left == right;
      case '!=': return useNum ? numLeft !== numRight : left != right;
      case '>':  return useNum ? numLeft > numRight : String(left) > String(right);
      case '<':  return useNum ? numLeft < numRight : String(left) < String(right);
      case '>=': return useNum ? numLeft >= numRight : String(left) >= String(right);
      case '<=': return useNum ? numLeft <= numRight : String(left) <= String(right);
      default: return false;
    }
  }
}
