// Deterministic semantic compression backed by commands.status.
// Raw transcripts remain in chat_archive; this module only builds compact projections.

const STATUS_LABELS = {
  success: '成功',
  failed: '真实失败',
  expected_failure: '预期失败',
  acceptance_failed: '语义验收失败'
};

function parseJson(value, fallback = {}) {
  if (!value || typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cleanLine(value, max = 220) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function commandIntent(row) {
  const params = parseJson(row.params);
  const command = String(params.command_line || params.command || '');
  const preview = String(row.result_preview || '');
  const previewIntent = preview.match(/\[意图\]\s*([^\n\r"]+)/);
  if (previewIntent) return cleanLine(previewIntent[1]);
  const commandIntentMatch = command.match(/\[意图\]\s*([^'"\n\r;]+)/);
  if (commandIntentMatch) return cleanLine(commandIntentMatch[1]);
  if (command) return cleanLine(command, 180);
  return cleanLine(row.tool || 'unknown command');
}

function commandEvidence(row) {
  const preview = String(row.result_preview || '');
  let material = preview;
  const parsed = parseJson(preview, null);
  if (parsed && typeof parsed === 'object') {
    material = parsed.stdout || parsed.result || parsed.error || preview;
  }
  const lines = String(material || '').split(/\r?\n/)
    .map(line => cleanLine(line, 240))
    .filter(Boolean)
    .filter(line => !line.startsWith('[意图]'))
    .filter(line => !/^\[#\d+\]\s+\d+$/.test(line));
  return lines[0] || '';
}

function effectiveStatus(row) {
  if (row.status) return row.status;
  return Number(row.success) === 1 ? 'success' : 'failed';
}

export function summarizeCommand(row) {
  const status = effectiveStatus(row);
  const label = STATUS_LABELS[status] || status;
  const lines = [`- #${row.id} ${row.tool || 'tool'} · ${label}`];
  const intent = commandIntent(row);
  if (intent) lines.push(`  意图: ${intent}`);
  const evidence = commandEvidence(row);
  if (evidence && status === 'success') lines.push(`  结果: ${evidence}`);
  const error = cleanLine(row.error, 300);
  if (error && status !== 'success') lines.push(`  原因: ${error}`);
  if (row.full_output_ref) lines.push(`  全文: ${row.full_output_ref}`);
  return lines.join('\n');
}

export function semanticizeCandidates(candidates, commandRows) {
  const byId = new Map(commandRows.map(row => [Number(row.id), row]));
  const replacements = [];
  for (const candidate of candidates || []) {
    const ids = [...new Set((candidate.commandIds || []).map(Number).filter(Number.isFinite))].slice(0, 20);
    const rows = ids.map(id => byId.get(id)).filter(Boolean);
    if (!rows.length) continue;
    const statuses = rows.map(effectiveStatus);
    const unresolved = statuses.includes('failed') || statuses.includes('acceptance_failed');
    const header = unresolved
      ? `[语义压缩｜${rows.length}条命令｜含未解决失败]`
      : `[语义压缩｜${rows.length}条命令｜已验证]`;
    const content = [
      header,
      ...rows.map(summarizeCommand),
      `证据: agent.db commands #${rows.map(row => row.id).join(', #')}`
    ].join('\n');
    replacements.push({
      index: Number(candidate.index),
      content,
      commandIds: rows.map(row => Number(row.id)),
      statuses
    });
  }
  return replacements;
}
