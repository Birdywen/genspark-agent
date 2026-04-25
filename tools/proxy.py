#!/usr/bin/env python3
"""
Genspark → Anthropic API 代理 (会话复用版)
"""

from flask import Flask, request, Response
import websocket
import json
import time
import threading
import queue
import random
import string
import os
import sys
import re

app = Flask(__name__)

class GensparkBridge:
    def __init__(self, cookies: str):
        self.ws_url = "wss://vear.com/conversation/go"
        self.cookies = cookies
        self.uid = self._generate_uid()
        
        # 会话管理 - 复用对话
        self.current_cid = None
        self.message_count = 0
        self.max_messages_per_conversation = 50  # 每50条消息新建对话
        
        self.genspark_models = {
            "claude-4.5-opus":    {"md": 11, "mds": 9},
            "claude-4.5-sonnet":  {"md": 11, "mds": 8},
            "claude-4.5-haiku":   {"md": 11, "mds": 7},
            "claude-4.1-opus":    {"md": 11, "mds": 6},
            "claude-4-opus":      {"md": 11, "mds": 5},
            "claude-4-sonnet":    {"md": 11, "mds": 4},
            "claude-3.7-sonnet":  {"md": 11, "mds": 3},
            "claude-3.5-sonnet":  {"md": 11, "mds": 1},
            "claude-3.5-haiku":   {"md": 11, "mds": 2},
            "gpt-5":              {"md": 12, "mds": 13},
            "gpt-4o":             {"md": 12, "mds": 1},
            "gemini-2.5-pro":     {"md": 13, "mds": 3},
            "grok-4":             {"md": 14, "mds": 5},
        }
        
        self.anthropic_to_genspark = {
            "claude-opus-4-5-20251101": "claude-4.5-opus",
            "claude-sonnet-4-5-20251101": "claude-4.5-sonnet",
            "claude-opus-4-20250514": "claude-4-opus",
            "claude-sonnet-4-20250514": "claude-4-sonnet",
            "claude-3-5-sonnet-20241022": "claude-3.5-sonnet",
            "claude-3-5-sonnet-latest": "claude-3.5-sonnet",
            "claude-3-opus-20240229": "claude-4.5-opus",
        }
        
        self.max_continuations = 10
        self.force_opus = True  # 强制使用 Opus
    
    def _generate_uid(self):
        def rand_str(n):
            return ''.join(random.choices(string.ascii_lowercase + string.digits, k=n))
        return f"{rand_str(8)}-{rand_str(5)}-{rand_str(5)}"
    
    def _generate_mid(self):
        ts = str(int(time.time() * 1000))
        rand = ''.join(random.choices(string.digits, k=11))
        return f"udpxpnmk{ts[-8:]}{rand}{ts[-3:]}"
    
    def _generate_msg_id(self):
        return f"msg_{''.join(random.choices(string.ascii_lowercase + string.digits, k=24))}"
    
    def _get_model_config(self, model: str) -> dict:
        if self.force_opus:
            print(f"[模型] 强制使用 claude-4.5-opus", file=sys.stderr)
            return self.genspark_models["claude-4.5-opus"]
        
        genspark_name = self.anthropic_to_genspark.get(model)
        if genspark_name and genspark_name in self.genspark_models:
            return self.genspark_models[genspark_name]
        return self.genspark_models["claude-4.5-opus"]
    
    def _should_new_conversation(self) -> bool:
        """判断是否需要新建对话"""
        if self.current_cid is None:
            return True
        if self.message_count >= self.max_messages_per_conversation:
            print(f"[会话] 消息数达到 {self.message_count}，新建对话", file=sys.stderr)
            self.message_count = 0
            return True
        return False
    
    def _is_truncated(self, text: str, full_content: str) -> bool:
        if not text or len(text) < 50:
            return False
        
        full = full_content.rstrip()
        
        open_braces = full.count('{') - full.count('}')
        open_brackets = full.count('[') - full.count(']')
        if open_braces > 0 or open_brackets > 0:
            return True
        
        if len(re.findall(r'```', full)) % 2 != 0:
            return True
        
        return False
    
    def _get_continue_prompt(self, full_content: str) -> str:
        if full_content.count('{') > full_content.count('}'):
            return "继续，不要重复"
        if len(re.findall(r'```', full_content)) % 2 != 0:
            return "继续完成代码，不要重复"
        return "继续"
    
    def _send_message(self, prompt: str, model_config: dict, use_existing_cid: bool = True):
        response_queue = queue.Queue()
        done_event = threading.Event()
        result = {"content": "", "cid": None, "error": None}
        
        # 决定是否复用 cid
        cid_to_use = self.current_cid if (use_existing_cid and not self._should_new_conversation()) else None
        
        def on_message(ws, message):
            try:
                data = json.loads(message)
                t = data.get("t")
                if t == "s":
                    result["cid"] = data.get("cid")
                elif t == "m":
                    content = data.get("c", "")
                    result["content"] += content
                    response_queue.put(("content", content))
                elif t == "n":
                    done_event.set()
                elif t in ("e", "err"):
                    result["error"] = data.get("c", "Error")
                    done_event.set()
            except Exception as e:
                result["error"] = str(e)
                done_event.set()
        
        def on_error(ws, error):
            result["error"] = str(error)
            done_event.set()
        
        def on_open(ws):
            payload = {
                "uid": self.uid,
                "mid": self._generate_mid(),
                "q": prompt,
                "m": model_config["md"],
                "ms": model_config["mds"],
                "t": "m"
            }
            if cid_to_use:
                payload["cid"] = cid_to_use
                print(f"[会话] 复用 cid: {cid_to_use[:20]}...", file=sys.stderr)
            else:
                print(f"[会话] 新建对话", file=sys.stderr)
            
            ws.send(json.dumps(payload))
        
        def on_close(ws, code, msg):
            done_event.set()
        
        ws = websocket.WebSocketApp(
            self.ws_url,
            cookie=self.cookies,
            header=[
                "Origin: https://www.genspark.ai",
                "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            ],
            on_message=on_message,
            on_error=on_error,
            on_open=on_open,
            on_close=on_close,
        )
        
        ws_thread = threading.Thread(target=ws.run_forever)
        ws_thread.daemon = True
        ws_thread.start()
        
        return response_queue, done_event, result, ws
    
    def _convert_messages(self, messages: list, system: str = None) -> str:
        parts = []
        if system:
            parts.append(f"System: {system}")
        
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            
            if isinstance(content, list):
                text_parts = []
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                        elif block.get("type") == "tool_result":
                            tc = block.get("content", "")
                            if isinstance(tc, list):
                                tc = "\n".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in tc)
                            text_parts.append(f"[Tool Result]: {tc}")
                        elif block.get("type") == "tool_use":
                            text_parts.append(f"[Tool: {block.get('name', '')}]")
                    elif isinstance(block, str):
                        text_parts.append(block)
                content = "\n".join(text_parts)
            
            prefix = "Human:" if role == "user" else "Assistant:"
            parts.append(f"{prefix} {content}")
        
        return "\n\n".join(parts)
    
    def new_conversation(self):
        """强制新建对话"""
        self.current_cid = None
        self.message_count = 0
        print(f"[会话] 已重置", file=sys.stderr)
    
    def chat_stream(self, messages: list, model: str, system: str = None):
        prompt = self._convert_messages(messages, system)
        model_config = self._get_model_config(model)
        msg_id = self._generate_msg_id()
        
        yield f"event: message_start\ndata: {json.dumps({'type': 'message_start', 'message': {'id': msg_id, 'type': 'message', 'role': 'assistant', 'content': [], 'model': model, 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 0, 'output_tokens': 0}}})}\n\n"
        yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}})}\n\n"
        
        full_content = ""
        output_tokens = 0
        continuation = 0
        current_prompt = prompt
        is_first_message = True
        
        while continuation <= self.max_continuations:
            response_queue, done_event, result, ws = self._send_message(
                current_prompt, 
                model_config, 
                use_existing_cid=not is_first_message  # 续写时复用 cid
            )
            segment = ""
            
            while not done_event.is_set() or not response_queue.empty():
                try:
                    msg_type, content = response_queue.get(timeout=0.05)
                    if msg_type == "content" and content:
                        segment += content
                        output_tokens += max(1, len(content) // 4)
                        yield f"event: content_block_delta\ndata: {json.dumps({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': content}})}\n\n"
                except queue.Empty:
                    continue
            
            ws.close()
            
            if result["error"]:
                yield f"event: error\ndata: {json.dumps({'type': 'error', 'error': {'type': 'api_error', 'message': result['error']}})}\n\n"
                return
            
            full_content += segment
            
            # 保存 cid 用于续写
            if result["cid"]:
                self.current_cid = result["cid"]
            
            if self._is_truncated(segment, full_content):
                continuation += 1
                current_prompt = self._get_continue_prompt(full_content)
                is_first_message = False
                print(f"[续写] #{continuation}", file=sys.stderr)
                time.sleep(0.3)
            else:
                break
        
        # 完成后增加消息计数
        self.message_count += 1
        print(f"[会话] 消息数: {self.message_count}, cid: {self.current_cid[:20] if self.current_cid else 'None'}...", file=sys.stderr)
        
        yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': 0})}\n\n"
        yield f"event: message_delta\ndata: {json.dumps({'type': 'message_delta', 'delta': {'stop_reason': 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': output_tokens}})}\n\n"
        yield f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n"


bridge = None

@app.route("/v1/messages", methods=["POST"])
def messages():
    global bridge
    if not bridge:
        return {"error": {"type": "api_error", "message": "Not initialized"}}, 500
    
    data = request.json
    return Response(
        bridge.chat_stream(
            data.get("messages", []),
            data.get("model", "claude-3-opus-20240229"),
            data.get("system")
        ),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.route("/v1/models", methods=["GET"])
def models():
    return {"data": [{"id": "claude-opus-4-5-20251101"}]}


@app.route("/api/<path:path>", methods=["GET", "POST", "PUT", "DELETE"])
def catch_all_api(path):
    return {"status": "ok"}


@app.route("/new", methods=["POST"])
def new_conversation():
    """手动新建对话"""
    global bridge
    if bridge:
        bridge.new_conversation()
    return {"status": "ok", "message": "New conversation started"}


@app.route("/", methods=["GET"])
def index():
    return {
        "status": "ok",
        "current_cid": bridge.current_cid[:20] + "..." if bridge and bridge.current_cid else None,
        "message_count": bridge.message_count if bridge else 0
    }


def main():
    global bridge
    cookies = os.environ.get("GENSPARK_COOKIES")
    if not cookies:
        print("请设置 GENSPARK_COOKIES 环境变量")
        sys.exit(1)
    
    bridge = GensparkBridge(cookies=cookies)
    port = int(os.environ.get("PORT", 8080))
    
    print("=" * 55)
    print("🚀 Genspark → Claude Code 代理 (会话复用版)")
    print("=" * 55)
    print()
    print("特性:")
    print("  ✓ 复用对话，避免刷屏历史记录")
    print("  ✓ 强制使用 Claude 4.5 Opus")
    print("  ✓ 自动续写长回复")
    print()
    print("Claude Code 配置:")
    print(f'  ~/.claude/settings.json 已配置')
    print()
    print(f"手动新建对话: curl -X POST http://localhost:{port}/new")
    print("=" * 55)
    
    app.run(host="0.0.0.0", port=port, threaded=True)


if __name__ == "__main__":
    main()

