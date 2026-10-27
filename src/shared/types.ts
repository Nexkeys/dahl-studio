// Shared types between main, preload and renderer. No runtime imports here.

export type ProviderId = 'dahl' | 'openai' | 'anthropic' | 'gemini' | 'nvidia'
/** Secret slots: two Dahl keys plus one key per additional provider. */
export type KeySlot = 'primary' | 'secondary' | 'openai' | 'anthropic' | 'gemini' | 'nvidia'
export type AgentMode = 'plan' | 'review' | 'build'
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'
export type ThemeId =
  | 'dahl-classic' | 'hacker-mode' | 'baddie-mode' | 'vibe-coder' | 'pen-tester'
  | 'midnight-terminal' | 'sakura-flow' | 'arctic-focus' | 'forest-syntax' | 'solar-flare'

export const PROVIDER_OF_SLOT: Record<KeySlot, ProviderId> = {
  primary: 'dahl', secondary: 'dahl', openai: 'openai', anthropic: 'anthropic', gemini: 'gemini', nvidia: 'nvidia'
}

export interface KeyInfo {
  slot: KeySlot
  provider: ProviderId
  name: string
  configured: boolean
  health: 'unknown' | 'ok' | 'auth_failed' | 'exhausted' | 'rate_limited' | 'error'
  lastError?: string
  lastCheckedAt?: string
}

export interface KeyUsageLocal {
  requests: number
  errors: number
  promptTokens: number
  completionTokens: number
  /** true when any of the token counts came from local estimation instead of an API usage field */
  estimated: boolean
  lastUsedAt?: string
  lastModel?: string
  lastLatencyMs?: number
}

export interface KeyTestResult {
  slot: KeySlot
  ok: boolean
  httpStatus?: number
  /** human summary, e.g. "12,000,000 tokens remaining on this key" or "41 models available" */
  summary?: string
  /** numeric remaining tokens when the provider reports it (Dahl GET /tokens/current) */
  remainingTokens?: number | null
  raw?: unknown
  error?: string
}

export interface ModelInfo {
  /** namespaced id used everywhere in the app: "<provider>:<model id>" */
  key: string
  provider: ProviderId
  id: string
  label: string
  vision: boolean
  /** 'native' = provider has a documented reasoning parameter; 'app' = Dahl Studio applies app-level thinking guidance */
  thinking: 'native' | 'app'
  contextTokens?: number
  firstSeenAt: string
  isNew?: boolean
  maxOutputTokens?: number
  /** Anthropic: supported thinking types from the models list capabilities */
  thinkingTypes?: string[]
}

export type EffectsMode = 'auto' | 'full' | 'reduced'

export interface Settings {
  theme: ThemeId
  defaultModel: string | null
  thinking: ThinkingLevel
  preferredKey: 'primary' | 'secondary'
  keyNames: Record<KeySlot, string>
  autoApproveWrites: boolean
  autoApproveCommands: boolean
  autoMemory: boolean
  /** keep an app-maintained PROGRESS.md work log in the project root */
  maintainProgress: boolean
  /** Windows notifications for approvals, finished/failed/paused tasks (only when the window is not focused) */
  notifications: boolean
  /** 'auto' turns off backdrop blur and animated theme layers on low-end hardware (see themes.ts detectLowEnd) */
  effects: EffectsMode
  webResearch: boolean
  openProjects: string[]
  activeProject: string | null
  /** project root -> reasoning profile id (overrides the global active profile) */
  projectReasoning: Record<string, string>
}

export interface TreeNode {
  name: string
  path: string // relative to project root, forward slashes
  dir: boolean
  children?: TreeNode[]
}

export interface PlanStep {
  title: string
  status: 'pending' | 'in_progress' | 'done' | 'failed'
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string } // base64, no data: prefix

export interface ChatMessage {
  role: ChatRole
  content: string | ContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
  /** provider-specific blocks that must be replayed verbatim (Anthropic thinking signatures) */
  providerBlocks?: unknown[]
}

export interface Attachment {
  id: string
  kind: 'file' | 'folder' | 'image' | 'selection' | 'text'
  name: string
  /** text content (file / folder digest / selection) */
  text?: string
  /** image data */
  mediaType?: string
  data?: string
  bytes?: number
}

export interface TurnSummary {
  changedFiles: string[]
  commands: { command: string; exitCode: number | null }[]
  toolCount: number
  durationMs: number
  memoriesSaved: number
  revertable: boolean
}

/** A UI-facing transcript entry (richer than raw API messages). */
export interface TranscriptItem {
  id: string
  kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'approval' | 'error' | 'status' | 'summary' | 'agents'
  text: string
  at: string
  tool?: { name: string; args: string; result?: string; ok?: boolean; agent?: string }
  approvalId?: string
  attachments?: { kind: Attachment['kind']; name: string }[]
  summary?: TurnSummary
  agentIds?: string[]
}

export interface PendingApproval {
  id: string
  runId: string
  project: string
  kind: 'write' | 'command' | 'mcp'
  agent?: string
  path?: string
  before?: string
  after?: string
  command?: string
  tool?: string
  args?: string
  reason?: string
}

export type RunStatus = 'running' | 'paused' | 'waiting_approval' | 'completed' | 'cancelled' | 'failed' | 'interrupted'

export interface RunState {
  id: string
  project: string
  objective: string
  mode: AgentMode
  model: string
  thinking: ThinkingLevel
  status: RunStatus
  createdAt: string
  updatedAt: string
  plan: PlanStep[]
  changedFiles: string[]
  commandsRun: { command: string; exitCode: number | null }[]
  /** original content of files before the agent first changed them in a turn (null = file did not exist) */
  backups: Record<string, string | null>
  messages: ChatMessage[]
  transcript: TranscriptItem[]
  lastError?: string
  iterations: number
  agents?: AgentInfo[]
  log?: { at: string; level: 'info' | 'error'; text: string }[]
}

export interface RunSummary {
  id: string
  project: string
  objective: string
  status: RunStatus
  updatedAt: string
  mode: AgentMode
  changedFiles: string[]
}

export interface MemoryEntry {
  id: string
  text: string
  tags: string[]
  source: string
  createdAt: string
}

export type AgentRole = 'lead' | 'architect' | 'implementer' | 'debugger' | 'test_engineer' | 'code_reviewer' | 'security_reviewer' | 'researcher'

export interface AgentInfo {
  id: string
  runId: string
  project: string
  role: AgentRole
  name: string
  task: string
  status: 'thinking' | 'tool' | 'waiting_approval' | 'done' | 'failed' | 'cancelled'
  step: string
  toolCount: number
  startedAt: string
  endedAt?: string
  report?: string
  files: string[]
}

export interface AgentEvent {
  runId: string
  project: string
  type: 'transcript' | 'delta' | 'reasoning_delta' | 'status' | 'plan' | 'approval' | 'run' | 'agent'
  item?: TranscriptItem
  delta?: string
  status?: RunStatus
  plan?: PlanStep[]
  approval?: PendingApproval
  run?: RunSummary
  agent?: AgentInfo
}

export interface TermEvent {
  id: string
  type: 'out' | 'err' | 'exit'
  data?: string
  code?: number | null
}

export interface StorageReport {
  appDataDir: string
  items: { label: string; path: string; bytes: number }[]
}

export interface StartRunRequest {
  project: string
  prompt: string
  mode: AgentMode
  model: string
  thinking?: ThinkingLevel
  web?: boolean
  attachments?: Attachment[]
  resumeRunId?: string
}

export interface ReasoningProfile {
  id: string
  name: string
  description: string
  prompt: string
  builtin: boolean
}

export interface ReasoningState {
  activeId: string
  profiles: ReasoningProfile[]
}

// ---------------- MCP ----------------
export type McpClassification =
  | 'included_local' | 'optional_local' | 'free_online' | 'external_account' | 'paid' | 'unverified'

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'http'
  /** stdio: command and args. "${project}" is replaced with the active project root; "${bundled:<name>}" with a bundled server entry */
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  /** ask = every call needs approval; readonly = auto-allow tools annotated readOnlyHint; allow = never ask */
  policy: 'ask' | 'readonly' | 'allow'
  catalogId?: string
  custom: boolean
}

export interface McpCatalogEntry {
  id: string
  name: string
  publisher: string
  description: string
  whenUsed: string[]
  exampleTasks: string[]
  runsWhere: 'local' | 'remote'
  needsInternet: string
  requirements: string
  needsAccount: string
  license: string
  source: string
  runtime: string
  version: string
  permissions: string[]
  access: string
  dataLeaves: string
  risks: string[]
  classification: McpClassification
  risk: 'low' | 'medium' | 'high'
  install: Omit<McpServerConfig, 'id' | 'enabled' | 'policy' | 'custom'> | null
  capabilityTest?: { tool: string; args: Record<string, unknown>; expect: string }
  verified?: { at: string; result: string }
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: unknown
  readOnly?: boolean
  destructive?: boolean
}

export interface McpStatus {
  id: string
  state: 'stopped' | 'starting' | 'connected' | 'error'
  error?: string
  tools: McpTool[]
  pid?: number
  startedAt?: string
}
