# Odin AI Workflow 自动化管理 Skill

## 概述

通过 Odin AI 官方 Python SDK + API 实现 agent 自主管理工作流、自定义工具、代码脚本、Agent 等资源。Odin AI 提供企业级 AI Agent 平台，支持 200+ 集成，工作流发布后 7x24 云端运行。

## 能力

- 项目管理: 列出/创建/更新项目
- Agent 管理: 创建/编辑/激活/停用自定义 Agent
- 工作流(Workflows): 创建/编辑/激活/停用/复制/导入导出 n8n 风格节点工作流
- 自定义工具(Custom Tools): 创建/编辑/发布/执行/版本管理/定时调度
- 代码脚本(Code Scripts): 创建/执行/发布 Python/JS 脚本
- 知识库(Knowledge Base): 上传文件、管理文档
- 执行历史: 查看工作流执行记录和详情
- 数据表(Smart Tables): 结构化数据管理

## 文件结构

skills/odin-workflow/
  SKILL.md              - 本文件
  API_REFERENCE.md      - API 参考文档
  skill.json            - Skill 定义
  odin.sh               - CLI 工具
  odin_config.env       - 配置文件 (API Key/Secret)

## 前置要求

- Python venv: /private/tmp/odin_env (含 odinai-sdk)
- 配置文件: /Users/yay/workspace/genspark-agent/skills/odin-workflow/odin_config.env

## 配置

编辑 odin_config.env 填入:
  ODIN_API_KEY=your-api-key
  ODIN_API_SECRET=your-api-secret
  ODIN_BASE_URL=https://api.getodin.ai
  ODIN_PROJECT_ID=your-default-project-id

## CLI 工具 (odin.sh)

ODIN="/Users/yay/workspace/genspark-agent/skills/odin-workflow/odin.sh"

认证与项目:
  bash $ODIN check_auth
  bash $ODIN list_projects
  bash $ODIN get_project <project_id>

Agent 管理:
  bash $ODIN list_agents [project_id]
  bash $ODIN create_agent <name> <model> <personality_prompt>
  bash $ODIN edit_agent <agent_id> <field> <value>
  bash $ODIN activate_agent <agent_id> [project_id]
  bash $ODIN deactivate_agent <agent_id> [project_id]

工作流:
  bash $ODIN list_workflows [--active
  bash $ODIN get_workflow <workflow_id>
  bash $ODIN create_workflow <name> [nodes_json_file]
  bash $ODIN update_workflow <workflow_id> <nodes_json_file>
  bash $ODIN activate_workflow <workflow_id>
  bash $ODIN deactivate_workflow <workflow_id>
  bash $ODIN duplicate_workflow <workflow_id> [new_name]
  bash $ODIN delete_workflow <workflow_id>
  bash $ODIN export_workflow <workflow_id>
  bash $ODIN import_workflow <json_file> [--activate]

自定义工具:
  bash $ODIN list_tools [project_id]
  bash $ODIN get_tool <tool_id>
  bash $ODIN create_tool <name> <description> <steps_json_file> [project_id]
  bash $ODIN update_tool <tool_id> <steps_json_file>
  bash $ODIN execute_tool <tool_id> [inputs_json] [project_id]
  bash $ODIN publish_tool <tool_id>
  bash $ODIN delete_tool <tool_id>
  bash $ODIN tool_versions <tool_id>
  bash $ODIN tool_schedule_status <tool_id>
  bash $ODIN pause_tool <tool_id>
  bash $ODIN resume_tool <tool_id>

代码脚本:
  bash $ODIN list_scripts [project_id]
  bash $ODIN create_script <name> <runtime> <script_file> [project_id]
  bash $ODIN execute_script <script_id> [args_json]
  bash $ODIN publish_script <script_id>
  bash $ODIN delete_script <script_id>

执行历史:
  bash $ODIN execution_history [project_id] [tool_id]
  bash $ODIN execution_detail <run_id>

知识库:
  bash $ODIN list_kb [project_id]
  bash $ODIN upload_kb <file_path> [project_id]
  bash $ODIN delete_kb <doc_ids...>

聊天:
  bash $ODIN create_chat <name> [project_id]
  bash $ODIN send_message <chat_id> <message> [agent_id]
  bash $ODIN list_chats [project_id]

## 创建工作流的标准流程

1. list_workflows 查看现有工作流
2. create_workflow 创建新工作流 (传入 name)
3. 编写 nodes JSON 文件定义节点和连接
4. update_workflow 更新节点配置
5. activate_workflow 激活
6. execution_history 查看执行结果

## 创建自定义工具的标准流程

1. list_tools 查看现有工具
2. create_tool 创建 (name + description + steps)
3. execute_tool 测试执行
4. publish_tool 发布正式版本
5. 可选: 配置定时调度

## 与 viaSocket 的差异

- Odin 工作流是 n8n 风格的可视化 DAG 图，viaSocket 是线性脚本
- Odin 自定义工具可直接被 Agent 在对话中调用
- Odin 支持文件上传触发、邮件触发、流式执行
- Odin 有完整的版本管理和回滚
- Odin 代码脚本支持 Python runtime + 依赖管理