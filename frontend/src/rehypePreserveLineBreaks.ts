import type { Element, ElementContent, Parent, Root, RootContent } from 'hast'

const PRESERVED_CONTEXTS = new Set([
  'p',
  'li',
  'td',
  'th',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
])
const SKIPPED_TAGS = new Set(['code', 'pre', 'script', 'style', 'textarea'])

function isElement(node: RootContent | ElementContent): node is Element {
  return node.type === 'element'
}

function shouldSkip(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName)) return true
  const classes = Array.isArray(element.properties.className) ? element.properties.className : []
  return classes.some((className) =>
    String(className).includes('math') || String(className).startsWith('katex'),
  )
}

function splitText(parent: Parent, index: number, value: string): number {
  const parts = value.split('\n')
  if (parts.length === 1) return 0

  const replacements: ElementContent[] = []
  parts.forEach((part, partIndex) => {
    if (part) replacements.push({ type: 'text', value: part })
    if (partIndex < parts.length - 1) {
      replacements.push({ type: 'element', tagName: 'br', properties: {}, children: [] })
    }
  })
  parent.children.splice(index, 1, ...replacements)
  return replacements.length - 1
}

function transformParent(parent: Parent, preserve: boolean): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index] as RootContent | ElementContent
    if (child.type === 'text') {
      if (preserve) index += splitText(parent, index, child.value)
      continue
    }
    if (!isElement(child) || shouldSkip(child)) continue
    transformParent(child, preserve || PRESERVED_CONTEXTS.has(child.tagName))
  }
}

/** Preserve OCR-significant soft line breaks without changing raw HTML structure or code/math. */
export default function rehypePreserveLineBreaks() {
  return (tree: Root) => transformParent(tree, false)
}
