import {
  Accessibility, BookOpen, Bot, Bug, ChartColumn, Cloud, Compass, Database, FileCode, FileText, FlaskConical, Gauge, GitCommit, GitMerge, GitPullRequest,
  Globe, KeyRound, Landmark, Layers, LayoutTemplate, ListChecks, Lock, Map as MapIcon, Microscope, Network, Package, Palette, Repeat, Rocket, Scissors, Search,
  Server, ShieldAlert, ShieldCheck, Shuffle, Smartphone, Sparkles, Table, Tag, Target, Timer, Users, Wand2, Workflow, Wrench
} from 'lucide-react'
import type { SkillSummary } from '@shared/types'

/**
 * Skills are SKILL.md folders loaded by the main process (built-in skills/, the user's skills, and the project's
 * .dahl/.claude/.agents skills); the / menu gets them through skills:list. The frontmatter's metadata dahl-icon
 * picks the icon.
 */
const ICONS: Record<string, typeof Bug> = {
  book: BookOpen, bug: Bug, flask: FlaskConical, users: Users, shield: ShieldAlert, 'shield-check': ShieldCheck, wand: Wand2, 'file-text': FileText,
  'file-code': FileCode, 'git-commit': GitCommit, 'git-merge': GitMerge, 'git-pull-request': GitPullRequest, globe: Globe, gauge: Gauge, palette: Palette,
  search: Search, accessibility: Accessibility, bot: Bot, chart: ChartColumn, cloud: Cloud, compass: Compass, database: Database, key: KeyRound,
  landmark: Landmark, layers: Layers, layout: LayoutTemplate, 'list-checks': ListChecks, lock: Lock, map: MapIcon, microscope: Microscope, network: Network,
  package: Package, repeat: Repeat, rocket: Rocket, scissors: Scissors, server: Server, shuffle: Shuffle, smartphone: Smartphone, table: Table, tag: Tag,
  target: Target, timer: Timer, workflow: Workflow, wrench: Wrench
}

export const skillIcon = (s: Pick<SkillSummary, 'icon'>): typeof Bug => (s.icon && ICONS[s.icon]) || Sparkles

/** The first sentence of a description, for one-line menu rows. */
export const skillLabel = (s: Pick<SkillSummary, 'description'>): string => /^.*?[.!?](?=\s|$)/.exec(s.description)?.[0] ?? s.description
