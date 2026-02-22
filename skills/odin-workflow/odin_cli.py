#!/usr/bin/env python3
"""Odin AI Workflow CLI - Thin wrapper around odinai-sdk"""

import sys
import os
import json
import argparse
import traceback

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "odin_config.env")

def load_config():
    config = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    config[k.strip()] = v.strip()
    return config

def get_sdk_config():
    import odin_sdk
    cfg = load_config()
    api_key = cfg.get("ODIN_API_KEY", "")
    api_secret = cfg.get("ODIN_API_SECRET", "")
    base_url = cfg.get("ODIN_BASE_URL", "https://api.getodin.ai")
    project_id = cfg.get("ODIN_PROJECT_ID", "")
    if not api_key or not api_secret:
        print("ERROR: ODIN_API_KEY and ODIN_API_SECRET must be set in " + CONFIG_PATH)
        sys.exit(1)
    configuration = odin_sdk.Configuration(host=base_url)
    return configuration, api_key, api_secret, project_id

def api_client():
    import odin_sdk
    configuration, api_key, api_secret, project_id = get_sdk_config()
    client = odin_sdk.ApiClient(configuration)
    return client, api_key, api_secret, project_id

def pp(obj):
    """Pretty print API response"""
    if hasattr(obj, "to_dict"):
        print(json.dumps(obj.to_dict(), indent=2, default=str))
    elif isinstance(obj, (dict, list)):
        print(json.dumps(obj, indent=2, default=str))
    else:
        print(obj)

# ============================================================
# Commands
# ============================================================

def cmd_check_auth(args):
    """Verify API credentials by listing projects"""
    import odin_sdk
    client, api_key, api_secret, project_id = api_client()
    with client:
        api = odin_sdk.ProjectsApi(client)
        result = api.get_projects_projects_get(x_api_key=api_key, x_api_secret=api_secret)
        projects = result if isinstance(result, list) else [result]
        print("AUTH OK - Found %d project(s)" % len(projects))
        for p in projects:
            if hasattr(p, "to_dict"):
                d = p.to_dict()
                print("  - %s (id: %s)" % (d.get("name", "?"), d.get("id", d.get("project_id", "?"))))
            else:
                print("  -", p)
        if project_id:
            print("Default project_id: " + project_id)
        else:
            print("WARNING: ODIN_PROJECT_ID not set in config")

def cmd_list_projects(args):
    """List all projects"""
    import odin_sdk
    client, api_key, api_secret, _ = api_client()
    with client:
        api = odin_sdk.ProjectsApi(client)
        result = api.get_projects_projects_get(x_api_key=api_key, x_api_secret=api_secret)
        pp(result)

def cmd_list_agents(args):
    """List agents for a project"""
    import odin_sdk
    client, api_key, api_secret, default_pid = api_client()
    pid = args.project_id or default_pid
    if not pid:
        print("ERROR: project_id required (argument or config)")
        sys.exit(1)
    with client:
        api = odin_sdk.AgentsApi(client)
        result = api.list_agents_for_project_agents_project_id_list_get(pid, x_api_key=api_key, x_api_secret=api_secret)
        pp(result)

def cmd_list_workflows(args):
    """List workflows"""
    import odin_sdk
    client, api_key, api_secret, default_pid = api_client()
    with client:
        api = odin_sdk.WorkflowsApi(client) if hasattr(odin_sdk, "WorkflowsApi") else None
        if api is None:
            # Fallback: use raw request
            import urllib.request
            cfg = load_config()
            url = cfg.get("ODIN_BASE_URL", "https://api.getodin.ai") + "/workflows"
            if args.active:
                url += "?active=true"
            req = urllib.request.Request(url)
            req.add_header("X-API-KEY", cfg.get("ODIN_API_KEY", ""))
            req.add_header("X-API-SECRET", cfg.get("ODIN_API_SECRET", ""))
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                pp(data)
            return
        kwargs = {"x_api_key": api_key, "x_api_secret": api_secret}
        if args.active:
            kwargs["active"] = True
        result = api.get_workflows_workflows_get(**kwargs)
        pp(result)

def cmd_get_workflow(args):
    """Get workflow details"""
    import odin_sdk
    client, api_key, api_secret, _ = api_client()
    with client:
        if hasattr(odin_sdk, "WorkflowsApi"):
            api = odin_sdk.WorkflowsApi(client)
            result = api.get_workflow_workflows_workflow_id_get(args.workflow_id, x_api_key=api_key, x_api_secret=api_secret)
            pp(result)
        else:
            raw_request("GET", "/workflows/" + args.workflow_id)

def cmd_create_workflow(args):
    """Create a new workflow"""
    cfg = load_config()
    body = {"name": args.name}
    if args.nodes_file:
        with open(args.nodes_file) as f:
            nodes_data = json.load(f)
        if "nodes" in nodes_data:
            body["nodes"] = nodes_data["nodes"]
        if "connections" in nodes_data:
            body["connections"] = nodes_data["connections"]
    raw_request("POST", "/workflows", body)

def cmd_activate_workflow(args):
    """Activate a workflow"""
    raw_request("POST", "/workflows/" + args.workflow_id + "/activate")

def cmd_deactivate_workflow(args):
    """Deactivate a workflow"""
    raw_request("POST", "/workflows/" + args.workflow_id + "/deactivate")

def cmd_delete_workflow(args):
    """Delete a workflow"""
    raw_request("DELETE", "/workflows/" + args.workflow_id)

def cmd_duplicate_workflow(args):
    """Duplicate a workflow"""
    url = "/workflows/" + args.workflow_id + "/duplicate"
    if args.name:
        url += "?name=" + args.name
    raw_request("POST", url)

def cmd_export_workflow(args):
    """Export a workflow"""
    raw_request("GET", "/workflows/" + args.workflow_id + "/export")

def cmd_list_tools(args):
    """List custom tools"""
    cfg = load_config()
    pid = args.project_id or cfg.get("ODIN_PROJECT_ID", "")
    url = "/tools/custom?project_id=" + pid
    raw_request("GET", url)

def cmd_get_tool(args):
    """Get custom tool details"""
    raw_request("GET", "/tools/custom/" + args.tool_id)

def cmd_execute_tool(args):
    """Execute a custom tool"""
    cfg = load_config()
    pid = args.project_id or cfg.get("ODIN_PROJECT_ID", "")
    body = {
        "project_id": pid,
        "tool_id": args.tool_id,
        "inputs": json.loads(args.inputs) if args.inputs else {},
        "execution_mode": "workflow",
        "mode": "manual"
    }
    raw_request("POST", "/tools/execute-workflow", body)

def cmd_list_scripts(args):
    """List code scripts"""
    cfg = load_config()
    pid = args.project_id or cfg.get("ODIN_PROJECT_ID", "")
    raw_request("GET", "/code-scripts?project_id=" + pid)

def cmd_execute_script(args):
    """Execute a code script"""
    body = {
        "args": json.loads(args.args_json) if args.args_json else [],
        "kwargs": {}
    }
    raw_request("POST", "/code-scripts/" + args.script_id + "/execute", body)

def cmd_execution_history(args):
    """Get execution history"""
    cfg = load_config()
    pid = args.project_id or cfg.get("ODIN_PROJECT_ID", "")
    url = "/tools/execution-history?project_id=" + pid
    if args.tool_id:
        url += "&tool_id=" + args.tool_id
    raw_request("GET", url)

def cmd_execution_detail(args):
    """Get execution run details"""
    raw_request("GET", "/tools/execution-history/" + args.run_id)

def cmd_list_chats(args):
    """List chats"""
    cfg = load_config()
    pid = args.project_id or cfg.get("ODIN_PROJECT_ID", "")
    raw_request("GET", "/project/" + pid + "/chat")

def cmd_list_kb(args):
    """List knowledge base"""
    cfg = load_config()
    pid = args.project_id or cfg.get("ODIN_PROJECT_ID", "")
    raw_request("GET", "/project/" + pid + "/knowledge")

# ============================================================
# Raw HTTP helper (for endpoints not in SDK or simpler usage)
# ============================================================

def raw_request(method, path, body=None):
    import urllib.request
    cfg = load_config()
    base = cfg.get("ODIN_BASE_URL", "https://api.getodin.ai")
    url = base + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-API-KEY", cfg.get("ODIN_API_KEY", ""))
    req.add_header("X-API-SECRET", cfg.get("ODIN_API_SECRET", ""))
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            result = resp.read().decode()
            try:
                pp(json.loads(result))
            except:
                print(result)
    except urllib.error.HTTPError as e:
        body_text = e.read().decode() if e.fp else ""
        print("HTTP %d: %s" % (e.code, e.reason))
        if body_text:
            try:
                pp(json.loads(body_text))
            except:
                print(body_text)
        sys.exit(1)

# ============================================================
# Argument parser
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Odin AI Workflow CLI")
    sub = parser.add_subparsers(dest="command")

    # Auth
    sub.add_parser("check_auth", help="Verify credentials")
    sub.add_parser("list_projects", help="List projects")

    # Agents
    p = sub.add_parser("list_agents", help="List agents")
    p.add_argument("--project-id", default="")

    # Workflows
    p = sub.add_parser("list_workflows", help="List workflows")
    p.add_argument("--active", action="store_true")
    p = sub.add_parser("get_workflow", help="Get workflow")
    p.add_argument("workflow_id")
    p = sub.add_parser("create_workflow", help="Create workflow")
    p.add_argument("name")
    p.add_argument("--nodes-file", default="")
    p = sub.add_parser("activate_workflow", help="Activate workflow")
    p.add_argument("workflow_id")
    p = sub.add_parser("deactivate_workflow", help="Deactivate workflow")
    p.add_argument("workflow_id")
    p = sub.add_parser("delete_workflow", help="Delete workflow")
    p.add_argument("workflow_id")
    p = sub.add_parser("duplicate_workflow", help="Duplicate workflow")
    p.add_argument("workflow_id")
    p.add_argument("--name", default="")
    p = sub.add_parser("export_workflow", help="Export workflow")
    p.add_argument("workflow_id")

    # Custom Tools
    p = sub.add_parser("list_tools", help="List custom tools")
    p.add_argument("--project-id", default="")
    p = sub.add_parser("get_tool", help="Get tool details")
    p.add_argument("tool_id")
    p = sub.add_parser("execute_tool", help="Execute tool")
    p.add_argument("tool_id")
    p.add_argument("--inputs", default="")
    p.add_argument("--project-id", default="")
    p = sub.add_parser("list_scripts", help="List code scripts")
    p.add_argument("--project-id", default="")
    p = sub.add_parser("execute_script", help="Execute script")
    p.add_argument("script_id")
    p.add_argument("--args-json", default="")

    # Execution
    p = sub.add_parser("execution_history", help="Execution history")
    p.add_argument("--project-id", default="")
    p.add_argument("--tool-id", default="")
    p = sub.add_parser("execution_detail", help="Execution detail")
    p.add_argument("run_id")

    # Chat & KB
    p = sub.add_parser("list_chats", help="List chats")
    p.add_argument("--project-id", default="")
    p = sub.add_parser("list_kb", help="List knowledge base")
    p.add_argument("--project-id", default="")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    cmd_func = globals().get("cmd_" + args.command)
    if cmd_func:
        try:
            cmd_func(args)
        except Exception as e:
            print("ERROR: " + str(e))
            traceback.print_exc()
            sys.exit(1)
    else:
        print("Unknown command: " + args.command)
        sys.exit(1)

if __name__ == "__main__":
    main()
