import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { SESSION_STORAGE_KEY } from './App'
import { LANGUAGE_STORAGE_KEY } from './i18n'
import type { Batch, Job } from './types'

class MockEventSource {
  static latest: MockEventSource | null = null
  readonly listeners = new Map<string, EventListener[]>()
  onerror: ((event: Event) => void) | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
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
    cleanup()
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
        raw_markdown: '',
        assets: [],
        error: null,
        elapsed_seconds: null,
      })),
      error: null,
      batch_id: null,
      last_event_id: 4,
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

  it('uploads multiple files as one sequential batch and exposes document tabs', async () => {
    const makeJob = (id: string, filename: string): Job => ({
      id,
      filename,
      status: 'queued',
      message: '',
      progress: 0,
      total_pages: 0,
      completed_pages: 0,
      failed_pages: 0,
      pages: [],
      error: null,
      batch_id: 'batch-1',
      last_event_id: 1,
    })
    const batch: Batch = {
      id: 'batch-1',
      status: 'processing',
      message: '',
      progress: 0,
      total_files: 2,
      completed_files: 0,
      failed_files: 0,
      current_job_id: 'job-1',
      last_event_id: 2,
      jobs: [makeJob('job-1', 'one.pdf'), makeJob('job-2', 'two.pdf')],
    }
    let uploadedFiles = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/ocr/status') return response({ state: 'stopped', ready: false, managed: true, message: '', model: '', container_status: null })
      if (url === '/api/batches') {
        uploadedFiles = (init?.body as FormData).getAll('files').length
        return response(batch)
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch mode' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    fireEvent.change(input!, {
      target: {
        files: [
          new File(['one'], 'one.pdf', { type: 'application/pdf' }),
          new File(['two'], 'two.pdf', { type: 'application/pdf' }),
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start batch →' }))

    expect(await screen.findByRole('tab', { name: '1. one.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '2. two.pdf' })).toBeInTheDocument()
    expect(uploadedFiles).toBe(2)
  })

  it('restores a running job and resumes events after the server snapshot', async () => {
    const job: Job = {
      id: 'running-job',
      filename: 'running.pdf',
      status: 'processing',
      message: '',
      progress: 0.5,
      total_pages: 1,
      completed_pages: 0,
      failed_pages: 0,
      pages: [{
        page: 1,
        status: 'processing',
        markdown: 'Already recognized',
        raw_markdown: '',
        assets: [],
        error: null,
        elapsed_seconds: null,
      }],
      error: null,
      batch_id: null,
      last_event_id: 37,
    }
    storedValues.set(SESSION_STORAGE_KEY, JSON.stringify({ kind: 'job', id: job.id }))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/ocr/status') return response({ state: 'ready', ready: true, managed: true, message: '', model: '', container_status: 'running' })
      if (url === `/api/jobs/${job.id}`) return response(job)
      throw new Error(`Unexpected request: ${url}`)
    }))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'running.pdf' })).toBeInTheDocument()
    expect(await screen.findByText('Already recognized')).toBeInTheDocument()
    expect(MockEventSource.latest?.url).toBe(`/api/jobs/${job.id}/events?after_event_id=37`)
  })

  it('restores a completed batch and its selected result tab', async () => {
    const makeCompletedJob = (id: string, filename: string, markdown: string): Job => ({
      id,
      filename,
      status: 'completed',
      message: '',
      progress: 1,
      total_pages: 1,
      completed_pages: 1,
      failed_pages: 0,
      pages: [{
        page: 1,
        status: 'completed',
        markdown,
        raw_markdown: markdown,
        assets: [],
        error: null,
        elapsed_seconds: 1,
      }],
      error: null,
      batch_id: 'saved-batch',
      last_event_id: 8,
    })
    const batch: Batch = {
      id: 'saved-batch',
      status: 'completed',
      message: '',
      progress: 1,
      total_files: 2,
      completed_files: 2,
      failed_files: 0,
      current_job_id: null,
      last_event_id: 21,
      jobs: [
        makeCompletedJob('saved-1', 'one.pdf', 'First result'),
        makeCompletedJob('saved-2', 'two.pdf', 'Second result'),
      ],
    }
    storedValues.set(SESSION_STORAGE_KEY, JSON.stringify({
      kind: 'batch',
      id: batch.id,
      selected_job_id: 'saved-2',
    }))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/ocr/status') return response({ state: 'ready', ready: true, managed: true, message: '', model: '', container_status: 'running' })
      if (url === `/api/batches/${batch.id}`) return response(batch)
      throw new Error(`Unexpected request: ${url}`)
    }))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'two.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '2. two.pdf' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Second result')).toBeInTheDocument()
    expect(MockEventSource.latest).toBeNull()
  })
})
