// sse-hook.js — Galaxy AI stream interceptor (MAIN world, document_start)
// Hooks fetch to capture SSE responses from https://chat.galaxy.ai/api/ai-chat
// SSE format: data: {"type":"text|reasoning|tool_use|tool_result|usage|completion", ...}

(function() {
  'use strict';
  if (window.__GALAXY_SSE_HOOK__) return;
  window.__GALAXY_SSE_HOOK__ = true;

  const _origFetch = window.fetch;
  
  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const result = _origFetch.apply(this, args);
    
    // Match Galaxy chat API endpoint
    if (url.includes('/api/ai-chat')) {
      result.then(function(resp) {
        try {
          if (!resp.body) return;
          
          const cloned = resp.clone();
          const reader = cloned.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullText = '';
          let reasoning = '';
          
          document.dispatchEvent(new CustomEvent('__galaxy_sse_connected__', {
            detail: { url, timestamp: Date.now() }
          }));
          
          function pump() {
            reader.read().then(function(chunk) {
              if (chunk.done) {
                document.dispatchEvent(new CustomEvent('__galaxy_sse_closed__', {
                  detail: { fullText, reasoning, timestamp: Date.now() }
                }));
                return;
              }
              
              buffer += decoder.decode(chunk.value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop();
              
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;
                const jsonStr = trimmed.slice(5).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;
                
                try {
                  const data = JSON.parse(jsonStr);
                  
                  switch (data.type) {
                    case 'text':
                      fullText += data.content || '';
                      document.dispatchEvent(new CustomEvent('__galaxy_sse_delta__', {
                        detail: { type: 'text', content: data.content, fullText, timestamp: Date.now() }
                      }));
                      break;
                      
                    case 'reasoning':
                      reasoning += data.reasoning || '';
                      document.dispatchEvent(new CustomEvent('__galaxy_sse_delta__', {
                        detail: { type: 'reasoning', content: data.reasoning, timestamp: Date.now() }
                      }));
                      break;
                      
                    case 'tool_use':
                      document.dispatchEvent(new CustomEvent('__galaxy_sse_tool__', {
                        detail: {
                          type: 'tool_use',
                          toolCallId: data.toolCallId,
                          toolName: data.toolName,
                          parameters: data.parameters,
                          autoApproved: data.autoApproved,
                          timestamp: Date.now()
                        }
                      }));
                      break;
                      
                    case 'tool_result':
                      document.dispatchEvent(new CustomEvent('__galaxy_sse_tool__', {
                        detail: {
                          type: 'tool_result',
                          toolCallId: data.toolCallId,
                          tool: data.tool,
                          autoApproved: data.autoApproved,
                          isCompletion: data.isCompletion,
                          timestamp: Date.now()
                        }
                      }));
                      break;
                      
                    case 'completion':
                      document.dispatchEvent(new CustomEvent('__galaxy_sse_complete__', {
                        detail: { fullText, reasoning, timestamp: Date.now() }
                      }));
                      break;
                      
                    case 'usage':
                      document.dispatchEvent(new CustomEvent('__galaxy_sse_usage__', {
                        detail: data.usage
                      }));
                      break;
                  }
                } catch (e) { /* skip malformed JSON */ }
              }
              
              pump();
            }).catch(function() {
              document.dispatchEvent(new CustomEvent('__galaxy_sse_closed__', {
                detail: { fullText, reasoning, error: true, timestamp: Date.now() }
              }));
            });
          }
          pump();
        } catch(e) { /* ignore */ }
      }).catch(function() {});
    }
    
    return result;
  };
  
  console.log('[Galaxy SSE Hook] Installed — intercepting /api/ai-chat');
})();
