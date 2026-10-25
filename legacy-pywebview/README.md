# Dahl Studio - AI Code Editor 🚀

A fast, lightweight, standalone code editor with an integrated autonomous AI agent powered by Dahl Inference (`https://inference.dahl.global`).

---

## ⚡ Quick Start
1. Double-click `DahlStudio.exe` to launch the app.
2. In the top-right corner, click **Settings** (or it will prompt on initial launch).
3. Paste your **Dahl API Key** from [inference.dahl.global](https://inference.dahl.global).
4. Click **Fetch Live Models** to pick from available models (e.g. `deepseek-ai/DeepSeek-V3`, `deepseek-ai/DeepSeek-R1`, `MiniMax-Text-01`, etc.), or type your own.
5. Click **Open Folder** in the top bar to open any local folder and start coding!

---

## ✨ Features
- **Monaco Code Editor**: Real VS Code editor engine with syntax highlighting for 50+ programming languages, tabs, minimap, line numbers, and find/replace.
- **Autonomous Dahl AI Agent**:
  - Direct file inspection (`read_file`)
  - Direct file creation & editing (`write_file`, `edit_file`)
  - Directory listing (`list_directory`)
  - Shell command execution (`run_shell`)
- **Reasoning Control**: Dropdown to toggle reasoning effort (`Disabled`, `Low`, `Medium`, `High`) with collapsible thought-process viewing.
- **Integrated Terminal**: Run shell commands directly in your workspace.
- **Keyboard Shortcuts**:
  - `Ctrl + S`: Save active file
  - `Enter`: Send message to AI (or `Shift + Enter` for new lines)
