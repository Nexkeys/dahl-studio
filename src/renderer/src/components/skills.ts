import { BookOpen, Bug, FlaskConical, ShieldAlert, Wand2, FileText, GitCommit, Search, Users, Globe, Gauge, Palette } from 'lucide-react'
import type { AgentMode } from '@shared/types'

export interface Skill {
  cmd: string
  label: string
  icon: typeof Bug
  prompt: string
  mode?: AgentMode
  web?: boolean
}

/** Slash-command skills: reusable, editable prompt templates for common jobs. */
export const SKILLS: Skill[] = [
  { cmd: '/explain', label: 'Explain the codebase or a file', icon: BookOpen, mode: 'review', prompt: 'Explain how this project works: purpose, architecture, main modules, data flow and how to run it. Be concise and use headings.' },
  { cmd: '/fix', label: 'Find and fix a bug', icon: Bug, mode: 'build', prompt: 'There is a bug: <describe it>. Reproduce it, find the root cause from evidence, fix it, and verify the fix.' },
  { cmd: '/tests', label: 'Write and run tests', icon: FlaskConical, mode: 'build', prompt: 'Add meaningful tests for the most important untested behaviour in this project, run them and fix failures.' },
  { cmd: '/review', label: 'Parallel code + security review', icon: Users, mode: 'review', prompt: 'Run a parallel review with a Code Reviewer and a Security Reviewer sub-agent. Merge their findings into one prioritised list with file:line references.' },
  { cmd: '/security', label: 'Attack the code like a pentester', icon: ShieldAlert, mode: 'review', prompt: 'Perform an authorised offensive security assessment of this project. Map the attack surface, find exploitable vulnerabilities, give proof-of-concept inputs, severity and fixes.' },
  { cmd: '/refactor', label: 'Refactor for clarity', icon: Wand2, mode: 'build', prompt: 'Refactor <file or module> for readability and maintainability without changing behaviour. Keep changes small and run the tests.' },
  { cmd: '/docs', label: 'Write documentation', icon: FileText, mode: 'build', prompt: 'Write or update the README: what it is, setup, how to run, how to test, project structure.' },
  { cmd: '/commit', label: 'Draft a commit message', icon: GitCommit, mode: 'review', prompt: 'Look at the uncommitted changes (git diff) and draft a clear conventional commit message with a short body.' },
  { cmd: '/research', label: 'Research on the web', icon: Globe, mode: 'plan', web: true, prompt: 'Research <topic> on the web. Compare the main options with sources (URLs) and recommend one for this project.' },
  { cmd: '/perf', label: 'Find performance problems', icon: Gauge, mode: 'review', prompt: 'Find the most likely performance bottlenecks in this project and propose measured improvements.' },
  { cmd: '/ui', label: 'Build a polished UI from a design', icon: Palette, mode: 'build', prompt: 'Build the UI shown in the attached design image as closely as possible. First analyse the image (layout, colours, typography, text), then implement it, then compare against the analysis.' },
  { cmd: '/find', label: 'Locate code', icon: Search, mode: 'plan', prompt: 'Where is <feature> implemented? List the relevant files and functions and how they connect.' }
]
