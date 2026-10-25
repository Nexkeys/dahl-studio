// Global State
let editorInstance = null;
let openTabs = []; // { path, name, language, isDirty, content }
let activeTabPath = null;
let appSettings = {
  apiKey: "",
  baseUrl: "https://inference.dahl.global/v1",
  model: "deepseek-ai/DeepSeek-V3",
  reasoningEffort: "medium"
};
let chatHistory = [];

// DOM Elements
const currentWorkspaceBadge = document.getElementById("currentWorkspaceBadge");
const fileTreeContainer = document.getElementById("fileTreeContainer");
const tabsBar = document.getElementById("tabsBar");
const noFileScreen = document.getElementById("noFileScreen");
const activeFilePath = document.getElementById("activeFilePath");
const editorLanguageLabel = document.getElementById("editorLanguageLabel");
const editorCursorPosition = document.getElementById("editorCursorPosition");
const headerModelLabel = document.getElementById("headerModelLabel");

// Settings Modal Elements
const settingsModal = document.getElementById("settingsModal");
const inputApiKey = document.getElementById("inputApiKey");
const inputBaseUrl = document.getElementById("inputBaseUrl");
const inputModel = document.getElementById("inputModel");
const selectDefaultReasoning = document.getElementById("selectDefaultReasoning");
const reasoningSelect = document.getElementById("reasoningSelect");
const settingsStatusMsg = document.getElementById("settingsStatusMsg");
const modelsDataList = document.getElementById("modelsDataList");

// Terminal Elements
const terminalDrawer = document.getElementById("terminalDrawer");
const terminalOutput = document.getElementById("terminalOutput");
const terminalInput = document.getElementById("terminalInput");

// AI Elements
const chatMessages = document.getElementById("chatMessages");
const aiPromptInput = document.getElementById("aiPromptInput");
const btnSendPrompt = document.getElementById("btnSendPrompt");
const chkIncludeFileContext = document.getElementById("chkIncludeFileContext");

// Wait for PyWebView API ready
window.addEventListener("pywebviewready", async () => {
  await initSettings();
  await initMonaco();
  await refreshWorkspace();
  setupEventListeners();
});

// Fallback if testing in browser without pywebview
setTimeout(() => {
  if (!window.pywebview) {
    console.warn("pywebview API not detected, running in browser preview mode.");
    initMonaco();
    setupEventListeners();
  }
}, 1000);

// ================= INITIALIZATION =================
async function initSettings() {
  if (!window.pywebview) return;
  try {
    const res = await window.pywebview.api.get_settings();
    if (res.status === "ok") {
      appSettings = { ...appSettings, ...res.settings };
      inputApiKey.value = appSettings.apiKey || "";
      inputBaseUrl.value = appSettings.baseUrl || "https://inference.dahl.global/v1";
      inputModel.value = appSettings.model || "deepseek-ai/DeepSeek-V3";
      selectDefaultReasoning.value = appSettings.reasoningEffort || "medium";
      reasoningSelect.value = appSettings.reasoningEffort || "medium";
      updateHeaderModelBadge();

      if (!appSettings.apiKey) {
        // Pop open settings to prompt key
        showSettingsModal();
      }
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}

function updateHeaderModelBadge() {
  const shortModel = appSettings.model.split("/").pop() || appSettings.model;
  headerModelLabel.textContent = shortModel;
}

function initMonaco() {
  return new Promise((resolve) => {
    if (typeof require !== "undefined") {
      require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" } });
      require(["vs/editor/editor.main"], function () {
        editorInstance = monaco.editor.create(document.getElementById("monacoEditorContainer"), {
          value: "",
          language: "plaintext",
          theme: "vs-dark",
          automaticLayout: true,
          fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
          fontSize: 13,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          renderWhitespace: "selection"
        });

        editorInstance.onDidChangeCursorPosition((e) => {
          editorCursorPosition.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
        });

        editorInstance.onDidChangeModelContent(() => {
          if (activeTabPath) {
            const tab = openTabs.find(t => t.path === activeTabPath);
            if (tab && !tab.isDirty) {
              tab.isDirty = true;
              renderTabs();
            }
          }
        });

        resolve();
      });
    } else {
      resolve();
    }
  });
}

// ================= WORKSPACE & FILES =================
async function refreshWorkspace() {
  if (!window.pywebview) return;
  try {
    const info = await window.pywebview.api.get_workspace_info();
    if (info.status === "ok") {
      currentWorkspaceBadge.textContent = info.name;
      currentWorkspaceBadge.title = info.workspace;
    }
    const treeRes = await window.pywebview.api.list_files();
    if (treeRes.status === "ok") {
      renderFileTree(treeRes.files);
    }
  } catch (e) {
    console.error("Error refreshing workspace:", e);
  }
}

function renderFileTree(files) {
  fileTreeContainer.innerHTML = "";
  if (!files || files.length === 0) {
    fileTreeContainer.innerHTML = '<div class="empty-state">Workspace is empty.</div>';
    return;
  }

  files.forEach((file) => {
    const el = document.createElement("div");
    el.className = `tree-item ${activeTabPath === file.path ? "active" : ""}`;
    const icon = file.isDir ? "📁" : getFileIcon(file.name);
    el.innerHTML = `
      <span class="tree-item-icon">${icon}</span>
      <span class="tree-item-name">${escapeHtml(file.name)}</span>
    `;
    if (!file.isDir) {
      el.addEventListener("click", () => openFile(file.path, file.name));
    }
    fileTreeContainer.appendChild(el);
  });
}

function getFileIcon(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const iconMap = {
    js: "🟨", ts: "🔷", py: "🐍", html: "🌐", css: "🎨", json: "📋",
    md: "📝", txt: "📄", rs: "🦀", go: "🐹", c: "⚙️", cpp: "⚙️", sh: "🐚"
  };
  return iconMap[ext] || "📄";
}

function detectLanguage(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const langMap = {
    js: "javascript", ts: "typescript", py: "python", html: "html",
    css: "css", json: "json", md: "markdown", rs: "rust", go: "go",
    c: "c", cpp: "cpp", sh: "shell", bat: "bat", ps1: "powershell",
    sql: "sql", xml: "xml", yaml: "yaml", yml: "yaml"
  };
  return langMap[ext] || "plaintext";
}

// Open File in Monaco
async function openFile(filePath, fileName) {
  let existingTab = openTabs.find(t => t.path === filePath);
  if (!existingTab) {
    if (!window.pywebview) return;
    const res = await window.pywebview.api.read_file(filePath);
    if (res.status !== "ok") {
      alert("Error reading file: " + res.message);
      return;
    }
    const lang = detectLanguage(fileName);
    existingTab = {
      path: filePath,
      name: fileName,
      language: lang,
      content: res.content,
      isDirty: false
    };
    openTabs.push(existingTab);
  }

  switchTab(existingTab.path);
}

function switchTab(path) {
  activeTabPath = path;
  const tab = openTabs.find(t => t.path === path);
  if (!tab) return;

  noFileScreen.style.display = "none";
  activeFilePath.textContent = tab.name;
  editorLanguageLabel.textContent = tab.language.toUpperCase();

  if (editorInstance) {
    const currentModel = editorInstance.getModel();
    if (currentModel) {
      monaco.editor.setModelLanguage(currentModel, tab.language);
      editorInstance.setValue(tab.content);
    }
  }

  renderTabs();
  renderFileTreeSelection();
}

function renderTabs() {
  tabsBar.innerHTML = "";
  openTabs.forEach(tab => {
    const tabEl = document.createElement("div");
    tabEl.className = `tab ${tab.path === activeTabPath ? "active" : ""}`;
    tabEl.innerHTML = `
      <span>${escapeHtml(tab.name)}${tab.isDirty ? " •" : ""}</span>
      <span class="tab-close" title="Close">✕</span>
    `;
    tabEl.addEventListener("click", (e) => {
      if (e.target.classList.contains("tab-close")) {
        closeTab(tab.path);
      } else {
        switchTab(tab.path);
      }
    });
    tabsBar.appendChild(tabEl);
  });
}

function closeTab(path) {
  openTabs = openTabs.filter(t => t.path !== path);
  if (activeTabPath === path) {
    if (openTabs.length > 0) {
      switchTab(openTabs[openTabs.length - 1].path);
    } else {
      activeTabPath = null;
      noFileScreen.style.display = "flex";
      activeFilePath.textContent = "Ready";
      if (editorInstance) editorInstance.setValue("");
    }
  }
  renderTabs();
  renderFileTreeSelection();
}

function renderFileTreeSelection() {
  document.querySelectorAll(".tree-item").forEach(item => {
    item.classList.remove("active");
  });
  if (activeTabPath) {
    document.querySelectorAll(".tree-item").forEach(item => {
      if (item.textContent.trim().includes(activeTabPath.split(/[/\\]/).pop())) {
        item.classList.add("active");
      }
    });
  }
}

// Save active file
async function saveActiveFile() {
  if (!activeTabPath || !editorInstance || !window.pywebview) return;
  const content = editorInstance.getValue();
  const res = await window.pywebview.api.write_file(activeTabPath, content);
  if (res.status === "ok") {
    const tab = openTabs.find(t => t.path === activeTabPath);
    if (tab) {
      tab.content = content;
      tab.isDirty = false;
      renderTabs();
    }
    showToast("File saved successfully!");
  } else {
    alert("Failed to save: " + res.message);
  }
}

// ================= MINI AI AGENT =================
async function sendAgentMessage(userText = null) {
  const text = (userText || aiPromptInput.value).trim();
  if (!text) return;
  aiPromptInput.value = "";

  // Add User Message to Chat
  appendChatMessage("user", text);

  // Show Assistant Thinking state
  const assistantBubble = appendChatMessage("assistant", "Thinking & inspecting workspace...", true);

  try {
    const payload = {
      messages: chatHistory.slice(-8), // last turns context
      activeFile: chkIncludeFileContext.checked ? activeTabPath : null,
      apiKey: appSettings.apiKey,
      model: appSettings.model,
      reasoningEffort: reasoningSelect.value,
      baseUrl: appSettings.baseUrl
    };

    const res = await window.pywebview.api.run_agent_turn(payload);

    if (res.status === "ok") {
      updateAssistantMessage(assistantBubble, res.content, res.reasoning, res.actions);
      chatHistory.push({ role: "assistant", content: res.content });

      // If files were edited or written, refresh tree and active tab
      if (res.actions && res.actions.some(a => a.tool === "write_file" || a.tool === "edit_file")) {
        await refreshWorkspace();
        if (activeTabPath) {
          const fileRes = await window.pywebview.api.read_file(activeTabPath);
          if (fileRes.status === "ok") {
            const tab = openTabs.find(t => t.path === activeTabPath);
            if (tab) {
              tab.content = fileRes.content;
              tab.isDirty = false;
              if (editorInstance) editorInstance.setValue(fileRes.content);
            }
          }
        }
      }
    } else {
      assistantBubble.querySelector(".msg-content").innerHTML = `<p style="color: #ef4444;">⚠️ <strong>Dahl API Error:</strong> ${escapeHtml(res.message)}</p>`;
    }
  } catch (err) {
    assistantBubble.querySelector(".msg-content").innerHTML = `<p style="color: #ef4444;">⚠️ <strong>Client Error:</strong> ${escapeHtml(String(err))}</p>`;
  }
}

function appendChatMessage(role, content, isThinking = false) {
  chatHistory.push({ role, content });

  const msgDiv = document.createElement("div");
  msgDiv.className = `chat-msg ${role}`;
  msgDiv.innerHTML = `
    <div class="msg-avatar">${role === "user" ? "👤" : "🤖"}</div>
    <div class="msg-content ${isThinking ? 'thinking' : ''}">
      ${role === "user" ? escapeHtml(content) : (typeof marked !== "undefined" ? marked.parse(content) : escapeHtml(content))}
    </div>
  `;
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return msgDiv;
}

function updateAssistantMessage(bubbleElement, content, reasoning, actions) {
  const contentDiv = bubbleElement.querySelector(".msg-content");
  contentDiv.classList.remove("thinking");
  contentDiv.innerHTML = "";

  // 1. Collapsible Reasoning Box (if model returned reasoning content)
  if (reasoning && reasoning.trim()) {
    const reasoningBox = document.createElement("details");
    reasoningBox.className = "reasoning-box";
    reasoningBox.innerHTML = `
      <summary class="reasoning-header">💭 Thinking Process (${reasoningSelect.value} reasoning)</summary>
      <div class="reasoning-body">${escapeHtml(reasoning)}</div>
    `;
    contentDiv.appendChild(reasoningBox);
  }

  // 2. Executed Tools Cards
  if (actions && actions.length > 0) {
    actions.forEach(act => {
      const toolBox = document.createElement("div");
      toolBox.className = "tool-box";
      const toolIcon = act.tool === "read_file" ? "📖" : (act.tool === "write_file" ? "✍️" : (act.tool === "run_shell" ? "⚡" : "🛠️"));
      toolBox.innerHTML = `
        <div class="tool-header">${toolIcon} <span>${escapeHtml(act.tool)}</span></div>
        <div class="tool-output">${escapeHtml(act.output)}</div>
      `;
      contentDiv.appendChild(toolBox);
    });
  }

  // 3. Final Formatted Answer
  const answerDiv = document.createElement("div");
  answerDiv.className = "markdown-body";
  answerDiv.innerHTML = typeof marked !== "undefined" ? marked.parse(content || "(actions executed)") : escapeHtml(content);
  contentDiv.appendChild(answerDiv);

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ================= TERMINAL =================
async function executeTerminalCommand() {
  const cmd = terminalInput.value.trim();
  if (!cmd || !window.pywebview) return;
  terminalInput.value = "";

  terminalOutput.textContent += `\n$ ${cmd}\n`;
  terminalOutput.scrollTop = terminalOutput.scrollHeight;

  const res = await window.pywebview.api.run_command(cmd);
  if (res.status === "ok") {
    terminalOutput.textContent += `${res.output}\n`;
  } else {
    terminalOutput.textContent += `[Error]: ${res.message}\n`;
  }
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// ================= SETTINGS MODAL =================
function showSettingsModal() {
  settingsModal.classList.remove("hidden");
  settingsStatusMsg.textContent = "";
}

function hideSettingsModal() {
  settingsModal.classList.add("hidden");
}

async function saveSettingsFromModal() {
  const newKey = inputApiKey.value.trim();
  const newBaseUrl = inputBaseUrl.value.trim();
  const newModel = inputModel.value.trim();
  const newReasoning = selectDefaultReasoning.value;

  appSettings.apiKey = newKey;
  appSettings.baseUrl = newBaseUrl;
  appSettings.model = newModel;
  appSettings.reasoningEffort = newReasoning;
  reasoningSelect.value = newReasoning;

  updateHeaderModelBadge();

  if (window.pywebview) {
    const res = await window.pywebview.api.save_settings(appSettings);
    if (res.status === "ok") {
      settingsStatusMsg.className = "status-msg ok";
      settingsStatusMsg.textContent = "Settings saved successfully!";
      setTimeout(hideSettingsModal, 700);
    } else {
      settingsStatusMsg.className = "status-msg err";
      settingsStatusMsg.textContent = res.message;
    }
  } else {
    hideSettingsModal();
  }
}

async function fetchLiveModels() {
  if (!window.pywebview) return;
  settingsStatusMsg.className = "status-msg";
  settingsStatusMsg.textContent = "Connecting to Dahl API...";

  const key = inputApiKey.value.trim();
  const base = inputBaseUrl.value.trim();

  const res = await window.pywebview.api.fetch_dahl_models(key, base);
  if (res.status === "ok") {
    modelsDataList.innerHTML = "";
    res.models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      modelsDataList.appendChild(opt);
    });
    settingsStatusMsg.className = "status-msg ok";
    settingsStatusMsg.textContent = `Retrieved ${res.models.length} models from Dahl!`;
  } else {
    settingsStatusMsg.className = "status-msg err";
    settingsStatusMsg.textContent = res.message;
  }
}

// ================= EVENT LISTENERS =================
function setupEventListeners() {
  // Folder Picker
  document.getElementById("btnOpenFolder").addEventListener("click", async () => {
    if (!window.pywebview) return;
    const res = await window.pywebview.api.select_folder();
    if (res.status === "ok") {
      await refreshWorkspace();
    }
  });

  // Save File
  document.getElementById("btnSaveFile").addEventListener("click", saveActiveFile);
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveActiveFile();
    }
  });

  // New File
  document.getElementById("btnNewFile").addEventListener("click", async () => {
    const name = prompt("Enter new file name (e.g. main.py or index.html):");
    if (!name || !window.pywebview) return;
    const info = await window.pywebview.api.get_workspace_info();
    const fullPath = info.workspace + "\\" + name;
    const res = await window.pywebview.api.create_item(fullPath, false);
    if (res.status === "ok") {
      await refreshWorkspace();
      openFile(fullPath, name);
    }
  });

  // Refresh Files
  document.getElementById("btnRefreshFiles").addEventListener("click", refreshWorkspace);

  // Settings
  document.getElementById("btnOpenSettings").addEventListener("click", showSettingsModal);
  document.getElementById("btnCloseSettings").addEventListener("click", hideSettingsModal);
  document.getElementById("btnCancelSettings").addEventListener("click", hideSettingsModal);
  document.getElementById("btnSaveSettings").addEventListener("click", saveSettingsFromModal);
  document.getElementById("btnFetchModels").addEventListener("click", fetchLiveModels);

  document.getElementById("btnToggleApiKey").addEventListener("click", () => {
    inputApiKey.type = inputApiKey.type === "password" ? "text" : "password";
    document.getElementById("btnToggleApiKey").textContent = inputApiKey.type === "password" ? "Show" : "Hide";
  });

  // Terminal Toggle
  const toggleTerminal = () => terminalDrawer.classList.toggle("hidden");
  document.getElementById("btnToggleTerminal").addEventListener("click", toggleTerminal);
  document.getElementById("btnCloseTerminal").addEventListener("click", toggleTerminal);
  document.getElementById("btnRunCommand").addEventListener("click", executeTerminalCommand);
  terminalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") executeTerminalCommand();
  });

  // AI Chat
  btnSendPrompt.addEventListener("click", () => sendAgentMessage());
  aiPromptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAgentMessage();
    }
  });

  // Prompt Chips
  document.querySelectorAll(".prompt-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const p = chip.getAttribute("data-prompt");
      sendAgentMessage(p);
    });
  });

  // Clear Chat
  document.getElementById("btnClearChat").addEventListener("click", () => {
    chatHistory = [];
    chatMessages.innerHTML = `
      <div class="chat-msg assistant">
        <div class="msg-avatar">🤖</div>
        <div class="msg-content"><p>Chat history cleared. How can I help you in your workspace?</p></div>
      </div>
    `;
  });
}

// Helpers
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(msg) {
  const t = document.createElement("div");
  t.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#10b981;color:#052e16;padding:8px 16px;border-radius:6px;font-weight:600;font-size:12px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
