import type { McpCatalogEntry, McpServerConfig } from '@shared/types'

/**
 * Catalogue entries added in 0.4.0: Sekudo, REA and the mobile connectors. Package names and versions were checked
 * with `npm view` on 2026-11-07 (sekudo-mcp 0.1.0, rea-agents 6.8.0, @mobilenext/mobile-mcp 1.0.16); commands come
 * from each project's own docs. Prerequisite checks live in prereqs.ts.
 */
export const EXTRA_CATALOG: McpCatalogEntry[] = [
  {
    id: 'sekudo',
    name: 'Sekudo',
    publisher: 'Nexkeys',
    description: 'Scope-gated web security scanner (DAST): 34 OWASP-mapped checks with benign proof-of-concept. It only scans hosts on the allow-list you authorised (SEKUDO_TARGETS) and refuses everything else.',
    whenUsed: ['Security-testing a web app you own, for example your local dev server', 'Checking whether a host is in scope before a scan'],
    exampleTasks: ['Check if localhost:3000 is in scope, then run a sekudo scan and summarise the criticals', 'Run only the injection and auth checks against staging.myapp.com'],
    runsWhere: 'local',
    needsInternet: 'Only for the targets you authorise (and the first npm download)',
    requirements: 'Node.js with npx. SEKUDO_AUTHORIZED=true (your statement that you may test the targets) and SEKUDO_TARGETS (comma-separated hosts, *.suffix or IPv4 CIDR).',
    needsAccount: 'No account, no API key, free',
    license: 'MIT',
    source: 'https://www.npmjs.com/package/sekudo-mcp',
    runtime: 'Node.js via npx',
    version: '0.1.0',
    permissions: ['Send attack-style HTTP requests to allow-listed targets', 'Write scan reports (Markdown and JSON) to its reports folder'],
    access: 'Only the hosts in SEKUDO_TARGETS',
    dataLeaves: 'Scan traffic goes to your allow-listed targets; findings go to the AI model',
    risks: ['Active exploitation checks: only list systems you own or are authorised to test', 'Scans run without asking per call once it is set up (your choice); narrow SEKUDO_TARGETS to what you mean to test'],
    classification: 'optional_local',
    risk: 'high',
    install: { name: 'Sekudo', transport: 'stdio', command: 'npx', args: ['-y', 'sekudo-mcp@0.1.0'], env: { SEKUDO_AUTHORIZED: '', SEKUDO_TARGETS: '' }, catalogId: 'sekudo' },
    capabilityTest: { tool: 'list_checks', args: {}, expect: '' }
  },
  {
    id: 'rea',
    name: 'REA',
    publisher: 'morluto (Reverse Engineer Anything)',
    description: 'Reverse engineering across native binaries, JavaScript and Electron apps, .NET assemblies, Android APKs and websites, with evidence for every finding. Native analysis needs Hopper, Ghidra, IDA or Kuna installed.',
    whenUsed: ['Understanding how a compiled program, Electron app or APK works', 'Comparing two versions of an app', 'Tracing a feature or IPC call through a bundled app'],
    exampleTasks: ['Analyse the Electron app in C:\\Apps\\Foo and list its IPC channels', 'Open this .exe in Ghidra and explain what the function at 0x401000 does'],
    runsWhere: 'local',
    needsInternet: 'Only for the first npm download and websites you ask it to inspect',
    requirements: 'Node.js 22.23.4+, 24.22.1+ or 26.12.1+ with npx. Native binaries: Hopper, Ghidra, IDA or Kuna. APK decompiling: JADX and a JDK. Websites: a Chrome-family browser.',
    needsAccount: 'No account, free (commercial engines such as IDA Pro need your own licence)',
    license: 'MIT',
    source: 'https://github.com/morluto/rea',
    runtime: 'Node.js via npx',
    version: '6.8.0',
    permissions: ['Read the files you point it at', 'Run analysis engines (Ghidra, Hopper, IDA)', 'Runtime capture can run the target program'],
    access: 'Any file path you give it',
    dataLeaves: 'Analysis runs locally; findings go to the AI model',
    risks: ['Only for software you own or are authorised to analyse (see REA DISCLAIMER.md)', 'Runtime capture runs the target with your user rights', 'Target content is untrusted and may contain prompt-injection text'],
    classification: 'optional_local',
    risk: 'medium',
    install: { name: 'REA', transport: 'stdio', command: 'npx', args: ['-y', 'rea-agents@6.8.0', 'mcp'], catalogId: 'rea' }
  },
  {
    id: 'mobile-mcp',
    name: 'Mobile MCP',
    publisher: 'Mobile Next',
    description: 'Drives Android emulators and devices: list devices, launch and install apps, read the screen elements, tap, swipe, type, take screenshots and read logs. Telemetry is switched off.',
    whenUsed: ['Checking an Android app you built on the emulator', 'Reproducing a bug by tapping through screens'],
    exampleTasks: ['Launch my app on the emulator and take a screenshot of the home screen', 'List the elements on screen and tap Sign in'],
    runsWhere: 'local',
    needsInternet: 'Only for the first npm download',
    requirements: 'Node.js 20+ with npx, Android platform-tools (adb) and a running emulator or a connected device. iOS needs a Mac.',
    needsAccount: 'No account, no API key, free',
    license: 'Apache-2.0',
    source: 'https://github.com/mobile-next/mobile-mcp',
    runtime: 'Node.js via npx + adb',
    version: '1.0.16',
    permissions: ['Control the emulator or device: tap, type, install, uninstall and clear app data'],
    access: 'Android devices visible to adb',
    dataLeaves: 'Screenshots and screen text go to the AI model (MOBILEMCP_DISABLE_TELEMETRY=1 is set)',
    risks: ['Can uninstall apps or clear their data on a connected real device; prefer the emulator'],
    classification: 'optional_local',
    risk: 'medium',
    install: { name: 'Mobile MCP', transport: 'stdio', command: 'npx', args: ['-y', '@mobilenext/mobile-mcp@1.0.16'], catalogId: 'mobile-mcp' },
    capabilityTest: { tool: 'mobile_list_available_devices', args: {}, expect: '' }
  },
  {
    id: 'maestro',
    name: 'Maestro',
    publisher: 'mobile.dev',
    description: 'Maestro UI testing for mobile apps: inspect the screen, run Maestro flows and commands on a device, take screenshots. Cloud tools need a Maestro Cloud login; the local tools do not.',
    whenUsed: ['Writing and running end-to-end UI tests for an Android app', 'Inspecting the view hierarchy of a running app'],
    exampleTasks: ['Inspect the current screen and write a Maestro flow that logs in', 'Run flows/login.yaml on the emulator'],
    runsWhere: 'local',
    needsInternet: 'No (cloud runs only with a Maestro Cloud account)',
    requirements: 'The Maestro CLI on PATH and Java 17 or newer, plus a running emulator or device',
    needsAccount: 'No account for local tools; Maestro Cloud tools need maestro login',
    license: 'Apache-2.0',
    source: 'https://docs.maestro.dev/getting-started/maestro-mcp',
    runtime: 'Maestro CLI (Java)',
    version: 'the Maestro CLI you install',
    permissions: ['Run UI flows on the emulator or device'],
    access: 'Devices visible to adb',
    dataLeaves: 'Screen content goes to the AI model (MAESTRO_CLI_NO_ANALYTICS is set)',
    risks: ['Flows can tap through real apps on a connected device'],
    classification: 'optional_local',
    risk: 'medium',
    install: { name: 'Maestro', transport: 'stdio', command: 'maestro', args: ['mcp'], catalogId: 'maestro' },
    capabilityTest: { tool: 'list_devices', args: {}, expect: '' }
  }
]

/** Catalogue connectors shown under "Mobile app development" in the Toolbox. */
export const MOBILE_CONNECTORS = ['mobile-mcp', 'maestro']

/** Fixed, non-secret environment for catalogue servers (telemetry and analytics off). */
export const FIXED_ENV: Record<string, Record<string, string>> = {
  'mobile-mcp': { MOBILEMCP_DISABLE_TELEMETRY: '1' },
  maestro: { MAESTRO_CLI_NO_ANALYTICS: 'true' }
}

/** Approval policy a catalogue connector gets when added. The user decided Sekudo scans need no per-call approval. */
export function defaultPolicy(catalogId: string): McpServerConfig['policy'] {
  return catalogId === 'sekudo' ? 'allow' : 'ask'
}
