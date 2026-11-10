import type { Settings } from '@shared/types'

export type ApprovalKind = 'write' | 'command' | 'mcp' | 'publish'

/**
 * Whether an action may run without an approval card. "Never ask" (autoApproveAll) covers file changes, commands,
 * connector tools and git in every mode. Publishing to GitHub (push, pull requests, merges, comments, releases) reaches
 * outside the PC, so it still asks unless the user also turned off "Still ask before publishing to GitHub".
 * Questions the agent asks (ask_user) are not approvals and are never answered automatically.
 */
export function autoApproved(s: Settings, kind: ApprovalKind): boolean {
  if (kind === 'publish') return !!s.autoApproveAll && !s.askBeforePublishing
  if (s.autoApproveAll) return true
  if (kind === 'write') return s.autoApproveWrites
  if (kind === 'command') return s.autoApproveCommands
  return false
}
