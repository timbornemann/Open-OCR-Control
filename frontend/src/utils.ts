import type { PageResult } from './types'

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

export function combinePages(pages: PageResult[]): string {
  return pages
    .filter((page) => page.markdown.trim())
    .sort((a, b) => a.page - b.page)
    .map((page) => page.markdown.trim())
    .join('\n\n---\n\n')
}

export function combineRawPages(pages: PageResult[]): string {
  return pages
    .filter((page) => (page.raw_markdown || page.markdown).trim())
    .sort((a, b) => a.page - b.page)
    .map((page) => (page.raw_markdown || page.markdown).trim())
    .join('\n\n---\n\n')
}

export function parseEvent<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T
}
