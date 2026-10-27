import { memo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || 'text'}</span>
        <button className="icon-btn tiny" aria-label="Copy code" onClick={() => { void navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400) }}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

const PLUGINS = [remarkGfm]
const COMPONENTS: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  code: ({ className, children }) => {
    const m = /language-(\w+)/.exec(className ?? '')
    const code = String(children ?? '').replace(/\n$/, '')
    if (m || code.includes('\n')) return <CodeBlock lang={m?.[1] ?? ''} code={code} />
    return <code className="md-inline">{children}</code>
  },
  pre: ({ children }) => <>{children}</>
}

const Blocks = memo(function Blocks({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>{text}</ReactMarkdown>
})

/** Safe Markdown (no raw HTML) with GFM tables/lists and copyable code blocks. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <div className="md"><Blocks text={text} /></div>
})

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Splits text into top-level blocks at blank lines outside code fences. A block only ends once the next
 * non-blank line has arrived and is not indented (so list continuations stay with their item); everything
 * after the last such boundary is one open block that is still being written.
 */
export function splitBlocks(text: string): string[] {
  const lines = text.split('\n')
  const blocks: string[] = []
  let cur: string[] = []
  let fence: string | null = null
  let blank = false
  for (const line of lines) {
    if (fence) {
      cur.push(line)
      const close = FENCE.exec(line)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && !line.trim().slice(close[1].length).trim()) fence = null
      continue
    }
    if (!line.trim()) {
      blank = true
      cur.push(line)
      continue
    }
    if (blank && !/^\s/.test(line) && cur.some((l) => l.trim())) {
      blocks.push(cur.join('\n'))
      cur = []
    }
    blank = false
    const open = FENCE.exec(line)
    if (open) fence = open[1]
    cur.push(line)
  }
  if (cur.length) blocks.push(cur.join('\n'))
  return blocks
}

/**
 * Markdown for a reply that is still streaming. Finished blocks keep their rendered output (Blocks is memoized
 * on its text), so each update re-parses only the open block instead of the whole reply.
 */
export function LiveMarkdown({ text }: { text: string }) {
  return <div className="md">{splitBlocks(text).map((b, i) => <Blocks key={i} text={b} />)}</div>
}
