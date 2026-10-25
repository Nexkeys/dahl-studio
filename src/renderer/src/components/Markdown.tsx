import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
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

/** Safe Markdown (no raw HTML) with GFM tables/lists and copyable code blocks. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          code: ({ className, children }) => {
            const m = /language-(\w+)/.exec(className ?? '')
            const code = String(children ?? '').replace(/\n$/, '')
            if (m || code.includes('\n')) return <CodeBlock lang={m?.[1] ?? ''} code={code} />
            return <code className="md-inline">{children}</code>
          },
          pre: ({ children }) => <>{children}</>
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
