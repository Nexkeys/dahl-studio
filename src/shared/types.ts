// Shared types between main, preload and renderer. No runtime imports here.

export type ProviderId = 'dahl' | 'openai' | 'anthropic' | 'gemini' | 'nvidia' | 'groq' | 'openrouter' | 'ollama' | 'lmstudio'
/** Secret slots: two Dahl keys plus one key per additional provider (Ollama and LM Studio are local and need none). */
export type KeySlot = 'primary' | 'secondary' | 'openai' | 'anthropic' | 'gemini' | 'nvidia' | 'groq' | 'openrouter'
export type AgentMode = 'plan' | 'review' | 'build'
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'
export type ThemeId =
  | 'dahl-classic' | 'hacker-mode' | 'baddie-mode' | 'vibe-coder' | 'pen-tester'
  | 'midnight-terminal' | 'sakura-flow' | 'arctic-focus' | 'forest-syntax' | 'solar-flare'
  | 'blueprint' | 'ink-paper'

export const PROVIDER_OF_SLOT: Record<KeySlot, ProviderId> = {
  primary: 'dahl', secondary: 'dahl', openai: 'openai', anthropic: 'anthropic', gemini: 'gemini', nvidia: 'nvidia', groq: 'groq', openrouter: 'openrouter'
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
  /** why the last failed request failed: error kind and a short message (the usage log keeps one per request) */
  lastError?: string
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
  /** "Never ask": file changes, commands, connector tools and git run without approval cards, in every mode */
  autoApproveAll: boolean
  /** with autoApproveAll on, still ask before pushing to GitHub, pull requests and releases */
  askBeforePublishing: boolean
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
  /** last app version whose What's New the user has seen; null on a fresh install, '0.0.0' for installs older than 0.3.7 */
  lastSeenVersion: string | null
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
  /** the model's own reasoning for this reply; sent back only to families that need it (agent/modelProfile.ts) */
  thought?: string
  /** DeepSeek / Kimi thinking: reasoning sent back on the wire during a tool loop (set by withReplay, never stored) */
  reasoning_content?: string
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
  /** a model call is being retried: drop the partly streamed reply on screen (it is not part of the conversation) */
  resetLive?: boolean
  /** user messages sent while the agent was working: the id the composer gave it, so its pending chip can be cleared */
  steerId?: string
  /** assistant replies: how fast the model answered (time to first token, generation speed), shown under the reply */
  stats?: { ttftMs: number; tokensPerSec: number; tokens: number; estimated: boolean; model: string }
}

/** A multiple-choice question the agent asks with ask_user (the user can always type their own answer). */
export interface AskQuestion {
  question: string
  /** short chip label, a few words */
  header?: string
  options: { label: string; description?: string }[]
  multiSelect?: boolean
}

export interface PendingApproval {
  id: string
  runId: string
  project: string
  kind: 'write' | 'command' | 'mcp' | 'push' | 'question' | 'github'
  /** kind 'question': what the agent asks; the answers come back as JSON in the approval feedback */
  questions?: AskQuestion[]
  agent?: string
  /** kind 'push': what will be published (always asked, regardless of auto-approve settings) */
  push?: { remote: string; branch: string; target: string; commits: number; commitMessage?: string; pending: number; auth: string }
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
  /** MCP focus of the current turn (see StartRunRequest.mcpServers); kept when a paused turn continues */
  mcpServers?: string[] | 'all'
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
  /** MCP slash command: server ids to load (only these, with a focus line), or 'all' for /mcp */
  mcpServers?: string[] | 'all'
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

/** One connector tool as the agent sees it (fnName is what the model calls). */
export interface McpToolRef {
  serverId: string
  serverName: string
  policy: 'ask' | 'readonly' | 'allow'
  tool: { name: string; description?: string; inputSchema?: unknown; readOnly?: boolean }
  fnName: string
}

/** An enabled connector and whether its tools can be used right now. */
export interface McpConnectorInfo {
  id: string
  name: string
  description: string
  state: 'ready' | 'starting' | 'needs_setup' | 'failed'
  tools: number
  error?: string
}

export interface McpStatus {
  id: string
  state: 'stopped' | 'starting' | 'connected' | 'error'
  error?: string
  tools: McpTool[]
  pid?: number
  startedAt?: string
}

// ---------------- Cost awareness: prices, budgets, quality presets, per-role models ----------------
// Interfaces below that reuse a name from above (Settings, KeyUsageLocal, TurnSummary, RunState, TranscriptItem) are
// TypeScript interface merges: they add fields to those interfaces without touching their definitions.

export type QualityPreset = 'economy' | 'balanced' | 'best'
/** Roles that can use a model other than the main one ("same as main" when unset). */
export type ModelRole = 'research' | 'helpers' | 'checker' | 'image' | 'autocomplete'

/** Money and tokens for a set of model requests. usd covers only requests with a known price. */
export interface CostTally {
  usd: number
  requests: number
  /** requests whose price is unknown (not included in usd) */
  unknown: number
  /** part of usd comes from the dated price table (an estimate), not from a cost the provider reported */
  estimated: boolean
  inputTokens: number
  outputTokens: number
  /** input tokens read from the provider's prompt cache */
  cachedTokens: number
  /** input tokens written to the provider's prompt cache */
  cacheWriteTokens: number
}

/** One day's spend (local date) by provider, for the status bar and Settings > Usage. */
export interface CostDay {
  date: string
  total: CostTally
  byProvider: Record<string, CostTally>
}

/** One row of the price list, as shown in Settings (USD per 1M tokens). */
export interface PriceRow {
  provider: string
  model: string
  input: number
  output: number
  cached?: number
  cacheWrite?: number
  /** higher prices for long prompts, e.g. "over 200,000 input tokens: $4 in, $18 out" */
  tier?: string
  /** e.g. "until 2026-11-30" */
  period?: string
  source: string
  checked: string
  note?: string
}

export interface Settings {
  /** Economy / Balanced / Best: picks the thinking level, role models, helper count and image use */
  qualityPreset: QualityPreset
  /** model key per role; missing or null = same as the main model */
  roleModels: Partial<Record<ModelRole, string | null>>
  /** pause a task when one request (with its helpers) would cost more than this, USD; null = no limit */
  budgetTaskUsd: number | null
  /** pause tasks when today's total would go over this, USD; null = no limit */
  budgetDayUsd: number | null
  /** show a note before a model call with more input tokens than this */
  warnInputTokens: number
  /** show a note before a model call carrying more images than this */
  warnImages: number
  /** show a note when more helper agents than this would run at once */
  warnHelpers: number
  /** ask before those expensive steps instead of only noting them */
  confirmExpensive: boolean
}

export interface KeyUsageLocal {
  cachedTokens?: number
  cacheWriteTokens?: number
  /** cost of the request in USD when known (provider-reported or from the price table) */
  costUsd?: number
  /** costUsd was reported by the provider (exact) rather than computed from the price table */
  costExact?: boolean
}

export interface TurnSummary {
  /** this request (lead and helpers) */
  cost?: CostTally
  /** the whole chat so far, including this request */
  chatCost?: CostTally
}

export interface RunState {
  /** everything this chat has spent */
  cost?: CostTally
}

export interface TranscriptItem {
  /** a status note that must stay visible (not folded into the activity list): cost warnings, budget stops */
  notice?: 'cost' | 'budget'
}

// ---------------- Tab completions (grey ghost text in the editor) ----------------
// The two settings fields are merged into Settings here (interface merging), so they stay in this block.
export interface Settings {
  /** Tab completions on or off. Unset counts as off: nothing is sent until a completion model is chosen. */
  tabCompletions?: boolean
  /** model key ("<provider id>:<model id>") used for Tab completions; null or unset = none chosen */
  completionModel?: string | null
}

export interface CompletionRequest {
  /** renderer sequence number; completion:cancel uses it */
  id: number
  /** file path relative to the project root (shown to the model as the file name) */
  path: string
  /** Monaco language id */
  language: string
  /** text before and after the cursor (the main process trims both to its prompt budget) */
  prefix: string
  suffix: string
  /** a few lines from other open tabs, as extra context */
  related?: { path: string; text: string }[]
  /** asked for by the user (Alt+\, "Trigger Inline Suggestion") rather than by typing: skips the cache and the rate limit */
  explicit?: boolean
}

export interface CompletionResponse {
  /** the suggestion; missing or empty = nothing to show */
  text?: string
  cached?: boolean
  ms?: number
  /** why no model call was made */
  skipped?: 'off' | 'no_model' | 'cancelled' | 'rate_limited' | 'paused'
  /** the model call failed (shown by the status bar indicator) */
  error?: string
}

// ---------------- Providers: Groq, OpenRouter, local models, capabilities (0.4.0) ----------------
// ModelInfo and Settings below extend the interfaces above (TypeScript interface merging), so this block stays additive.

export type LocalProviderId = 'ollama' | 'lmstudio'

/** One normalised capability record per model, filled by every provider's discovery. undefined = not reported. */
export interface ModelCaps {
  tools: boolean
  vision: boolean
  reasoning: boolean
  contextTokens?: number
  /** OpenRouter ":free" variants or zero prompt and completion pricing */
  free: boolean
  /** runs on this PC (Ollama, LM Studio) */
  local: boolean
}

export interface ModelInfo {
  /** native tool calling (function calling) */
  tools?: boolean
  /** a reasoning / thinking model (shown as a badge; `thinking` says whether a parameter controls it) */
  reasoning?: boolean
  free?: boolean
  local?: boolean
}

export interface Settings {
  /** base URLs of local model servers (defaults: Ollama http://localhost:11434, LM Studio http://localhost:1234) */
  localUrls?: Partial<Record<LocalProviderId, string>>
  /** model keys picked most recently, newest first (shown at the top of the model menu) */
  recentModels?: string[]
}

/** Whether a local model server answered on the last check, and what it offers. */
export interface LocalProviderStatus {
  provider: LocalProviderId
  baseUrl: string
  running: boolean
  models: number
  checkedAt: string
  error?: string
  /** LM Studio: the smallest loaded context length when it is too small for agent prompts */
  smallContext?: number
}
