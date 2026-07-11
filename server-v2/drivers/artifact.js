// Artifact Driver — Omega v4.4 lossless output retrieval
import artifactStore from '../core/artifact-store.js';

let _logger = null;
async function init(deps) { _logger = deps.logger; _logger?.info?.('[Artifact] lossless output driver ready'); }
async function handle(tool, params = {}, ctx = {}) {
  const trace = ctx.trace || ctx;
  trace?.span?.('artifact', { action: tool, ref: params.ref });
  try {
    if (!params.ref) return { success: false, error: `${tool} requires ref` };
    if (tool === 'artifact_info') return { success: true, result: artifactStore.info(params.ref) };
    if (tool === 'artifact_read') return { success: true, result: artifactStore.read(params.ref, params) };
    if (tool === 'artifact_search') return { success: true, result: artifactStore.search(params.ref, params) };
    return { success: false, error: `Unknown artifact tool: ${tool}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
export default { name: 'artifact', tools: ['artifact_read', 'artifact_search', 'artifact_info'], init, handle };
