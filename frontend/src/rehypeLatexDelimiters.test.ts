import { describe, expect, it } from 'vitest'
import { splitLatexText } from './rehypeLatexDelimiters'

describe('splitLatexText', () => {
  it('recognizes explicit inline and display delimiters', () => {
    expect(splitLatexText('A \\(x_{i}\\) and \\[y = 2\\].')).toEqual([
      { type: 'text', value: 'A ', display: false },
      { type: 'math', value: 'x_{i}', display: false },
      { type: 'text', value: ' and ', display: false },
      { type: 'math', value: 'y = 2', display: true },
      { type: 'text', value: '.', display: false },
    ])
  })

  it('recognizes balanced OCR-style math delimiters', () => {
    const segments = splitLatexText('For an edge ( w(e) ) and [ w(K) = w(v_0, v_1) + \\dots ].')
    expect(segments.filter((segment) => segment.type === 'math')).toEqual([
      { type: 'math', value: 'w(e)', display: false },
      { type: 'math', value: 'w(K) = w(v_0, v_1) + \\dots', display: true },
    ])
  })

  it('keeps ordinary prose in parentheses unchanged', () => {
    expect(splitLatexText('Text (with an ordinary aside) remains text.')).toEqual([
      { type: 'text', value: 'Text (with an ordinary aside) remains text.', display: false },
    ])
  })
})
