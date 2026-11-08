import type { SkillList } from '@shared/types'
import { loadSkills, skillRoots, summarize, type Skill } from './loader'

export interface SkillService {
  /** every valid skill for this project (built-in, then the user's, then the project's; later ones win by name) */
  load(project: string | null): Promise<{ skills: Skill[] }>
  /** what the / menu shows, with the reasons skills were skipped */
  list(project: string | null): Promise<SkillList>
}

/** Skipped skills are logged once per reason, not on every agent step. */
export function createSkillService(o: { builtinDir: () => string; userDir: string; log?: (msg: string) => void }): SkillService {
  const logged = new Set<string>()
  const run = async (project: string | null) => {
    const r = await loadSkills(skillRoots(o.builtinDir(), o.userDir, project))
    for (const p of r.problems) {
      const key = `${p.path}: ${p.reason}`
      if (logged.has(key)) continue
      logged.add(key)
      o.log?.(`skill ${p.level === 'error' ? 'skipped' : 'warning'}: ${key}`)
    }
    return r
  }
  return {
    load: async (project) => ({ skills: (await run(project)).skills }),
    list: async (project) => {
      const r = await run(project)
      return { skills: r.skills.map(summarize), problems: r.problems }
    }
  }
}
