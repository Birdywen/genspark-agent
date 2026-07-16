// Pure projection used in the browser through function serialization.
// It preserves platform message ids and supports both known forged layouts.
export function applyContextHotReload(messages, latestForged, restorePrompt) {
  const list = Array.isArray(messages) ? messages : [];
  const latest = Array.isArray(latestForged) ? latestForged : [];
  const beforeMessages = list.length;
  let forgedHotReload = false;
  let forgedLayout = 'not-found';

  const forgedSignature = value => String(value || '').includes('以下是JSON格式的经验教训和工作规则');
  const rulesSignature = value => String(value || '').includes('rules已加载');
  const assistantSignature = value => {
    const text = String(value || '');
    return text.includes('"philosophy"') && text.includes('"sys_tools"');
  };

  if (latest.length && list[0] && typeof list[0].content === 'string') {
    try {
      const embedded = JSON.parse(list[0].content);
      if (Array.isArray(embedded) && embedded.length >= 2 && forgedSignature(embedded[0]?.content)) {
        list[0].content = JSON.stringify(latest, null, 2);
        forgedHotReload = true;
        forgedLayout = 'serialized-single-message';
      }
    } catch {
      // Not the serialized layout.
    }
  }

  if (!forgedHotReload && latest.length >= 3 && list.length >= 3) {
    const separateLayout =
      forgedSignature(list[0]?.content) &&
      assistantSignature(list[1]?.content) &&
      rulesSignature(list[2]?.content);
    if (separateLayout) {
      for (let i = 0; i < latest.length && i < list.length; i++) {
        // Preserve id and platform metadata; only managed role/content are refreshed.
        list[i].role = latest[i].role;
        list[i].content = latest[i].content;
      }
      forgedHotReload = true;
      forgedLayout = 'separate-messages';
    }
  }

  const marker = '[OMEGA_CONTEXT_RESTORE_V5]';
  const isRestore = message => {
    const content = String(message?.content || '');
    return content.startsWith(marker) ||
      content.includes('元数据索引 (compress恢复') ||
      content.includes('元数据索引 (compress v5') ||
      (content.startsWith('Context restored.') && content.includes('DB表结构'));
  };
  const restoreIndexes = [];
  for (let i = 0; i < list.length; i++) if (isRestore(list[i])) restoreIndexes.push(i);
  const markedContent = marker + '\n' + String(restorePrompt || '');

  if (restoreIndexes.length) {
    const keep = restoreIndexes[restoreIndexes.length - 1];
    list[keep].content = markedContent;
    for (let i = restoreIndexes.length - 2; i >= 0; i--) list.splice(restoreIndexes[i], 1);
  } else {
    list.push({ role: 'user', content: markedContent });
  }

  return {
    messages: list,
    forgedHotReload,
    forgedLayout,
    forgedMessages: latest.length,
    restoreReplaced: restoreIndexes.length > 0,
    restoreDuplicatesRemoved: Math.max(0, restoreIndexes.length - 1),
    beforeMessages,
    totalMsgs: list.length
  };
}
