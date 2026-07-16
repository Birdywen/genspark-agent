// 语义压缩 v5 (command-status aware) | args: {headN, tailN, dryRun, convId, useNLP}
var convId = args && args.convId;
if (!convId) { var p = new URLSearchParams(window.location.search); convId = p.get("id"); }
if (!convId) return {error: "no convId"};
var headN = (args && args.headN) || 5;
var tailN = (args && args.tailN) || 10;
var dryRun = args && args.dryRun;
var useNLP = args && args.useNLP === true; // default false (NLP disabled)

return fetch("/api/project/update", {
  method: "POST", headers: {"Content-Type": "application/json"}, credentials: "include",
  body: JSON.stringify({id: convId, request_not_update_permission: true})
}).then(function(r) { return r.json(); }).then(async function(d) {
  var ss = d.data.session_state;
  var msgs = ss.messages;
  var total = msgs.length;
  var compressed = 0;
  var totalSaved = 0;
  var activeEnd = Math.max(headN, total - tailN);
  var farEnd = Math.max(headN, activeEnd - 100);
  var midEnd = Math.max(farEnd, activeEnd - 50);
  var nlpScores = {}; // idx -> {score, action, entities}

  // === Phase 1: NLP Scoring (mid-zone messages only, to save API calls) ===
  if (useNLP && total > headN + tailN + 10) {
    var toScore = [];
    for (var si = headN; si < activeEnd; si++) {
      var mc = (msgs[si].content || "").substring(0, 2000);
      if (mc.length > 20) { // skip very short msgs
        toScore.push({idx: si, content: mc});
      }
    }
    if (toScore.length > 0) {
      try {
        // Batch in groups of 20 to avoid huge payloads
        for (var bi = 0; bi < toScore.length; bi += 20) {
          var batch = toScore.slice(bi, bi + 20);
          var nlpResp = await fetch("http://localhost:8766/nlp/score", {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({messages: batch.map(function(x) { return {content: x.content}; })})
          }).then(function(r) { return r.json(); });
          if (nlpResp.scores) {
            nlpResp.scores.forEach(function(s, j) {
              nlpScores[batch[j].idx] = s;
            });
          }
        }
      } catch(e) {
        console.warn("[compress-v4] NLP scoring failed:", e.message);
        // Continue with rule-based only
      }
    }
  }
  var nlpHits = Object.keys(nlpScores).length;

  // === Phase 1.5: deterministic semantic projection from agent.db commands ===
  var semanticApplied = {};
  var semanticized = 0;
  try {
    var candidates = [];
    for (var ci = headN; ci < activeEnd; ci++) {
      var candidateMessage = msgs[ci];
      var candidateContent = String(candidateMessage.content || "");
      if (candidateMessage.role !== "user") continue;
      if (candidateContent.indexOf("[执行结果]") < 0 && candidateContent.indexOf("[批量执行") < 0) continue;
      var commandIds = [];
      var idRegex = /\[#(\d+)\]/g;
      var idMatch;
      while ((idMatch = idRegex.exec(candidateContent)) !== null) commandIds.push(Number(idMatch[1]));
      var historyRegex = /"historyId"\s*:\s*(\d+)/g;
      while ((idMatch = historyRegex.exec(candidateContent)) !== null) commandIds.push(Number(idMatch[1]));
      commandIds = commandIds.filter(function(id, pos, arr) { return arr.indexOf(id) === pos; }).slice(0, 20);
      if (commandIds.length) candidates.push({index: ci, commandIds: commandIds});
    }
    if (candidates.length) {
      var semanticResponse = await fetch("http://localhost:8766/compress/semanticize", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({candidates: candidates})
      }).then(function(r) {
        if (!r.ok) throw new Error("semantic API " + r.status);
        return r.json();
      });
      (semanticResponse.replacements || []).forEach(function(replacement) {
        var idx = Number(replacement.index);
        if (!msgs[idx] || typeof replacement.content !== "string") return;
        var oldLength = String(msgs[idx].content || "").length;
        if (replacement.content.length >= oldLength) return;
        msgs[idx].content = replacement.content;
        semanticApplied[idx] = true;
        semanticized++;
        compressed++;
        totalSaved += oldLength - replacement.content.length;
      });
    }
  } catch (semanticError) {
    console.warn("[compress-v5] semantic projection failed, falling back to v4 rules:", semanticError.message);
  }

  // === Phase 2: Compress with NLP-aware decisions ===
  for (var i = headN; i < activeEnd; i++) {
    var m = msgs[i];
    var c = m.content || "";
    var origLen = c.length;
    if (semanticApplied[i]) continue;
    if (origLen < 50) continue;

    var zone;
    if (i < farEnd) zone = "far";
    else if (i < midEnd) zone = "mid";
    else zone = "near";

    // NLP override: high-salience messages get zone upgrade
    var nlp = nlpScores[i];
    if (nlp) {
      if (nlp.action === "KEEP_FULL") {
        // Protect this message: treat as "near" regardless of position
        zone = "near";
      } else if (nlp.action === "DROP" && zone !== "near") {
        // NLP says worthless: treat as "far" for aggressive compression
        zone = "far";
      } else if (nlp.action === "SUMMARIZE" && zone === "far") {
        // Promote from far to mid
        zone = "mid";
      }
    }

    // --- user messages (tool results) ---
    if (m.role === "user") {
      var isResult = c.indexOf("[执行结果]") > -1 || c.indexOf("[批量执行") > -1;
      var isFail = c.indexOf("失败") > -1 || c.indexOf("超时") > -1 || c.indexOf("TIMEOUT") > -1 || c.indexOf("ERROR") > -1;
      var firstLine = c.split("\n")[0];

      if (isFail && isResult) {
        if (nlp && nlp.action === "KEEP_FULL") {
          // NLP says important failure — keep more context
          msgs[i].content = firstLine + "\n" + c.substring(firstLine.length, 300) + " [NLP保留]";
        } else {
          msgs[i].content = "[已压缩:执行失败]";
        }
      } else if (isResult) {
        if (zone === "far") {
          msgs[i].content = firstLine.substring(0, 80) + " [已压缩]";
        } else if (zone === "mid") {
          var brief = c.substring(0, 200);
          var lastNL = brief.lastIndexOf("\n");
          if (lastNL > 80) brief = brief.substring(0, lastNL);
          msgs[i].content = brief + "\n[已压缩]";
        } else {
          if (c.length > 1500) {
            var cs = c.indexOf("```"), ce = c.lastIndexOf("```");
            if (cs > -1 && ce > cs) {
              var cb = c.substring(cs + 3, ce).split("\n");
              if (cb[0].match(/^[a-z]/)) cb.shift();
              var preview = cb.join("\n").substring(0, 300);
              if (cb.join("\n").length > 300) preview += "\n...";
              msgs[i].content = firstLine + "\n```\n" + preview + "\n```";
            } else {
              msgs[i].content = c.substring(0, 500) + "\n[已压缩]";
            }
          }
        }
      } else if (c.indexOf("[对话状态") > -1 || c.indexOf("⚠️") > -1) {
        if (zone === "far") {
          msgs[i].content = "[状态信息,已压缩]";
        }
      } else if (zone === "far" && c.length > 500) {
        msgs[i].content = c.substring(0, 100) + "\n[已压缩]";
      } else if (zone === "mid" && c.length > 1000) {
        msgs[i].content = c.substring(0, 300) + "\n[已压缩]";
      }
    }

    // --- assistant messages ---
    if (m.role === "assistant") {
      if (zone === "far") {
        var textOnly = c.replace(/```[\s\S]*?```/g, "").trim();
        if (textOnly.length > 200) {
          msgs[i].content = textOnly.substring(0, 150) + " [已压缩]";
        } else if (c.length > 500) {
          msgs[i].content = textOnly || "[已压缩]";
        }
      } else if (zone === "mid") {
        var parts = c.split("```");
        if (parts.length >= 3 && c.length > 800) {
          var nc = parts[0];
          for (var j = 1; j < parts.length; j += 2) {
            var code = parts[j] || "";
            if (code.length > 200) {
              var lns = code.split("\n"), lang = lns[0] || "";
              nc += "```" + lang + "\n" + lns.slice(1, 3).join("\n") + "\n...(已压缩)\n```";
            } else {
              nc += "```" + code + "```";
            }
            if (j + 1 < parts.length) nc += (parts[j + 1] || "");
          }
          msgs[i].content = nc;
        }
      } else {
        if (c.length > 1500) {
          var parts2 = c.split("```");
          if (parts2.length >= 3) {
            var nc2 = parts2[0];
            for (var k = 1; k < parts2.length; k += 2) {
              var code2 = parts2[k] || "";
              if (code2.length > 300) {
                var lns2 = code2.split("\n"), lang2 = lns2[0] || "";
                nc2 += "```" + lang2 + "\n" + lns2.slice(1, 5).join("\n") + "\n...(已压缩)\n```";
              } else {
                nc2 += "```" + code2 + "```";
              }
              if (k + 1 < parts2.length) nc2 += (parts2[k + 1] || "");
            }
            msgs[i].content = nc2;
          }
        }
      }
    }

    var saved = origLen - (msgs[i].content || "").length;
    if (saved > 10) { compressed++; totalSaved += saved; }
  }

  // Emergency rule: recent tail stays protected, but one huge tool result must not fill the context.
  for (var ei = activeEnd; ei < total - 1; ei++) {
    var em = msgs[ei];
    var ec = String((em && em.content) || "");
    var emergencyResult = em && em.role === "user" && (ec.indexOf("[执行结果]") > -1 || ec.indexOf("[批量执行") > -1);
    if (!emergencyResult || ec.length <= 12000) continue;
    var oldEmergencyLength = ec.length;
    var artifactLines = ec.split("\n").filter(function(line) { return line.indexOf("artifact://") > -1 || line.indexOf("Full output") > -1; }).slice(-20).join("\n");
    em.content = ec.substring(0, 3000) + "\n\n[近期超长工具结果已紧急压缩；完整证据见浏览器缓存/commands/Artifact]\n\n" + artifactLines;
    compressed++;
    totalSaved += oldEmergencyLength - em.content.length;
  }

  var result = {
    total: total,
    zones: "head[0-" + headN + "] far[" + headN + "-" + farEnd + "] mid[" + farEnd + "-" + midEnd + "] near[" + midEnd + "-" + activeEnd + "] tail[" + activeEnd + "-" + total + "]",
    compressed: compressed,
    savedKB: (totalSaved / 1024).toFixed(1),
    nlpScored: nlpHits,
    nlpKept: Object.values(nlpScores).filter(function(s) { return s.action === "KEEP_FULL"; }).length,
    nlpDropped: Object.values(nlpScores).filter(function(s) { return s.action === "DROP"; }).length,
    semanticized: semanticized,
    semanticVersion: 5
  };

  if (dryRun) { result.dryRun = true; return result; }

  return fetch("/api/project/update", {
    method: "POST", headers: {"Content-Type": "application/json"}, credentials: "include",
    body: JSON.stringify({id: convId, session_state: ss, request_not_update_permission: true})
  }).then(function(r2) { return r2.json(); }).then(function(d2) {
    var nt = d2.data.session_state.messages.reduce(function(s, m) { return s + (m.content || "").length; }, 0);
    window.__serverMsgChars = nt;
    result.ok = true;
    result.newTotalKB = (nt / 1024).toFixed(1);
    try {
      await fetch('http://127.0.0.1:8766/conversation-ref', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          conversation_id: convId,
          ref_type: 'compress',
          source: 'compress',
          force: true,
          meta: { compressed: result.compressed, savedKB: result.savedKB, semanticVersion: result.semanticVersion || 5 }
        })
      });
    } catch (refErr) { console.warn('[compress-v5] conversation-ref failed', refErr && refErr.message); }
    return result;
  });
});
