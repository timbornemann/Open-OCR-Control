import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { LANGUAGE_STORAGE_KEY } from './i18n'
import type { Job } from './types'

class MockEventSource {
  static latest: MockEventSource | null = null
  readonly listeners = new Map<string, EventListener[]>()
  onerror: ((event: Event) => void) | null = null

  constructor(_url: string) {
    MockEventSource.latest = this
  }

  addEventListener(name: string, listener: EventListener): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }

  close(): void {}

  emit(name: string, data: unknown): void {
    const event = new MessageEvent(name, { data: JSON.stringify(data) })
    for (const listener of this.listeners.get(name) ?? []) listener(event)
  }
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('App workspace', () => {
  const scrollIntoView = vi.fn()
  const storedValues = new Map<string, string>()

  beforeEach(() => {
    storedValues.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => storedValues.set(key, value),
      removeItem: (key: string) => storedValues.delete(key),
    })
    localStorage.removeItem(LANGUAGE_STORAGE_KEY)
    MockEventSource.latest = null
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    scrollIntoView.mockClear()
  })

  it('defaults to English and follows the active page in the compact job view', async () => {
    const job: Job = {
      id: 'job-1',
      filename: 'document.pdf',
      status: 'processing',
      message: '',
      progress: 0,
      total_pages: 80,
      completed_pages: 0,
      failed_pages: 0,
      pages: Array.from({ length: 80 }, (_, index) => ({
        page: index + 1,
        status: 'pending',
        markdown: '',
        error: null,
        elapsed_seconds: null,
      })),
      error: null,
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/ocr/status') return response({ state: 'stopped', ready: false, managed: true, message: '', model: '', container_status: null })
      if (url === '/api/jobs') return response(job)
      throw new Error(`Unexpected request: ${url}`)
    }))

    const { container } = render(<App />)
    expect(screen.getByRole('heading', { name: 'Documents in. Structured text out.' })).toBeInTheDocument()

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { files: [new File(['pdf'], 'document.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Start OCR →' }))

    await screen.findByText('CURRENT JOB')
    expect(screen.queryByRole('heading', { name: 'Documents in. Structured text out.' })).not.toBeInTheDocument()

    await act(async () => MockEventSource.latest?.emit('page_started', { page: 42 }))
    const pageButton = screen.getByRole('button', { name: 'Page 42' })
    await waitFor(() => expect(pageButton).toHaveAttribute('aria-current', 'page'))
    expect(screen.getByText('Page 42')).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalled()
  })
})
