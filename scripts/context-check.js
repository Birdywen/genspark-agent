/**
 * Context Check - 快速检测当前对话状态
 * 用 eval_js 执行，返回对话统计信息
 * 当 total > 100 时建议触发压缩
 */
var msgs = document.querySelectorAll('.conversation-statement');
var userMsgs = document.querySelectorAll('.conversation-statement.user');
var asMsgs = document.querySelectorAll('.conversation-statement.assistant');
var totalChars = 0;
msgs.forEach(function(m) { totalChars += m.textContent.length; });

var firstMsgs = [];
userMsgs.forEach(function(m, i) {
  if (i < 6) {
    firstMsgs.push({
      index: i,
      contentId: m.querySelector('.bubble') ? m.querySelector('.bubble').getAttribute('message-content-id') : 'n/a',
      preview: m.textContent.substring(0, 80).trim()
    });
  }
});

var result = {
  totalMessages: msgs.length,
  userMessages: userMsgs.length,
  assistantMessages: asMsgs.length,
  totalChars: totalChars,
  shouldCompress: msgs.length > 100,
  firstUserMessages: firstMsgs
};
return JSON.stringify(result, null, 2);