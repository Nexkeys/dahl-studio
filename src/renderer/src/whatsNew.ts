// User-facing release notes for the What's New dialog, newest first. Add an entry for every release (README,
// "Releases and auto-update"). Keep it short and in the user's words: what they can do now, not how it was built.
// CHANGELOG.md stays the detailed engineering record.

export type NoteIcon = 'sparkles' | 'chats' | 'palette' | 'tabs' | 'question' | 'git' | 'github' | 'plug' | 'globe' | 'agents' | 'gauge' | 'shield' | 'keyboard'

export interface ReleaseNote {
  version: string
  date: string
  title: string
  summary: string
  items: { icon: NoteIcon; title: string; text: string }[]
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.4.0', date: '2026-11-10', title: 'More models, real terminal, images and skills',
    summary: 'Use Groq, OpenRouter or your own local models, keep an eye on cost, and give Dahl screenshots, PDFs and skills to work with.',
    items: [
      { icon: 'plug', title: 'More models', text: 'Groq, OpenRouter, Ollama and LM Studio join the model menu in the chat box. Model lists stay up to date on their own.' },
      { icon: 'gauge', title: 'Cost you can see', text: 'See what today cost in the status bar, set a budget per task or per day, and pick Economy, Balanced or Best in the chat box.' },
      { icon: 'shield', title: 'Never ask', text: 'One switch in Settings > Approvals lets Dahl work without approval cards. Publishing to GitHub still asks.' },
      { icon: 'sparkles', title: 'Images and PDFs', text: 'Attach up to 15 images and PDFs. Dahl reads their text, layout and colours first, even with models that cannot see images.' },
      { icon: 'agents', title: 'Skills', text: 'Type / or click Skills for 47 ready-made skills. Your CLAUDE.md, AGENTS.md and Cursor rules are read too.' },
      { icon: 'keyboard', title: 'A real terminal', text: 'PowerShell, Command Prompt or Git Bash in tabs, with colours that match your theme.' },
      { icon: 'globe', title: 'Dahl tests your app', text: 'Dahl can open your local app in Preview, click through it and read its console.' },
      { icon: 'chats', title: 'Talk while it works', text: 'Send a message while Dahl is busy. It reads it at its next step.' },
      { icon: 'palette', title: 'Fresh look', text: 'Clearer status icons, a progress strip above the chat and a new High Contrast theme.' }
    ]
  },
  {
    version: '0.3.7', date: '2026-11-03', title: 'Tabs, questions and Git that does it all',
    summary: 'Work on several conversations at once, let Dahl ask before it guesses, and run your whole Git and GitHub flow from the chat.',
    items: [
      { icon: 'sparkles', title: 'Picks up where you left off', text: 'Updating no longer stops your work. Install when your tasks finish, or restart now and they continue on their own. After a crash, Dahl offers to continue, and your open files, unsaved edits and dev server command come back.' },
      { icon: 'chats', title: 'Chat tabs', text: 'Keep several conversations open per project. A chat keeps working in the background while you read another, and your tabs come back after a restart.' },
      { icon: 'question', title: 'Dahl asks when it matters', text: 'When a choice is yours to make, Dahl shows a short set of questions with options to pick from, instead of guessing.' },
      { icon: 'git', title: 'Full Git in the chat', text: 'Ask Dahl to pull, fetch, branch, switch, merge, stash, tag or commit. It shows conflicts and resolves them with you. It never force-pushes.' },
      { icon: 'github', title: 'Pull requests and releases', text: 'Dahl can open, check and merge pull requests, read failing CI logs, and publish GitHub releases with files attached, using your saved GitHub token.' },
      { icon: 'tabs', title: 'Better editor tabs', text: 'Drag tabs to reorder, middle-click to close, right-click for Close others and more. A bar under the tabs shows the path, line and column.' },
      { icon: 'keyboard', title: 'IDE shortcuts', text: 'Ctrl+P go to file, Ctrl+W close tab, Ctrl+Tab switch tabs, Ctrl+Shift+T reopen, Ctrl+B explorer, Ctrl+Alt+B chat, Ctrl+J terminal.' },
      { icon: 'palette', title: 'Two new themes', text: 'Blueprint, a drafting-table navy with a fine grid, and Ink & Paper, black ink on white with a single red pen.' }
    ]
  },
  {
    version: '0.3.6', date: '2026-10-31', title: 'Preview, MCP commands and GitHub push',
    summary: 'See your app beside the code, call any connector by name, and publish to GitHub in one step.',
    items: [
      { icon: 'globe', title: 'Preview browser', text: 'Open your dev server or an HTML file in a pane beside the editor. Static pages reload when you save.' },
      { icon: 'plug', title: 'MCP slash commands', text: 'Type /<server> to work with one connector, or /mcp to use them all.' },
      { icon: 'github', title: 'Publish to GitHub', text: 'Push a project to a GitHub repository from Source Control or by asking Dahl.' },
      { icon: 'agents', title: 'Sturdier sub-agents', text: 'Parallel review agents recover from dropped connections and respect Pause.' }
    ]
  },
  {
    version: '0.3.5', date: '2026-10-27', title: 'Faster everywhere',
    summary: 'Long replies stream smoothly and the app opens faster.',
    items: [
      { icon: 'gauge', title: 'Smooth streaming', text: 'Long answers no longer slow the app down while they arrive.' },
      { icon: 'sparkles', title: 'Visual effects setting', text: 'Choose Reduced effects for older or remote PCs, or let Dahl Studio decide.' }
    ]
  }
]

/** Compare dotted versions numerically: 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/** Notes for every version after `since`, up to and including `current`, newest first. */
export function notesSince(since: string, current: string): ReleaseNote[] {
  return RELEASE_NOTES.filter((r) => compareVersions(r.version, since) > 0 && compareVersions(r.version, current) <= 0)
}

/** Notes for the running version, or the newest ones when this build has no entry yet. */
export function currentNotes(current: string): ReleaseNote[] {
  const exact = RELEASE_NOTES.find((r) => r.version === current)
  return [exact ?? RELEASE_NOTES[0]]
}
