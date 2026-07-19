import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import rehypeLatexDelimiters, { protectLatexDelimiters } from './rehypeLatexDelimiters'
import rehypePreserveLineBreaks from './rehypePreserveLineBreaks'

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', 'math-inline', 'math-display'],
    ],
  },
}

interface MarkdownPreviewProps {
  children: string
}

function safeUrlTransform(url: string, key: string): string {
  if (key !== 'src') return url
  return url.startsWith('/api/jobs/') && url.includes('/assets/') ? url : ''
}

export default function MarkdownPreview({ children }: MarkdownPreviewProps) {
  return (
    <ReactMarkdown
      urlTransform={safeUrlTransform}
      components={{ img: ({ src, ...props }) => src ? <img src={src} {...props} /> : null }}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, sanitizeSchema],
        rehypeLatexDelimiters,
        rehypePreserveLineBreaks,
        [rehypeKatex, { strict: 'ignore' }],
      ]}
    >
      {protectLatexDelimiters(children)}
    </ReactMarkdown>
  )
}
