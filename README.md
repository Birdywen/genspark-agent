# Genspark Agent Infrastructure

## 🖥️ Servers

### Oracle ARM (Beast Mode) - PRIMARY
- **IP**: 150.136.51.61
- **SSH**: `ssh -i ~/.ssh/oracle-cloud.key ubuntu@150.136.51.61`
- **Specs**: 4 CPU (Neoverse-N1 ARM) / 24 GB RAM / 45 GB disk
- **OS**: Ubuntu 22.04 aarch64
- **永久免费** (Oracle Always Free PAYG)
- **PM2 Services**: sandbox-keepalive
- **Repo**: /home/ubuntu/genspark-agent

### Oracle AMD (Light Duty)
- **IP**: 157.151.227.157
- **SSH**: `ssh -i ~/.ssh/oracle-cloud.key ubuntu@157.151.227.157`
- **Specs**: 2 CPU (x86_64) / 956 MB RAM / 45 GB disk
- **OS**: Ubuntu 24.04 x86_64
- **永久免费** (Oracle Always Free)
- **PM2 Services**: racquetdesk-booker
- **OCI CLI configured**: ~/.oci/config

### Genspark Sandbox (High-Perf)
- **Project ID**: c172a082-7ba2-4105-8050-a56b7cf52cf4
- **Sandbox ID**: isjad10r8glpogdbe5r7n-02b9cc79
- **API Base**: https://3000-isjad10r8glpogdbe5r7n-02b9cc79.sandbox.novita.ai
- **Specs**: 4 CPU (Xeon 2.5GHz) / 7.8 GB RAM / 26 GB disk
- **OS**: Debian Linux x86_64, sudo root
- **Exec API**: POST /api/exec `{"command":"..."}`
- **File API**: GET /api/file/:path, PUT /api/file/:path
- **Status API**: GET /api/status
- **需要保活**: Oracle keepalive 每3分钟ping

### Genspark Sandbox (Standard)
- **Project ID**: a6e50804-320f-4f61-bcd6-93c57f8d6403
- **Sandbox ID**: i3tin0xbrjov9c7se6vov-8f57ffe2
- **URL**: https://3000-i3tin0xbrjov9c7se6vov-8f57ffe2.sandbox.novita.ai

## 🌐 Deployments

### Cloudflare Workers
- **Dashboard**: https://agent-dashboard.woshipeiwenhao.workers.dev
- **CF Token**: ${CF_API_TOKEN}
- **Account ID**: ${CF_ACCOUNT_ID}
- **Deploy**: `wrangler deploy` from sandbox /home/user/webapp

## 🤖 AI APIs

### 1min.ai (Primary - Lifetime Plan)
- **API Key**: ${ONEMIN_API_KEY}
- **Credits**: ~31.5M remaining
- **Endpoint**: https://api.1min.ai/api/features
- **Models**: GPT-4.1, GPT-4o, GPT-4.1-Mini, Claude Opus 4, Claude Sonnet 4, o3, o4-mini, Mistral Large, DeepSeek
- **Usage**: `sos ask "question"` or `ONEMIN_MODEL=claude-opus-4-20250514 sos ask "question"`

### Genspark (Browser-based)
- **Models**: Claude Opus 4, Claude Sonnet 4, GPT-4.1, GPT-4.1 Mini, GPT-4o, o3, o4-mini, Gemini 2.5 Pro, Gemini 2.5 Flash, Kimi K2P5
- **Cost**: ~4 credits per ask_proxy call
- **Credits**: ~8500 remaining

## 🔧 SOS Command Reference

```bash
sos ask "question"       # AI query (1min.ai, ~5-50 credits)
sos se "command"         # Execute bash in sandbox (0 credit)
sos sp file [dest]       # Push file to sandbox (0 credit)
sos sl [path]            # List sandbox directory (0 credit)
sos sr path              # Read sandbox file (0 credit)
sos ss                   # Sandbox status (0 credit)
sos su                   # Sandbox preview URL (0 credit)
sos say "message"        # Mobile push notification (ntfy)


Environment: ONEMIN_MODEL to switch AI model (default: gpt-4.1-mini)

🔐 Credentials
Oracle Cloud
Email: ${ORACLE_EMAIL}
Tenancy: ${OCI_TENANCY}
ARM Instance: ${OCI_ARM_INSTANCE}
GitHub
Repo: https://github.com/Birdywen/genspark-agent
Token: ${GITHUB_TOKEN}
Other APIs
1min.ai Notebook: PUT https://api.1min.ai/users/notebook
Apipod: ${APIPOD_API_KEY}
Retool: ${RETOOL_API_KEY}
ntfy Topics: yay-agent-alerts, oci-arm-grabber-yay
📊 Resource Summary
Server	CPU	RAM	Disk	Status
Oracle ARM	4 core	24 GB	45 GB	Permanent
Oracle AMD	2 core	956 MB	45 GB	Permanent
Sandbox HP	4 core	7.8 GB	26 GB	Keep-alive
Sandbox Std	-	-	-	Keep-alive
Total	10 core	~33 GB	116 GB	
🛡️ Keep-Alive System
Oracle ARM runs sandbox-keepalive.js via PM2
Pings both sandboxes every 3 minutes
After 3 consecutive failures: ntfy push alert
On recovery: ntfy push confirmation
Sandbox server.js has self-heartbeat (writes /tmp/heartbeat every 2 min)
🧩 Chrome Extensions
Genspark Agent Bridge (extension/) - main agent runtime
Per-page toggle: green dot (enabled) / red dot (disabled)
Disable on sandbox page to prevent unnecessary AI responses on lid open/close
📝 TutorLens
Interactive tutorial engine at /tutorial-engine/
Preview: https://3000-isjad10r8glpogdbe5r7n-02b9cc79.sandbox.novita.ai/tutorial-engine/
Zero-dependency, works on any webpage
6-step demo with spotlight, bubbles, navigation EOF

git add -A git commit -m "docs: comprehensive infrastructure README

All servers: Oracle ARM (4c/24G), Oracle AMD (2c/1G), Sandboxes
AI APIs: 1min.ai (31.5M credits), Genspark models
SOS command reference
Credentials and endpoints
Keep-alive system docs
TutorLens docs
Resource summary table" git push origin main 2>&1 | tail -3 SCRIPT 
