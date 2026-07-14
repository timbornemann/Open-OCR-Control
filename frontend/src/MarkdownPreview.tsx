import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import rehypeLatexDelimiters, { protectLatexDelimiters } from './rehypeLatexDelimiters'

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

export default function MarkdownPreview({ children }: MarkdownPreviewProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, sanitizeSchema],
        rehypeLatexDelimiters,
        [rehypeKatex, { strict: 'ignore' }],
      ]}
    >
      {protectLatexDelimiters(children)}
    </ReactMarkdown>
  )
}
