const DASH = '[\\u2013\\u2014\\u2015]'
const RANGE = new RegExp(`(\\d)[ \\t]*${DASH}[ \\t]*(?=\\d)`, 'g')
const LEAD = new RegExp(`^([ \\t]*)${DASH}+[ \\t]*`, 'gm')
const TRAIL = new RegExp(`[ \\t]*${DASH}+[ \\t]*(?=\\r?\\n|$)`, 'g')
const MID = new RegExp(`[ \\t]*${DASH}+[ \\t]*`, 'g')

/**
 * Dahl never writes em or en dashes (product rule). Rewrites them the way a careful writer would:
 * ranges become a hyphen (1-5), a dash opening a line becomes a list hyphen, one ending a line is dropped,
 * and one inside a sentence becomes a comma (or a space after existing punctuation).
 */
export function stripDashes(s: string): string {
  if (!/[\u2013\u2014\u2015]/.test(s)) return s
  return s
    .replace(RANGE, '$1-')
    .replace(LEAD, '$1- ')
    .replace(TRAIL, '')
    .replace(MID, (_m, at: number, all: string) => (/[,;:.!?(\[{-]$/.test(all.slice(0, at)) ? ' ' : ', '))
}
