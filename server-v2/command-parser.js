// command-parser.js — content 文本 → parsed_command JSON (ADR-004 Day 2)
//
// 职责: 纯函数,吃字符串,吐 {tool, params} 或 null
// 不读不写数据库,不调 LLM,不做副作用
// LLM parser (Day 2 后期/Day 3) 会作为另一个独立 parser,通过同一个签名互相替换

export const PARSER_VERSION = 'grammar-v1';

// 命令前缀
const PREFIX = '/agent';

/**
 * 解析单行命令文本
 * @param {string} content 原始文本
 * @returns {{tool:string, params:object} | null} 命令结构 / null=不是命令
 */
export function parseCommand(content) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith(PREFIX)) return null;

  // 去掉前缀
  const rest = trimmed.slice(PREFIX.length).trim();
  if (!rest) return null;

  // 第一个 token = tool
  const firstSpace = rest.search(/\s/);
  const tool = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
  const argsRaw = firstSpace === -1 ? '' : rest.slice(firstSpace + 1).trim();

  if (!/^[a-z_][a-z0-9_]*$/i.test(tool)) return null; // tool name 必须是 identifier

  const params = argsRaw ? parseKVPairs(argsRaw) : {};
  if (params === null) return null; // 参数解析失败

  return { tool, params };
}

/**
 * 解析 key=value 形式的参数串,支持引号包裹的值
 * 示例: sql="SELECT 1" model=haiku temp=0.5
 * @returns {object | null} 解析失败返回 null
 */
function parseKVPairs(s) {
  const params = {};
  let i = 0;
  while (i < s.length) {
    // 跳过空白
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;

    // key
    const keyStart = i;
    while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) i++;
    if (i === keyStart) return null; // 没 key
    const key = s.slice(keyStart, i);

    // = 号
    if (s[i] !== '=') return null;
    i++;

    // value
    let value;
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i];
      i++;
      const valStart = i;
      while (i < s.length && s[i] !== quote) {
        if (s[i] === '\\\\' && i + 1 < s.length) i++; // 跳过转义字符
        i++;
      }
      if (i >= s.length) return null; // 引号没闭合
      value = s.slice(valStart, i).replace(/\\\\"/g,'"').replace(/\\\\'/g,"'");
      i++; // 跳过收尾引号
    } else {
      const valStart = i;
      while (i < s.length && !/\s/.test(s[i])) i++;
      value = s.slice(valStart, i);
    }

    // 类型推断
    if (/^-?\d+$/.test(value)) params[key] = parseInt(value, 10);
    else if (/^-?\d+\.\d+$/.test(value)) params[key] = parseFloat(value);
    else if (value === 'true') params[key] = true;
    else if (value === 'false') params[key] = false;
    else params[key] = value;
  }
  return params;
}

// 独立运行时的简单 sanity 测试
if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = [
    ['/agent db_query sql="SELECT 42"', {tool:'db_query',params:{sql:'SELECT 42'}}],
    ['/agent ask_ai prompt="hi there" model=haiku', {tool:'ask_ai',params:{prompt:'hi there',model:'haiku'}}],
    ['/agent server_status', {tool:'server_status',params:{}}],
    ['/agent test temp=0.5 max=100 verbose=true', {tool:'test',params:{temp:0.5,max:100,verbose:true}}],
    ['hello world', null],
    ['/agent', null],
    ['/agent 123badname', null],
    ['/agent foo bar', null],
    ['/agent foo key=', {tool:'foo',params:{key:''}}],   // 空 value 算合法(对齐 shell 习惯)
    ['/agent foo key="unclosed', null],
  ];
  let pass = 0, fail = 0;
  for (const [input, expected] of cases) {
    const got = parseCommand(input);
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (ok) { pass++; console.log('PASS:', JSON.stringify(input)); }
    else { fail++; console.log('FAIL:', JSON.stringify(input), 'expected', JSON.stringify(expected), 'got', JSON.stringify(got)); }
  }
  console.log(`---\\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
