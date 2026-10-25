import os
import sys
import json
import subprocess
import traceback
import requests
from pathlib import Path

CONFIG_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "DahlStudio"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULT_SYSTEM_PROMPT = """You are DahlStudio AI, an expert autonomous coding assistant operating directly inside the user's workspace.
You have tools to inspect, modify, and build their codebase directly on their local machine.

Always inspect files before editing them when unsure.
When writing or editing files, ensure the code is correct, clean, and directly runnable.
Be concise and helpful in your explanations."""

class DahlAPI:
    def __init__(self, window=None):
        self.window = window
        self.current_workspace = os.path.expanduser("~\\Documents")
        self._ensure_config()

    def set_window(self, window):
        self.window = window

    def _ensure_config(self):
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            if not CONFIG_FILE.exists():
                default_cfg = {
                    "apiKey": "",
                    "baseUrl": "https://inference.dahl.global/v1",
                    "model": "deepseek-ai/DeepSeek-V3",
                    "reasoningEffort": "medium",
                    "lastWorkspace": self.current_workspace
                }
                with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                    json.dump(default_cfg, f, indent=2)
            else:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    if "lastWorkspace" in cfg and os.path.isdir(cfg["lastWorkspace"]):
                        self.current_workspace = cfg["lastWorkspace"]
        except Exception as e:
            print(f"Config error: {e}")

    # ================= SETTINGS =================
    def get_settings(self):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                data["currentWorkspace"] = self.current_workspace
                return {"status": "ok", "settings": data}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def save_settings(self, settings):
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            current = {}
            if CONFIG_FILE.exists():
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    current = json.load(f)
            current.update(settings)
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(current, f, indent=2)
            return {"status": "ok"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ================= WORKSPACE & FILES =================
    def select_folder(self):
        try:
            folder = None
            if self.window:
                try:
                    import webview
                    res = self.window.create_file_dialog(webview.FOLDER_DIALOG)
                    if res and len(res) > 0:
                        folder = res[0]
                except Exception:
                    pass

            if not folder:
                # Fallback to tkinter dialog
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                folder = filedialog.askdirectory(initialdir=self.current_workspace)
                root.destroy()

            if folder and os.path.isdir(folder):
                self.current_workspace = os.path.abspath(folder)
                self.save_settings({"lastWorkspace": self.current_workspace})
                return {"status": "ok", "path": self.current_workspace}
            return {"status": "cancelled"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def get_workspace_info(self):
        return {
            "status": "ok",
            "workspace": self.current_workspace,
            "name": os.path.basename(self.current_workspace) or self.current_workspace
        }

    def list_files(self, base_path=None):
        try:
            root_dir = os.path.abspath(base_path) if base_path else self.current_workspace
            if not os.path.isdir(root_dir):
                return {"status": "error", "message": "Directory not found"}

            ignore_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", ".idea", ".vscode", "dist", "build"}
            tree = []

            for entry in sorted(os.scandir(root_dir), key=lambda e: (not e.is_dir(), e.name.lower())):
                if entry.name in ignore_dirs:
                    continue
                item = {
                    "name": entry.name,
                    "path": os.path.abspath(entry.path),
                    "isDir": entry.is_dir(),
                    "size": entry.stat().st_size if not entry.is_dir() else 0
                }
                tree.append(item)
            return {"status": "ok", "files": tree, "current": root_dir}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def read_file(self, file_path):
        try:
            p = os.path.abspath(file_path)
            # prevent reading binary or huge files safely
            if os.path.getsize(p) > 5 * 1024 * 1024:
                return {"status": "error", "message": "File exceeds 5MB limit"}
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return {"status": "ok", "path": p, "content": content}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def write_file(self, file_path, content):
        try:
            p = os.path.abspath(file_path)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(content)
            return {"status": "ok", "path": p}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def create_item(self, target_path, is_dir=False):
        try:
            p = os.path.abspath(target_path)
            if is_dir:
                os.makedirs(p, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                if not os.path.exists(p):
                    with open(p, "w", encoding="utf-8") as f:
                        f.write("")
            return {"status": "ok", "path": p}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def delete_item(self, target_path):
        try:
            p = os.path.abspath(target_path)
            if os.path.isdir(p):
                import shutil
                shutil.rmtree(p)
            elif os.path.isfile(p):
                os.remove(p)
            return {"status": "ok", "path": p}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def rename_item(self, old_path, new_name):
        try:
            src = os.path.abspath(old_path)
            dst = os.path.join(os.path.dirname(src), new_name)
            os.rename(src, dst)
            return {"status": "ok", "newPath": dst}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ================= DAHL API / MODELS =================
    def fetch_dahl_models(self, api_key=None, base_url="https://inference.dahl.global/v1"):
        try:
            key = api_key
            if not key:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    key = json.load(f).get("apiKey", "")

            if not key:
                return {"status": "error", "message": "API Key is required"}

            headers = {
                "Authorization": f"Bearer {key.strip()}",
                "Content-Type": "application/json"
            }
            res = requests.get(f"{base_url.rstrip('/')}/models", headers=headers, timeout=12)
            if res.status_code == 200:
                data = res.json()
                models = [m.get("id") for m in data.get("data", []) if m.get("id")]
                if not models:
                    models = ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "MiniMax-Text-01"]
                return {"status": "ok", "models": models}
            else:
                return {"status": "error", "message": f"Dahl API Error {res.status_code}: {res.text}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ================= TERMINAL COMMAND EXECUTION =================
    def run_command(self, command, cwd=None):
        try:
            work_dir = cwd or self.current_workspace
            result = subprocess.run(
                command,
                shell=True,
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=30
            )
            output = result.stdout
            if result.stderr:
                output += ("\n[STDERR]\n" + result.stderr if output else result.stderr)
            return {
                "status": "ok",
                "exitCode": result.returncode,
                "output": output or "(command finished with no output)"
            }
        except subprocess.TimeoutExpired:
            return {"status": "error", "message": "Command timed out after 30 seconds."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ================= MINI AGENT (OpenCode / Antigravity Style) =================
    def run_agent_turn(self, payload):
        """
        Runs an autonomous coding agent step via Dahl API.
        Payload keys:
          - messages: list of chat turns
          - activeFile: currently open file path or None
          - apiKey: Dahl API key
          - model: selected model id
          - reasoningEffort: low/medium/high
          - baseUrl: optional base url
        """
        try:
            messages = payload.get("messages", [])
            active_file = payload.get("activeFile")
            api_key = payload.get("apiKey", "")
            model = payload.get("model", "deepseek-ai/DeepSeek-V3")
            reasoning_effort = payload.get("reasoningEffort", "medium")
            base_url = payload.get("baseUrl", "https://inference.dahl.global/v1").rstrip("/")

            if not api_key:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    api_key = json.load(f).get("apiKey", "")

            if not api_key:
                return {"status": "error", "message": "Please enter your Dahl API key in Settings."}

            # Build tools definition
            tools = [
                {
                    "type": "function",
                    "function": {
                        "name": "read_file",
                        "description": "Read the contents of a file in the workspace.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "relative_path": {"type": "string", "description": "Relative path to the file from workspace root"}
                            },
                            "required": ["relative_path"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "write_file",
                        "description": "Write or overwrite a file in the workspace with complete contents.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "relative_path": {"type": "string", "description": "Relative path to the file"},
                                "content": {"type": "string", "description": "The exact full text content to write"}
                            },
                            "required": ["relative_path", "content"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "edit_file",
                        "description": "Perform a targeted search and replace edit in a file.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "relative_path": {"type": "string", "description": "Relative path to the file"},
                                "target": {"type": "string", "description": "Exact text to find and replace"},
                                "replacement": {"type": "string", "description": "Replacement text"}
                            },
                            "required": ["relative_path", "target", "replacement"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "list_directory",
                        "description": "List files and folders in a relative workspace directory.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "relative_path": {"type": "string", "description": "Subdirectory to list (default empty for root)", "default": ""}
                            }
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "run_shell",
                        "description": "Run a shell/terminal command in the workspace folder.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "command": {"type": "string", "description": "The command line string to run"}
                            },
                            "required": ["command"]
                        }
                    }
                }
            ]

            # Context prompt
            active_file_info = ""
            if active_file and os.path.exists(active_file):
                try:
                    with open(active_file, "r", encoding="utf-8", errors="replace") as f:
                        file_preview = f.read(4000)
                    active_file_info = f"\nCurrently open file in editor: {os.path.relpath(active_file, self.current_workspace)}\nFile snippet:\n```\n{file_preview}\n```\n"
                except Exception:
                    pass

            system_content = f"{DEFAULT_SYSTEM_PROMPT}\nCurrent Workspace Root: {self.current_workspace}\n{active_file_info}"

            conv_messages = [{"role": "system", "content": system_content}]
            for m in messages:
                conv_messages.append({"role": m["role"], "content": m["content"]})

            headers = {
                "Authorization": f"Bearer {api_key.strip()}",
                "Content-Type": "application/json"
            }

            req_body = {
                "model": model,
                "messages": conv_messages,
                "tools": tools,
                "tool_choice": "auto"
            }

            # If reasoning effort is set and not 'disabled', include reasoning_effort
            if reasoning_effort and reasoning_effort.lower() != "disabled":
                req_body["reasoning_effort"] = reasoning_effort.lower()

            # Execute up to 5 agent autonomous loop iterations if tools are called
            executed_actions = []
            final_content = ""
            reasoning_content = ""

            for step in range(5):
                resp = requests.post(f"{base_url}/chat/completions", headers=headers, json=req_body, timeout=60)
                if resp.status_code != 200:
                    return {
                        "status": "error",
                        "message": f"Dahl API Error {resp.status_code}: {resp.text}"
                    }

                data = resp.json()
                choice = data.get("choices", [{}])[0]
                msg = choice.get("message", {})
                
                # Check for reasoning field (e.g. reasoning_content from DeepSeek R1)
                step_reasoning = msg.get("reasoning_content") or choice.get("reasoning") or ""
                if step_reasoning:
                    reasoning_content += ("\n\n" if reasoning_content else "") + step_reasoning

                content = msg.get("content") or ""
                tool_calls = msg.get("tool_calls", [])

                if not tool_calls:
                    final_content = content
                    break

                # Execute tool calls
                conv_messages.append(msg)
                for tool_call in tool_calls:
                    fn = tool_call.get("function", {})
                    fn_name = fn.get("name")
                    call_id = tool_call.get("id", f"call_{len(executed_actions)}")
                    try:
                        args = json.loads(fn.get("arguments", "{}"))
                    except Exception:
                        args = {}

                    action_record = {"tool": fn_name, "args": args, "output": ""}

                    if fn_name == "read_file":
                        rel = args.get("relative_path", "")
                        abs_p = os.path.normpath(os.path.join(self.current_workspace, rel))
                        r = self.read_file(abs_p)
                        res_str = r.get("content") if r["status"] == "ok" else f"Error: {r.get('message')}"
                        action_record["output"] = res_str[:500] + ("..." if len(res_str) > 500 else "")

                    elif fn_name == "write_file":
                        rel = args.get("relative_path", "")
                        new_code = args.get("content", "")
                        abs_p = os.path.normpath(os.path.join(self.current_workspace, rel))
                        w = self.write_file(abs_p, new_code)
                        res_str = f"File successfully written: {rel}" if w["status"] == "ok" else f"Error: {w.get('message')}"
                        action_record["output"] = res_str

                    elif fn_name == "edit_file":
                        rel = args.get("relative_path", "")
                        target = args.get("target", "")
                        replacement = args.get("replacement", "")
                        abs_p = os.path.normpath(os.path.join(self.current_workspace, rel))
                        r = self.read_file(abs_p)
                        if r["status"] != "ok":
                            res_str = f"Error reading file: {r.get('message')}"
                        else:
                            text = r["content"]
                            if target in text:
                                updated = text.replace(target, replacement, 1)
                                self.write_file(abs_p, updated)
                                res_str = f"Applied edit to {rel}"
                            else:
                                res_str = f"Target block not found in {rel}. Check exact indentation and content."
                        action_record["output"] = res_str

                    elif fn_name == "list_directory":
                        rel = args.get("relative_path", "")
                        abs_p = os.path.normpath(os.path.join(self.current_workspace, rel))
                        lst = self.list_files(abs_p)
                        if lst["status"] == "ok":
                            names = [f"{'[DIR] ' if item['isDir'] else ''}{item['name']}" for item in lst["files"]]
                            res_str = "\n".join(names) or "(empty directory)"
                        else:
                            res_str = f"Error: {lst.get('message')}"
                        action_record["output"] = res_str

                    elif fn_name == "run_shell":
                        cmd = args.get("command", "")
                        run_res = self.run_command(cmd)
                        res_str = run_res.get("output", "")
                        action_record["output"] = res_str

                    else:
                        res_str = f"Unknown tool: {fn_name}"
                        action_record["output"] = res_str

                    executed_actions.append(action_record)
                    conv_messages.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": res_str
                    })

                req_body["messages"] = conv_messages

            return {
                "status": "ok",
                "content": final_content,
                "reasoning": reasoning_content,
                "actions": executed_actions
            }
        except Exception as e:
            traceback.print_exc()
            return {"status": "error", "message": str(e)}
