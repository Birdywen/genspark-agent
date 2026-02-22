# viaSocket Flow 自动化管理 Skill

## 概述

通过逆向工程 viaSocket 平台 API，实现 agent 自主搜索插件、创建/配置/发布/执行自动化工作流。viaSocket 为 agent 提供通往数百个 SaaS 服务的云端操作层，flow 发布后 7x24 运行，无需本地机器在线。

## 能力

- 插件发现: 搜索 50+ 外部插件 + 10 个内置工具
- Flow 生命周期: 创建 - 添加步骤 - 写入代码 - 发布 - 执行 - 查看日志
- 步骤类型: function, plugin, ifBlock, variable, comment, response, api, break
- 执行方式: Webhook GET/POST, Dry-run, 定时触发
- 已授权服务: Google Sheets, YouTube, viaSocket Table, viaSocket Utilities, Gtwy

## 文件结构

skills/viasocket/
  SKILL.md            - 本文件
  API_REFERENCE.md    - 完整 API 参考文档
  skill.json          - Skill 定义和命令列表
  vs.sh               - CLI 工具 15个命令

## CLI 工具 (vs.sh)

VS="/Users/yay/workspace/genspark-agent/skills/viasocket/vs.sh"

插件发现:
  bash $VS search_plugin keyword
  bash $VS list_actions pluginId
  bash $VS get_action_detail actionId

Flow 管理:
  bash $VS create_flow title
  bash $VS get_flow scriptId
  bash $VS list_flows
  bash $VS publish scriptId
  bash $VS delete_flow scriptId

Step 管理:
  bash $VS add_step scriptId type title
  bash $VS update_step scriptId stepTitle type code_or_file
  bash $VS delete_step scriptId stepTitle

执行:
  bash $VS run scriptId payload_json
  bash $VS dryrun scriptId payload_json
  bash $VS logs scriptId limit

认证:
  bash $VS check_auth

## 创建 Flow 的标准流程

1. create_flow 获得 scriptId
2. add_step 添加步骤 (stepId 自动生成 12字符以内)
3. 写代码到 /private/tmp/xxx.js
4. 用 Python 脚本构建 JSON payload 并 curl PUT 更新
5. publish 发布
6. run 或 webhook URL 触发

## 代码更新的正确方式 (重要)

不要在 bash heredoc 里直接拼 JSON payload, 引号和特殊字符会被 shell 破坏。

正确做法:
1. 把 JS 代码写入 /private/tmp/code.js
2. 用独立 Python 脚本读取代码文件, 构建 JSON, 调用 curl

示例 Python 脚本:
  import json, subprocess
  token = open('/private/tmp/viasocket_token.txt').read().strip()
  code = open('/private/tmp/code.js').read()
  payload = {
      "type": "function", "code": code, "title": "Step_Name",
      "org_id": "54490", "project_id": "proj54490",
      "calculateDetailedVariables": False,
      "auth_id": None, "action_id": None,
      "stepId": "funcXXXXXXXX", "dynamicVariables": {}
  }
  json.dump(payload, open('/private/tmp/payload.json', 'w'))
  subprocess.run(['curl', '-s', '-X', 'PUT',
      '-H', 'Accept: application/json',
      '-H', 'Content-Type: application/json',
      '-H', 'proxy_auth_token: ' + token,
      'https://flow-api.viasocket.com/scripts/SCRIPT_ID/stepv2/Step_Name',
      '-d', '@/private/tmp/payload.json'], capture_output=True, text=True)

## 环境信息

- Org ID: 54490
- Main Project: proj54490
- User ID: 78404
- Token: /private/tmp/viasocket_token.txt
- Plan: Lifetime Free Access

## 已部署 Flow

Upload Video to YouTube (Private) | scri42hM0QuZ | YouTube 上传+缩略图+播放列表
Daily_Tech_News                   | scriRryI37Og | RSS 新闻聚合 HN Top + HN AI

## 已知 Plugin IDs

Google Sheets  | rowqm5xi2
Slack          | rowbu58rc
YouTube        | row40ifjqhqf
Telegram       | rows0luvn
HubSpot        | rowqfz6bv
Airtable       | rowk7lb9w
viaSocket Table| rowe71n93
OpenAI ChatGPT | rowbr9ib3yi9
PostgreSQL     | rowttkhw28re
Trello         | row7k0hsbkvb
Stripe         | rowr25lbhrq6