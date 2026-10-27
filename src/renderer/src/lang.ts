// Monaco language id for a file name. Kept out of monaco.ts so callers do not pull the editor bundle in.
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', md: 'markdown', py: 'python',
  rs: 'rust', go: 'go', java: 'java', cs: 'csharp', cpp: 'cpp', cc: 'cpp', c: 'c', h: 'cpp', hpp: 'cpp',
  rb: 'ruby', php: 'php', sh: 'shell', ps1: 'powershell', yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql',
  kt: 'kotlin', swift: 'swift', lua: 'lua', dart: 'dart', toml: 'ini', ini: 'ini', dockerfile: 'dockerfile', vue: 'html', svelte: 'html'
}

export function languageFor(file: string): string {
  const name = file.split('/').pop()!.toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  return EXT_LANG[name.split('.').pop() ?? ''] ?? 'plaintext'
}
