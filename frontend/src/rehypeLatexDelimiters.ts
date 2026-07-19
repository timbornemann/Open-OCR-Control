import type { Element, ElementContent, Parent, Root, RootContent } from 'hast'

export interface LatexSegment {
  type: 'text' | 'math'
  value: string
  display: boolean
}

const SKIPPED_TAGS = new Set(['code', 'pre', 'script', 'style'])
const INLINE_OPEN = '\uE000'
const INLINE_CLOSE = '\uE001'
const DISPLAY_OPEN = '\uE002'
const DISPLAY_CLOSE = '\uE003'
const PUNCTUATION_OFFSET = 0xE100
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/g
const PROTECTED_PUNCTUATION = /[\uE121-\uE17E]/g

function protectLatexPunctuation(value: string): string {
  return value.replace(ASCII_PUNCTUATION, (character) =>
    String.fromCodePoint(PUNCTUATION_OFFSET + character.codePointAt(0)!),
  )
}

export function protectLatexDelimiters(value: string): string {
  let output = ''
  let cursor = 0

  while (cursor < value.length) {
    const inlineStart = value.indexOf('\\(', cursor)
    const displayStart = value.indexOf('\\[', cursor)
    const starts = [inlineStart, displayStart].filter((index) => index >= 0)
    if (starts.length === 0) break

    const start = Math.min(...starts)
    const inline = start === inlineStart
    const closingDelimiter = inline ? '\\)' : '\\]'
    const end = value.indexOf(closingDelimiter, start + 2)
    if (end < 0) break

    output += value.slice(cursor, start)
    output += inline ? INLINE_OPEN : DISPLAY_OPEN
    output += protectLatexPunctuation(value.slice(start + 2, end))
    output += inline ? INLINE_CLOSE : DISPLAY_CLOSE
    cursor = end + 2
  }

  return output + value.slice(cursor)
}

function restoreLatexDelimiters(value: string): string {
  return value
    .replaceAll(INLINE_OPEN, '\\(')
    .replaceAll(INLINE_CLOSE, '\\)')
    .replaceAll(DISPLAY_OPEN, '\\[')
    .replaceAll(DISPLAY_CLOSE, '\\]')
    .replace(PROTECTED_PUNCTUATION, (character) =>
      String.fromCodePoint(character.codePointAt(0)! - PUNCTUATION_OFFSET),
    )
}

function looksLikeMath(value: string): boolean {
  return (
    /\\[A-Za-z]+/.test(value) ||
    /[_^=<>±×÷∑∫√∞≈≠≤≥]/u.test(value) ||
    /\b[A-Za-z][A-Za-z0-9]*\s*\([^)]*\)/.test(value) ||
    /[A-Za-z0-9)}]\s*[+*/]\s*[A-Za-z0-9({]/.test(value) ||
    /\d\s*-\s*\d/.test(value)
  )
}

function findBalancedEnd(value: string, start: number, open: '(' | '[', close: ')' | ']'): number {
  let depth = 0
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === open) depth += 1
    if (value[index] === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function nextCandidate(value: string, from: number): number {
  const candidates = [
    value.indexOf(INLINE_OPEN, from),
    value.indexOf(DISPLAY_OPEN, from),
    value.indexOf('\\(', from),
    value.indexOf('\\[', from),
    value.indexOf('(', from),
    value.indexOf('[', from),
  ]
    .filter((index) => index >= 0)
  return candidates.length > 0 ? Math.min(...candidates) : -1
}

export function splitLatexText(value: string): LatexSegment[] {
  const segments: LatexSegment[] = []
  let emitted = 0
  let scan = 0

  while (scan < value.length) {
    const start = nextCandidate(value, scan)
    if (start < 0) break

    const protectedDelimiter = value[start] === INLINE_OPEN || value[start] === DISPLAY_OPEN
    const explicit = protectedDelimiter || value[start] === '\\'
    const delimiterIndex = explicit ? start + 1 : start
    const open = (protectedDelimiter ? (value[start] === INLINE_OPEN ? '(' : '[') : value[delimiterIndex]) as '(' | '['
    const close = open === '(' ? ')' : ']'
    let end = -1
    let contentStart = delimiterIndex + 1
    let contentEnd = -1

    if (protectedDelimiter) {
      const closing = open === '(' ? INLINE_CLOSE : DISPLAY_CLOSE
      end = value.indexOf(closing, start + 1)
      contentStart = start + 1
      contentEnd = end
    } else if (explicit) {
      const closing = `\\${close}`
      end = value.indexOf(closing, contentStart)
      contentEnd = end
    } else {
      end = findBalancedEnd(value, delimiterIndex, open, close)
      contentEnd = end
    }

    if (end < 0) {
      scan = delimiterIndex + 1
      continue
    }

    const content = restoreLatexDelimiters(value.slice(contentStart, contentEnd)).trim()
    if (!content || (!explicit && !looksLikeMath(content))) {
      scan = delimiterIndex + 1
      continue
    }

    if (start > emitted) segments.push({ type: 'text', value: restoreLatexDelimiters(value.slice(emitted, start)), display: false })
    segments.push({ type: 'math', value: content, display: open === '[' })
    emitted = protectedDelimiter ? end + 1 : explicit ? end + 2 : end + 1
    scan = emitted
  }

  if (emitted < value.length) segments.push({ type: 'text', value: restoreLatexDelimiters(value.slice(emitted)), display: false })
  return segments.length > 0 ? segments : [{ type: 'text', value, display: false }]
}

function isElement(node: RootContent | ElementContent): node is Element {
  return node.type === 'element'
}

function shouldSkip(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName)) return true
  const classes = Array.isArray(element.properties.className) ? element.properties.className : []
  return classes.some((className) => String(className).includes('math') || String(className).startsWith('katex'))
}

function restoreParent(parent: Parent): void {
  for (const child of parent.children as Array<RootContent | ElementContent>) {
    if (child.type === 'text') child.value = restoreLatexDelimiters(child.value)
    else if (isElement(child)) restoreParent(child)
  }
}

function transformParent(parent: Parent): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index] as RootContent | ElementContent
    if (child.type === 'text') {
      const segments = splitLatexText(child.value)
      if (segments.some((segment) => segment.type === 'math')) {
        const replacements: ElementContent[] = segments.map((segment) => {
          if (segment.type === 'text') return { type: 'text', value: segment.value }
          return {
            type: 'element',
            tagName: 'span',
            properties: { className: [segment.display ? 'math-display' : 'math-inline'] },
            children: [{ type: 'text', value: segment.value }],
          }
        })
        parent.children.splice(index, 1, ...replacements)
        index += replacements.length - 1
      }
      continue
    }
    if (isElement(child)) {
      if (shouldSkip(child)) restoreParent(child)
      else transformParent(child)
    }
  }
}

export default function rehypeLatexDelimiters() {
  return (tree: Root) => transformParent(tree)
}
