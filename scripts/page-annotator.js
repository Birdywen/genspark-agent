// 页面元素标注脚本
// 通过 eval_js 在目标页面执行，返回可交互元素对照表
// 用法: eval_js({ code: <此脚本内容>, tabId: xxx })

// 清除上一次的标注
document.querySelectorAll('.agent-annotation').forEach(el => el.remove());

const INTERACTIVE_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[contenteditable="true"]',
  '[onclick]',
  '[tabindex]'
];

const seen = new Set();
const elements = [];
let index = 0;

for (const selector of INTERACTIVE_SELECTORS) {
  document.querySelectorAll(selector).forEach(el => {
    // 跳过不可见元素
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (rect.top > window.innerHeight * 2) return; // 太远的不标注
    
    // 去重（同一个元素可能匹配多个选择器）
    if (seen.has(el)) return;
    seen.add(el);
    
    // 跳过隐藏元素
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
    
    index++;
    
    // 生成最优选择器
    let selector_str = '';
    if (el.id) {
      selector_str = '#' + el.id;
    } else if (el.name) {
      selector_str = `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    } else if (el.className && typeof el.className === 'string' && el.className.trim()) {
      const classes = el.className.trim().split(/\s+/).slice(0, 3).join('.');
      selector_str = `${el.tagName.toLowerCase()}.${classes}`;
    } else {
      // 用层级路径
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (siblings.length > 1) {
          const nth = siblings.indexOf(el) + 1;
          selector_str = `${el.tagName.toLowerCase()}:nth-of-type(${nth})`;
        } else {
          selector_str = el.tagName.toLowerCase();
        }
        if (parent.id) {
          selector_str = `#${parent.id} > ${selector_str}`;
        } else if (parent.className && typeof parent.className === 'string') {
          const pClass = parent.className.trim().split(/\s+/)[0];
          if (pClass) selector_str = `.${pClass} > ${selector_str}`;
        }
      } else {
        selector_str = el.tagName.toLowerCase();
      }
    }
    
    // 提取文本（截断）
    const text = (el.textContent || '').trim().substring(0, 50);
    const placeholder = el.getAttribute('placeholder') || '';
    const role = el.getAttribute('role') || '';
    const type = el.getAttribute('type') || el.tagName.toLowerCase();
    
    // 注入标注标签
    const label = document.createElement('div');
    label.className = 'agent-annotation';
    label.textContent = index;
    label.style.cssText = `
      position: fixed;
      left: ${Math.max(0, rect.left - 2)}px;
      top: ${Math.max(0, rect.top - 2)}px;
      background: rgba(255, 0, 0, 0.85);
      color: white;
      font-size: 10px;
      font-weight: bold;
      padding: 1px 4px;
      border-radius: 3px;
      z-index: 999999;
      pointer-events: none;
      font-family: monospace;
      line-height: 14px;
      min-width: 16px;
      text-align: center;
    `;
    document.body.appendChild(label);
    
    elements.push({
      i: index,
      tag: el.tagName.toLowerCase(),
      selector: selector_str,
      text: text || undefined,
      placeholder: placeholder || undefined,
      role: role || undefined,
      type: type,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    });
  });
}

return JSON.stringify({
  url: location.href,
  title: document.title,
  viewport: { w: window.innerWidth, h: window.innerHeight },
  count: elements.length,
  elements: elements
});
