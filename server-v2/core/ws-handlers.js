// core/ws-handlers.js — WebSocket 消息处理器 (从 main switch 提取)
// 每个 handler: async (msg, ctx) => void
// ctx: { ws, logger, recorder, goalManager, selfValidator, asyncExecutor, taskEngine, history, skillsManager, agents, clients, handleToolCall }

export function createHandlers(ctx) {
  const { ws, logger, recorder, goalManager, selfValidator, asyncExecutor, taskEngine, history, skillsManager, agents, clients, handleToolCall } = ctx;

  return {
    // ── Recording ──
    start_recording: async (msg) => {
      const result = recorder.startRecording(msg.name || msg.recordingId || `rec-${Date.now()}`, msg.name);
      ws.send(JSON.stringify({ type: 'recording_started', ...result }));
    },
    stop_recording: async (msg) => {
      const result = recorder.stopRecording(msg.recordingId);
      ws.send(JSON.stringify({ type: 'recording_stopped', ...result }));
    },
    list_recordings: async (msg) => {
      const recordings = recorder.listRecordings();
      ws.send(JSON.stringify({ type: 'recordings_list', recordings }));
    },
    load_recording: async (msg) => {
      const result = recorder.loadRecording(msg.recordingId);
      ws.send(JSON.stringify({ type: 'recording_loaded', ...result }));
    },
    replay_recording: async (msg) => {
      const loadResult = recorder.loadRecording(msg.recordingId);
      if (!loadResult.success) {
        ws.send(JSON.stringify({ type: 'replay_error', error: loadResult.error }));
        return;
      }
      const replayOptions = {
        variables: msg.variables || {},
        foreach: msg.foreach || null,
        foreachVar: msg.foreachVar || 'item',
        stopOnError: msg.stopOnError !== false
      };
      const batch = recorder.toToolBatch(loadResult.recording, replayOptions);
      const paramInfo = Object.keys(replayOptions.variables).length > 0
        ? `, 参数: ${JSON.stringify(replayOptions.variables)}` : '';
      const loopInfo = replayOptions.foreach
        ? `, 循环: ${replayOptions.foreach.length} 次` : '';
      logger.info(`[WS] 回放录制: ${msg.recordingId}, ${batch.steps.length} 步${paramInfo}${loopInfo}`);
      const result = await taskEngine.executeBatch(batch.id, batch.steps, batch.options, (stepResult) => {
        ws.send(JSON.stringify({ type: 'replay_step_result', recordingId: msg.recordingId, ...stepResult }));
      });
      ws.send(JSON.stringify({ type: 'replay_complete', recordingId: msg.recordingId, ...result }));
    },
    delete_recording: async (msg) => {
      const result = recorder.deleteRecording(msg.recordingId);
      ws.send(JSON.stringify({ type: 'recording_deleted', ...result }));
    },

    // ── Goals ──
    create_goal: async (msg) => {
      const goal = goalManager.createGoal(msg.goalId || `goal-${Date.now()}`, msg.definition);
      ws.send(JSON.stringify({ type: 'goal_created', goal }));
    },
    execute_goal: async (msg) => {
      logger.info(`[WS] 执行目标: ${msg.goalId}`);
      const result = await goalManager.executeGoal(msg.goalId, (progress) => {
        ws.send(JSON.stringify({ type: 'goal_progress', ...progress }));
      });
      ws.send(JSON.stringify({ type: 'goal_complete', ...result }));
    },
    goal_status: async (msg) => {
      const status = goalManager.getGoalStatus(msg.goalId);
      ws.send(JSON.stringify({ type: 'goal_status_result', ...status }));
    },
    list_goals: async (msg) => {
      const goals = goalManager.listGoals();
      ws.send(JSON.stringify({ type: 'goals_list', ...goals }));
    },

    // ── Validated execute ──
    validated_execute: async (msg) => {
      logger.info(`[WS] 验证执行: ${msg.tool}`);
      const result = await selfValidator.executeWithValidation(msg.tool, msg.params, msg.options || {});
      ws.send(JSON.stringify({ type: 'validated_result', tool: msg.tool, ...result }));
    },

    // ── Async ──
    async_execute: async (msg) => {
      logger.info(`[WS] 异步执行: ${msg.command?.slice(0, 50)}...`);
      const result = await asyncExecutor.execute(msg.command, {
        forceAsync: msg.forceAsync || false,
        timeout: msg.timeout || 30000,
        onOutput: (output) => {
          ws.send(JSON.stringify({ type: 'async_output', processId: result?.processId, output }));
        }
      });
      ws.send(JSON.stringify({ type: 'async_result', ...result }));
    },
    async_status: async (msg) => {
      const status = asyncExecutor.getProcessStatus(msg.processId);
      ws.send(JSON.stringify({ type: 'async_status_result', ...status }));
    },
    async_stop: async (msg) => {
      const result = asyncExecutor.stopProcess(msg.processId);
      ws.send(JSON.stringify({ type: 'async_stop_result', processId: msg.processId, ...result }));
    },
    async_log: async (msg) => {
      const result = asyncExecutor.readLog(msg.processId, msg.tail || 100);
      ws.send(JSON.stringify({ type: 'async_log_result', processId: msg.processId, ...result }));
    },

    // ── History ──
    list_history: async (msg) => {
      const count = msg.count || 20;
      const entries = history.get(count);
      ws.send(JSON.stringify({
        type: 'history_list',
        history: entries.map(h => ({
          id: h.id, timestamp: h.timestamp, tool: h.tool,
          params: h.params, success: h.success, error: h.error,
          preview: h.resultPreview?.substring(0, 100)
        }))
      }));
    },
    retry: async (msg) => {
      const entry = history.getById(msg.historyId);
      if (!entry) {
        ws.send(JSON.stringify({ type: 'tool_result', id: msg.id, success: false, error: `找不到历史记录 #${msg.historyId}` }));
      } else {
        logger.info(`重试历史命令 #${entry.id}: ${entry.tool}`);
        await handleToolCall(ws, { tool: entry.tool, params: entry.params, id: msg.id }, true, entry.id);
      }
    },
    get_history_detail: async (msg) => {
      const detail = history.getById(msg.historyId);
      ws.send(JSON.stringify({ type: 'history_detail', entry: detail || null }));
    },

    // ── Skills ──
    list_skills: async (msg) => {
      ws.send(JSON.stringify({ type: 'skills_list', skills: skillsManager.getSkillsList() }));
    },
    get_skills_prompt: async (msg) => {
      ws.send(JSON.stringify({ type: 'skills_prompt', prompt: skillsManager.getSystemPrompt() }));
    },
    get_skill_reference: async (msg) => {
      const ref = skillsManager.getReference(msg.skill, msg.reference);
      ws.send(JSON.stringify({ type: 'skill_reference', skill: msg.skill, reference: msg.reference, content: ref }));
    },
    list_skill_references: async (msg) => {
      const refs = skillsManager.listReferences(msg.skill);
      ws.send(JSON.stringify({ type: 'skill_references_list', skill: msg.skill, references: refs }));
    },

    // ── Cross-extension ──
    register_agent: async (msg) => {
      if (msg.agentId) {
        agents.register(ws, msg.agentId, msg.site || 'unknown');
        ws.send(JSON.stringify({ type: 'agent_registered', agentId: msg.agentId, success: true }));
      }
    },
    cross_extension_send: async (msg) => {
      if (msg.to && msg.message) {
        const fromAgent = msg.from || 'unknown';
        const result = agents.sendMessage(fromAgent, msg.to, msg.message);
        ws.send(JSON.stringify({ type: 'cross_extension_result', ...result, to: msg.to }));
      }
    },
    list_online_agents: async (msg) => {
      ws.send(JSON.stringify({ type: 'online_agents', agents: agents.getOnline() }));
    },

    // ── Broadcast ──
    broadcast: async (msg) => {
      if (msg.payload) {
        logger.info("广播消息: " + (msg.payload.type || "unknown"));
        for (const client of clients) {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify(msg.payload));
          }
        }
        ws.send(JSON.stringify({ type: "broadcast_result", success: true }));
      }
    },
  };
}
