import { describe, expect, it } from 'vitest'
import { combinePages, combineRawPages, formatFileSize } from './utils'

const PAGE_DEFAULTS = { raw_markdown: '', assets: [], error: null, elapsed_seconds: 1 }

describe('formatFileSize', () => {
  it('formats bytes and larger units', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(12 * 1024 * 1024)).toBe('12 MB')
  })
})

describe('combinePages', () => {
  it('sorts pages and skips empty results', () => {
    const result = combinePages([
      { ...PAGE_DEFAULTS, page: 2, status: 'completed', markdown: 'Zwei' },
      { ...PAGE_DEFAULTS, page: 1, status: 'completed', markdown: 'Eins' },
      { ...PAGE_DEFAULTS, page: 3, status: 'failed', markdown: '', error: 'nope' },
    ])
    expect(result).toBe('Eins\n\n---\n\nZwei')
  })

  it('combines raw markdown separately from the rich preview', () => {
    const result = combineRawPages([
      {
        ...PAGE_DEFAULTS,
        page: 1,
        status: 'completed',
        markdown: 'Text ![Image](/api/image.jpg)',
        raw_markdown: 'Text',
      },
    ])
    expect(result).toBe('Text')
  })
})
