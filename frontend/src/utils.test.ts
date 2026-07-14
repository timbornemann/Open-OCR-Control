import { describe, expect, it } from 'vitest'
import { combinePages, formatFileSize } from './utils'

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
      { page: 2, status: 'completed', markdown: 'Zwei', error: null, elapsed_seconds: 1 },
      { page: 1, status: 'completed', markdown: 'Eins', error: null, elapsed_seconds: 1 },
      { page: 3, status: 'failed', markdown: '', error: 'nope', elapsed_seconds: 1 },
    ])
    expect(result).toBe('Eins\n\n---\n\nZwei')
  })
})
