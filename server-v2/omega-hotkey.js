// Omega Hotkey v2 - Ctrl+Shift+E
// 匹配 ΩHERE/ΩHEREBATCH 命令，发到 8766/tool 执行
(function() {
  if (window.__omegaHotkeyV2) return;
  window.__omegaHotkeyV2 = true;

  function parseOmegaHere(text) {
    // 解析单个 ΩHERE block
    var lines = text.split('\n');
    var tool = null, params = {};
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!tool && line.match(/HERE\s+(\w+)/)) {
        tool = line.match(/HERE\s+(\w+)/)[1];
      }
      var paramMatch = line.match(/^@(\w+)=(.*)/);
      if (paramMatch) {
        params[paramMatch[1]] = paramMatch[2];
      }
    }
    return tool ? { tool: tool, params: params } : null;
  }

  async function execTool(tool, params) {
    var resp = await fetch('http://localhost:8766/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: tool, params: params })
    });
    return await resp.json();
  }

  document.addEventListener('keydown', async function(e) {
    if (!(e.ctrlKey && e.shiftKey && e.key === 'E')) return;
    e.preventDefault();
    console.log('[OmegaV2] Ctrl+Shift+E triggered');

    // 获取最后一条 AI 消息的代码块
    var codeBlocks = document.querySelectorAll('pre code');
    if (!codeBlocks.length) {
      alert('[OmegaV2] No code blocks found');
      return;
    }
    var lastCode = codeBlocks[codeBlocks.length - 1].innerText;
    console.log('[OmegaV2] Last code block:', lastCode.substring(0, 100));

    // 检测命令类型
    var results = [];
    
    if (lastCode.indexOf('HEREBATCH') !== -1) {
      // 批量命令 - 按 HERE 分割
      var blocks = lastCode.split(/\nHERE\s+/);
      for (var i = 1; i < blocks.length; i++) {
        var parsed = parseOmegaHere('HERE ' + blocks[i]);
        if (parsed) {
          console.log('[OmegaV2] Exec:', parsed.tool, JSON.stringify(parsed.params).substring(0, 80));
          try {
            var r = await execTool(parsed.tool, parsed.params);
            results.push('[' + parsed.tool + '] ' + (r.success ? 'OK' : 'FAIL') + ': ' + JSON.stringify(r).substring(0, 200));
          } catch(err) {
            results.push('[' + parsed.tool + '] ERROR: ' + err.message);
          }
        }
      }
    } else if (lastCode.indexOf('HERE ') !== -1) {
      // 单命令
      var parsed = parseOmegaHere(lastCode);
      if (parsed) {
        console.log('[OmegaV2] Exec single:', parsed.tool);
        try {
          var r = await execTool(parsed.tool, parsed.params);
          results.push('[' + parsed.tool + '] ' + (r.success ? 'OK' : 'FAIL') + ': ' + JSON.stringify(r).substring(0, 200));
        } catch(err) {
          results.push('[' + parsed.tool + '] ERROR: ' + err.message);
        }
      }
    }

    if (!results.length) {
      alert('[OmegaV2] No executable Omega commands found in last code block');
      return;
    }

    // 结果填入输入框
    var resultText = results.join('\n');
    var input = document.querySelector('textarea');
    if (input) {
      var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSet.call(input, resultText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      console.log('[OmegaV2] Result pasted to input');
    } else {
      navigator.clipboard.writeText(resultText);
      alert('[OmegaV2] Result copied to clipboard');
    }
  });

  console.log('[OmegaV2] Hotkey Ctrl+Shift+E registered (server: 8766)');
})();