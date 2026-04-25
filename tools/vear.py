#!/usr/bin/env python3
"""
Genspark CLI - 功能完整版
支持：文件读取、自定义 prompt、管道输入、自动化工作流
"""

import websocket
import json
import sys
import os
import time
import threading
import random
import string
import argparse
import glob
from pathlib import Path

class GensparkCLI:
    def __init__(self, cookies: str, model: str = "sonnet"):
        self.ws_url = "wss://vear.com/conversation/go"
        self.cookies = cookies
        # Load uid from config if available
        try:
            cfg_path = Path("~/.config/genspark/config.json").expanduser()
            if cfg_path.exists():
                with open(cfg_path) as f:
                    cfg = json.load(f)
                self.uid = cfg.get('uid', self._generate_uid())
            else:
                self.uid = self._generate_uid()
        except:
            self.uid = self._generate_uid()
        self.cid = None
        self.is_streaming = False
        self.connected = False
        self.response_text = ""
        
        self.models = {
            "claude-4.6-opus": {
                        "md": 11,
                        "mds": 11
            },
            "claude-4.6-sonnet": {
                        "md": 11,
                        "mds": 10
            },
            "claude-4.5-opus": {
                        "md": 11,
                        "mds": 9
            },
            "claude-4.5-sonnet": {
                        "md": 11,
                        "mds": 8
            },
            "claude-4.5-haiku": {
                        "md": 11,
                        "mds": 7
            },
            "gpt-5.4": {
                        "md": 12,
                        "mds": 19
            },
            "gpt-5.2": {
                        "md": 12,
                        "mds": 17
            },
            "gpt-5.1": {
                        "md": 12,
                        "mds": 16
            },
            "gpt-5": {
                        "md": 12,
                        "mds": 13
            },
            "gpt-5-mini": {
                        "md": 12,
                        "mds": 14
            },
            "gpt-5-nano": {
                        "md": 12,
                        "mds": 15
            },
            "gemini-3.1-pro": {
                        "md": 13,
                        "mds": 6
            },
            "gemini-3.0-pro": {
                        "md": 13,
                        "mds": 5
            },
            "grok-4.1": {
                        "md": 14,
                        "mds": 6
            },
            "grok-4": {
                        "md": 14,
                        "mds": 5
            },
            "deepseek-v3": {
                        "md": 16,
                        "mds": 1
            },
            "deepseek-r1": {
                        "md": 16,
                        "mds": 2
            },
            "opus": {
                        "md": 11,
                        "mds": 11
            },
            "sonnet": {
                        "md": 11,
                        "mds": 10
            },
            "haiku": {
                        "md": 11,
                        "mds": 7
            }
        }
        self.current_model = model
    
    def _generate_uid(self):
        def rand_str(n):
            return ''.join(random.choices(string.ascii_lowercase + string.digits, k=n))
        return f"{rand_str(8)}-{rand_str(5)}-{rand_str(5)}"
    
    def _generate_mid(self):
        ts = str(int(time.time() * 1000))
        rand = ''.join(random.choices(string.digits, k=11))
        return f"udpxpnmk{ts[-8:]}{rand}{ts[-3:]}"
    
    def _on_message(self, ws, message):
        try:
            # 记录收到的原始数据长度，用于排查
            if not message:
                return
            
            data = json.loads(message)
            t = data.get("t")
            
            if t == "s":
                self.cid = data.get("cid")
                self.is_streaming = True
                self.last_msg_time = time.time()
            elif t == "m":
                content = data.get("c", "")
                self.response_text += content
                print(content, end="", flush=True)
                self.last_msg_time = time.time()
            elif t == "n":
                # 恢复正常结束信号，让程序在 AI 说完后立即退出
                self.is_streaming = False
                print()
            elif t in ("e", "err"):
                error_msg = data.get("c", str(data))
                print(f"\n[服务器错误] {error_msg}", file=sys.stderr)
                self.is_streaming = False
        except json.JSONDecodeError:
            # 如果不是 JSON，尝试直接打印，看看是不是服务器发了纯文本错误
            print(f"\n[收到非JSON数据] {message[:200]}...", file=sys.stderr)
        except Exception as e:
            print(f"\n[解析异常] {type(e).__name__}: {e}", file=sys.stderr)
            self.is_streaming = False
    
    def _on_error(self, ws, error):
        print(f"\n[WS错误] 详细内容: {error}", file=sys.stderr)
        self.is_streaming = False
    
    def _on_close(self, ws, code, msg):
        print(f"\n[连接关闭] 代码: {code}, 原因: {msg}", file=sys.stderr)
        self.connected = False
        self.is_streaming = False
    
    def _on_open(self, ws):
        self.connected = True
    
    def connect(self):
        self.ws = websocket.WebSocketApp(
            self.ws_url,
            cookie=self.cookies,
            header=[
                "Origin: https://vear.com",
                "Referer: https://vear.com/",
                "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept-Language: en-US,en;q=0.9",
                "Cache-Control: no-cache",
                "Pragma: no-cache",
            ],
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
            on_open=self._on_open,
        )
        
        t = threading.Thread(target=self.ws.run_forever)
        t.daemon = True
        t.start()
        
        for _ in range(100):
            if self.connected:
                break
            time.sleep(0.1)
        
        if not self.connected:
            raise Exception("连接超时")
    
    def send(self, message: str, new_conversation: bool = False, use_context: bool = False) -> str:
        if not self.connected:
            self.connect()
        
        if new_conversation:
            self.cid = None
        elif use_context:
            self._load_context()
        
        model = self.models.get(self.current_model, self.models["opus"])
        payload = {
            "uid": self.uid,
            "mid": self._generate_mid(),
            "q": message,
            "m": model["md"],
            "ms": model["mds"],
            "t": "m"
        }
        
        if self.cid:
            payload["cid"] = self.cid
        
        self.response_text = ""
        self.is_streaming = True
        self.last_msg_time = time.time() # 初始化时间
        self.ws.send(json.dumps(payload))
        
        while self.is_streaming:
            time.sleep(0.1)
            # 如果超过 30 秒没收一个新字，或者总等待超过 300 秒，才跳出
            if time.time() - self.last_msg_time > 30:
                print("\n[超时] 30秒无新字符返回", file=sys.stderr)
                self.is_streaming = False
                break
            if time.time() - self.last_msg_time > 300: # 总保险
                self.is_streaming = False
                break
        
        if use_context and self.cid:
            self._save_context()
        
        return self.response_text
    
    def _context_path(self):
        p = Path("~/.config/genspark").expanduser()
        p.mkdir(parents=True, exist_ok=True)
        return p / "context.json"
    
    def _load_context(self):
        cp = self._context_path()
        if cp.exists():
            try:
                with open(cp) as f:
                    ctx = json.load(f)
                if ctx.get("model") == self.current_model:
                    self.cid = ctx.get("cid")
            except:
                pass
    
    def _save_context(self):
        cp = self._context_path()
        with open(cp, "w") as f:
            json.dump({"cid": self.cid, "model": self.current_model, "ts": time.time()}, f)
    
    def generate_image(self, prompt: str) -> str:
        """Generate an image and return the URL"""
        if not self.connected:
            self.connect()
        
        self.response_text = ""
        self.is_streaming = True
        
        payload = {
            "uid": self.uid,
            "mid": self._generate_mid(),
            "q": prompt,
            "m": 21,
            "ms": 1,
            "t": "i"
        }
        
        self.ws.send(json.dumps(payload))
        
        while self.is_streaming:
            time.sleep(0.1)
        
        return self.response_text.strip()


    def close(self):
        if hasattr(self, 'ws') and self.ws:
            self.ws.close()
        # 移除 os._exit(0)，防止清理过程太突兀导致最后的一点信息没打出来
        time.sleep(0.5) 
        sys.exit(0)


def read_file(file_path: str) -> str:
    """读取文件内容"""
    path = Path(file_path).expanduser()
    
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {file_path}")
    
    # 支持的文件类型
    text_extensions = {
        '.txt', '.md', '.py', '.js', '.ts', '.jsx', '.tsx',
        '.html', '.css', '.json', '.yaml', '.yml', '.xml',
        '.sh', '.bash', '.zsh', '.fish',
        '.c', '.cpp', '.h', '.hpp', '.java', '.go', '.rs',
        '.sql', '.r', '.rb', '.php', '.swift', '.kt',
        '.dockerfile', '.gitignore', '.env', '.toml', '.ini', '.cfg',
        '.csv', '.log', ''  # 无扩展名
    }
    
    suffix = path.suffix.lower()
    if suffix not in text_extensions and path.stat().st_size > 1024 * 1024:
        raise ValueError(f"不支持的文件类型或文件过大: {file_path}")
    
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        return f.read()


def expand_file_references(text: str) -> str:
    """展开文本中的 @file 引用"""
    import re
    
    def replace_file_ref(match):
        file_path = match.group(1)
        try:
            content = read_file(file_path)
            filename = Path(file_path).name
            return f"\n\n--- {filename} ---\n```\n{content}\n```\n"
        except Exception as e:
            return f"\n[无法读取文件 {file_path}: {e}]\n"
    
    # 匹配 @filepath 或 @"file path with spaces"
    pattern = r'@"([^"]+)"|@(\S+)'
    
    def replacer(match):
        file_path = match.group(1) or match.group(2)
        return replace_file_ref(type('Match', (), {'group': lambda self, x: file_path})())
    
    return re.sub(pattern, replacer, text)


def build_prompt(
    message: str,
    files: list = None,
    system_prompt: str = None,
    template: str = None
) -> str:
    """构建完整的 prompt"""
    parts = []
    
    # 系统提示
    if system_prompt:
        parts.append(f"[System Instructions]\n{system_prompt}\n")
    
    # 模板
    if template:
        template_path = Path(template).expanduser()
        if template_path.exists():
            template_content = read_file(template)
            parts.append(f"[Template]\n{template_content}\n")
    
    # 文件内容
    if files:
        parts.append("[Files]")
        for file_path in files:
            # 支持 glob 模式
            if '*' in file_path:
                matched_files = glob.glob(file_path, recursive=True)
                for f in matched_files:
                    if os.path.isfile(f):
                        try:
                            content = read_file(f)
                            parts.append(f"\n--- {f} ---\n```\n{content}\n```")
                        except Exception as e:
                            parts.append(f"\n--- {f} ---\n[读取失败: {e}]")
            else:
                try:
                    content = read_file(file_path)
                    parts.append(f"\n--- {file_path} ---\n```\n{content}\n```")
                except Exception as e:
                    parts.append(f"\n--- {file_path} ---\n[读取失败: {e}]")
        parts.append("")
    
    # 展开消息中的 @file 引用
    message = expand_file_references(message)
    
    # 用户消息
    parts.append(f"[Question]\n{message}")
    
    return "\n".join(parts)


def repl(cli: GensparkCLI, system_prompt: str = None):
    """交互式 REPL"""
    print(f"🚀 Genspark CLI - {cli.current_model.upper()}")
    print("命令: /new /model /file /system /help /quit")
    print("提示: 使用 @filename 引用文件")
    print("-" * 50)
    
    cli.connect()
    current_system = system_prompt
    
    while True:
        try:
            user_input = input("\n你: ").strip()
            if not user_input:
                continue
            
            # 命令处理
            if user_input.startswith("/"):
                cmd_parts = user_input.split(maxsplit=1)
                cmd = cmd_parts[0].lower()
                arg = cmd_parts[1] if len(cmd_parts) > 1 else ""
                
                if cmd == "/quit" or cmd == "/exit":
                    break
                
                elif cmd == "/new":
                    cli.cid = None
                    print("[✓ 新对话]")
                    continue
                
                elif cmd == "/model":
                    if arg in cli.models:
                        cli.current_model = arg
                        print(f"[✓ 模型: {arg}]")
                    else:
                        print(f"可用模型: {', '.join(cli.models.keys())}")
                    continue
                
                elif cmd == "/file":
                    if arg:
                        try:
                            content = read_file(arg)
                            print(f"[✓ 已加载 {arg} ({len(content)} 字符)]")
                            prompt = build_prompt(
                                f"请分析这个文件的内容",
                                files=[arg],
                                system_prompt=current_system
                            )
                            print("\nClaude: ", end="", flush=True)
                            cli.send(prompt)
                        except Exception as e:
                            print(f"[✗ {e}]")
                    else:
                        print("用法: /file <路径>")
                    continue
                
                elif cmd == "/system":
                    if arg:
                        current_system = arg
                        print(f"[✓ 系统提示已设置]")
                    else:
                        current_system = None
                        print("[✓ 系统提示已清除]")
                    continue
                
                elif cmd == "/help":
                    print("""
命令:
  /new              新建对话
  /model <name>     切换模型 (opus, sonnet, haiku, gpt5, gemini, grok)
  /file <path>      加载并分析文件
  /system <prompt>  设置系统提示
  /system           清除系统提示
  /quit             退出

文件引用:
  @filename         在消息中引用文件
  @"path/to/file"   路径有空格时使用引号
                    """)
                    continue
                
                else:
                    print(f"[未知命令: {cmd}]")
                    continue
            
            # 构建 prompt 并发送
            prompt = build_prompt(user_input, system_prompt=current_system)
            print("\nClaude: ", end="", flush=True)
            cli.send(prompt)
            
        except KeyboardInterrupt:
            break
        except EOFError:
            break
    
    print("\n再见!")
    cli.close()


def main():
    parser = argparse.ArgumentParser(
        description="Genspark CLI - 与 Claude/GPT/Gemini 聊天",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 聊天 (默认 opus)
  vear "你好"
  vear -m haiku "快速回答"
  vear -m gpt5 "用 GPT-5.4 回答"
  vear -m gemini "用 Gemini 3.1"
  vear -m deepseek-v3 "用 DeepSeek"

  # 上下文模式 (多轮对话复用同一个会话)
  vear -c "我叫小明"
  vear -c "我叫什么?"

  # 生成图片
  vear -i "a cyberpunk cat with neon glasses"
  vear -i --json "sunset over Tokyo"  # 输出 JSON 含 URL

  # 文件分析
  vear -f main.py "解释这段代码"
  vear -f "src/*.py" "检查代码风格"
  vear "比较 @file1.py 和 @file2.py"

  # 管道输入
  cat error.log | vear "分析这个错误"
  git diff | vear -m sonnet "review 这个改动"

  # 系统提示
  vear -s "你是翻译专家" "translate to English: 你好世界"

  # 管理对话
  vear --history              # 列出对话历史
  vear --clean                # 清除所有 CLI 对话
  vear --delete CID           # 删除指定对话

  # 自动化
  vear --raw -m haiku "say yes"   # 纯文本输出
  vear --json "列出建议"           # JSON 输出

可用模型:
  opus (默认)    Claude 4.6 Opus      | sonnet    Claude 4.6 Sonnet
  opus-4.5       Claude 4.5 Opus      | sonnet-4.5 Claude 4.5 Sonnet
  haiku          Claude 4.5 Haiku     | gpt5      GPT-5.4
  gpt-5-nano     GPT-5 Nano           | gemini    Gemini 3.1 Pro
  gemini-3.0-pro Gemini 3.0 Pro       | grok      Grok 4.1
  grok-4         Grok 4               | deepseek-v3 DeepSeek V3
  deepseek-r1    DeepSeek R1
        """
    )
    
    parser.add_argument("message", nargs="?", default="", help="消息 (空则进入交互模式)")
    parser.add_argument("-f", "--file", action="append", dest="files", help="附加文件 (可多次使用，支持 glob)")
    parser.add_argument("-s", "--system", help="系统提示")
    parser.add_argument("-t", "--template", help="提示模板文件")
    parser.add_argument("-m", "--model", default="sonnet", help="模型 (opus/sonnet/haiku/gpt5/gemini/grok)")
    parser.add_argument("-n", "--new", action="store_true", help="强制新对话")
    parser.add_argument("--json", action="store_true", help="JSON 格式输出 (用于自动化)")
    parser.add_argument("--raw", action="store_true", help="原始输出 (无前缀)")
    parser.add_argument("--history", action="store_true", help="列出对话历史")
    parser.add_argument("--clean", action="store_true", help="清除所有 CLI 产生的对话")
    parser.add_argument("--delete", metavar="CID", help="删除指定对话")
    parser.add_argument("-i", "--image", action="store_true", help="生成图片模式")
    parser.add_argument("-c", "--continue", dest="continue_chat", action="store_true", help="继续上次对话")
    
    args = parser.parse_args()
    
    # 获取 cookies
    # Config file takes priority over env var
    cookies = None
    config_path = Path("~/.config/genspark/config.json").expanduser()
    if config_path.exists():
        with open(config_path) as f:
            cookies = json.load(f).get("cookies")
    if not cookies:
        cookies = os.environ.get("GENSPARK_COOKIES")
    
    if not cookies:
        print("请设置 GENSPARK_COOKIES 环境变量", file=sys.stderr)
        print("  export GENSPARK_COOKIES='你的cookie'", file=sys.stderr)
        sys.exit(1)
    
    cli = GensparkCLI(cookies=cookies, model=args.model)
    
    # 检查管道输入
    stdin_content = ""
    if not sys.stdin.isatty():
        stdin_content = sys.stdin.read()
    
    # 确定消息内容
    message = args.message
    if stdin_content:
        if message:
            message = f"{message}\n\n[Input]\n{stdin_content}"
        else:
            message = stdin_content
    
    # 管理命令
    if args.history or args.clean or args.delete:
        import subprocess
        with open(Path("~/.config/genspark/config.json").expanduser()) as f:
            cfg = json.load(f)
        cookies_val = cfg['cookies']
        uid_val = cfg.get('uid', 'unknown')
        base = f'https://vear.com/api/history/{uid_val}'
        
        if args.history:
            r = subprocess.run(['curl','-s',base,'-H','content-type: application/json',
                '-b',cookies_val,'-H','origin: https://vear.com',
                '--data-raw',json.dumps({"HcP":1,"HpS":20})],capture_output=True,text=True)
            data = json.loads(r.stdout) if r.stdout.strip() else {}
            for c in (data.get('conversations') or []):
                msg = c.get('Messages',[{}])[0].get('content','')[:60]
                ts = c.get('created_at','')[:19]
                print(f"{c['id']}  {ts}  {msg}")
            return
        
        if args.delete:
            r = subprocess.run(['curl','-s','-o','/dev/null','-w','%{http_code}','-X','DELETE',
                f"{base}/{args.delete}",'-b',cookies_val,'-H','origin: https://vear.com'],
                capture_output=True,text=True)
            print(f"Delete {args.delete}: {r.stdout}")
            return
        
        if args.clean:
            r = subprocess.run(['curl','-s',base,'-H','content-type: application/json',
                '-b',cookies_val,'-H','origin: https://vear.com',
                '--data-raw',json.dumps({"HcP":1,"HpS":100})],capture_output=True,text=True)
            data = json.loads(r.stdout) if r.stdout.strip() else {}
            convos = data.get('conversations') or []
            for c in convos:
                subprocess.run(['curl','-s','-o','/dev/null','-X','DELETE',
                    f"{base}/{c['id']}",'-b',cookies_val,'-H','origin: https://vear.com'],
                    capture_output=True)
            print(f"Cleaned {len(convos)} conversations")
            return

        # 交互模式
    if not message and not args.files:
        repl(cli, system_prompt=args.system)
        return
    
    # 单次执行模式
    try:
        cli.connect()
        
        prompt = build_prompt(
            message or "请分析以下文件",
            files=args.files,
            system_prompt=args.system,
            template=args.template
        )
        
        # Image generation mode
        if args.image:
            image_url = cli.generate_image(prompt)
            if args.json:
                print(json.dumps({"model": "image", "url": image_url}, ensure_ascii=False, indent=2))
            else:
                print(image_url)
            cli.close()
            return

        if not args.raw and not args.json:
            print("Claude: ", end="", flush=True)
        
        response = cli.send(prompt, new_conversation=args.new, use_context=args.continue_chat)
        
        if args.json:
            # 重新输出为 JSON (因为流式输出已经打印了)
            print()  # 换行
            output = {
                "model": args.model,
                "response": response,
                "files": args.files,
            }
            print(json.dumps(output, ensure_ascii=False, indent=2))
        
        cli.close()
        
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

