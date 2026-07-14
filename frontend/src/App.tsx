import { ChangeEvent, DragEvent, FormEvent, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COPY, LANGUAGE_STORAGE_KEY, initialLanguage, jobMessage, modelMessage, statusLabel, type Language } from './i18n'
import type { Job, OcrStatus, PageResult } from './types'
import { combinePages, formatFileSize, parseEvent } from './utils'

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.doc,.docx,.odt,.rtf,.ppt,.pptx,.xls,.xlsx,.ods'
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const MarkdownPreview = lazy(() => import('./MarkdownPreview'))

function emptyPage(page: number): PageResult {
  return { page, status: 'pending', markdown: '', error: null, elapsed_seconds: null }
}

async function apiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string }
    return body.detail || `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

function App() {
  const [language, setLanguage] = useState<Language>(() => initialLanguage())
  const [ocr, setOcr] = useState<OcrStatus | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [controllingModel, setControllingModel] = useState(false)
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const [copied, setCopied] = useState(false)
  const [activePage, setActivePage] = useState(1)
  const [dpi, setDpi] = useState(200)
  const [concurrency, setConcurrency] = useState(2)
  const [maxTokens, setMaxTokens] = useState(8192)
  const eventSource = useRef<EventSource | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const pageStrip = useRef<HTMLDivElement | null>(null)
  const resultContent = useRef<HTMLDivElement | null>(null)
  const text = COPY[language]

  useEffect(() => {
    document.documentElement.lang = language
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  }, [language])

  const refreshOcr = useCallback(async () => {
    try {
      const response = await fetch('/api/ocr/status')
      if (response.ok) setOcr((await response.json()) as OcrStatus)
    } catch {
      setOcr({ state: 'unavailable', ready: false, managed: false, message: '', model: '', container_status: null })
    }
  }, [])

  useEffect(() => {
    void refreshOcr()
    const timer = window.setInterval(() => void refreshOcr(), 5000)
    return () => window.clearInterval(timer)
  }, [refreshOcr])

  useEffect(() => () => eventSource.current?.close(), [])

  useEffect(() => {
    const selected = pageStrip.current?.querySelector<HTMLElement>(`[data-page-button="${activePage}"]`)
    selected?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activePage, job?.pages.length])

  useEffect(() => {
    if (job && TERMINAL.has(job.status) && job.total_pages > 0) {
      setActivePage(Math.min(Math.max(job.completed_pages + job.failed_pages, 1), job.total_pages))
    }
  }, [job?.completed_pages, job?.failed_pages, job?.status, job?.total_pages])

  const updatePage = useCallback((pageNumber: number, update: (page: PageResult) => PageResult) => {
    setJob((current) => {
      if (!current) return current
      const pages = [...current.pages]
      while (pages.length < Math.max(current.total_pages, pageNumber)) pages.push(emptyPage(pages.length + 1))
      pages[pageNumber - 1] = update(pages[pageNumber - 1])
      return { ...current, pages }
    })
  }, [])

  const loadJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/jobs/${jobId}`)
    if (response.ok) setJob((await response.json()) as Job)
  }, [])

  const connectEvents = useCallback((jobId: string) => {
    eventSource.current?.close()
    const source = new EventSource(`/api/jobs/${jobId}/events`)
    eventSource.current = source

    const updateStatus = (event: Event) => {
      const data = parseEvent<Partial<Job>>(event)
      setJob((current) => {
        if (!current) return current
        const total = data.total_pages ?? current.total_pages
        const pages = [...current.pages]
        while (pages.length < total) pages.push(emptyPage(pages.length + 1))
        return { ...current, ...data, pages }
      })
    }
    for (const name of ['job_status', 'job_progress']) source.addEventListener(name, updateStatus)

    source.addEventListener('page_started', (event) => {
      const data = parseEvent<{ page: number }>(event)
      setActivePage(data.page)
      updatePage(data.page, (page) => ({ ...page, status: 'processing' }))
    })
    source.addEventListener('page_delta', (event) => {
      const data = parseEvent<{ page: number; delta: string }>(event)
      updatePage(data.page, (page) => ({ ...page, markdown: page.markdown + data.delta }))
    })
    source.addEventListener('page_completed', (event) => {
      const data = parseEvent<{ page: number; markdown: string; elapsed_seconds: number }>(event)
      updatePage(data.page, (page) => ({ ...page, status: 'completed', markdown: data.markdown, elapsed_seconds: data.elapsed_seconds }))
    })
    source.addEventListener('page_failed', (event) => {
      const data = parseEvent<{ page: number; error: string }>(event)
      updatePage(data.page, (page) => ({ ...page, status: 'failed', error: data.error }))
    })
    for (const name of ['completed', 'failed', 'cancelled']) {
      source.addEventListener(name, () => {
        source.close()
        void loadJob(jobId)
        void refreshOcr()
      })
    }
    source.onerror = () => {
      // Native EventSource reconnects automatically while a job is active.
    }
  }, [loadJob, refreshOcr, updatePage])

  const chooseFile = (selected: File | null) => {
    setError('')
    setJob(null)
    setFile(selected)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    chooseFile(event.dataTransfer.files[0] ?? null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!file) return
    setUploading(true)
    setError('')
    const body = new FormData()
    body.append('file', file)
    body.append('dpi', String(dpi))
    body.append('page_concurrency', String(concurrency))
    body.append('max_tokens', String(maxTokens))
    try {
      const response = await fetch('/api/jobs', { method: 'POST', body })
      if (!response.ok) throw new Error(await apiError(response))
      const created = (await response.json()) as Job
      setActivePage(1)
      setJob(created)
      connectEvents(created.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.uploadFailed)
    } finally {
      setUploading(false)
    }
  }

  const controlModel = async (action: 'start' | 'stop') => {
    setControllingModel(true)
    setError('')
    try {
      const response = await fetch(`/api/ocr/${action}`, { method: 'POST' })
      if (!response.ok) throw new Error(await apiError(response))
      setOcr((await response.json()) as OcrStatus)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.modelControlFailed)
    } finally {
      setControllingModel(false)
    }
  }

  const cancel = async () => {
    if (!job) return
    const response = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
    if (response.ok) setJob((await response.json()) as Job)
    eventSource.current?.close()
  }

  const result = useMemo(() => combinePages(job?.pages ?? []), [job?.pages])
  const busy = job ? !TERMINAL.has(job.status) : false
  const hasResult = result.length > 0

  const copyResult = async () => {
    await navigator.clipboard.writeText(result)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const reset = () => {
    eventSource.current?.close()
    setJob(null)
    setFile(null)
    setError('')
    setCopied(false)
    setActivePage(1)
    setView('preview')
    if (fileInput.current) fileInput.current.value = ''
  }

  const selectPage = (pageNumber: number) => {
    setActivePage(pageNumber)
    if (view === 'preview') {
      resultContent.current?.querySelector<HTMLElement>(`[data-result-page="${pageNumber}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const trackPreviewPage = () => {
    const container = resultContent.current
    if (!container || view !== 'preview') return
    const marker = container.getBoundingClientRect().top + 48
    const sections = Array.from(container.querySelectorAll<HTMLElement>('[data-result-page]'))
    if (sections.length === 0) return
    let closest = sections[0]
    for (const section of sections) {
      if (Math.abs(section.getBoundingClientRect().top - marker) < Math.abs(closest.getBoundingClientRect().top - marker)) closest = section
    }
    const pageNumber = Number(closest.dataset.resultPage)
    if (pageNumber > 0) setActivePage(pageNumber)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <div><strong>Open OCR</strong><span>Control</span></div>
        </div>
        <div className="header-tools">
          <div className="language-switch" role="group" aria-label={text.language}>
            <button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} title={text.english} onClick={() => setLanguage('en')}>EN</button>
            <button type="button" className={language === 'de' ? 'active' : ''} aria-pressed={language === 'de'} title={text.german} onClick={() => setLanguage('de')}>DE</button>
          </div>
          <div className={`model-state state-${ocr?.state ?? 'checking'}`}>
            <i />
            <div><span>Unlimited-OCR</span><small>{modelMessage(ocr, language)}</small></div>
            {ocr?.managed && !ocr.ready && (
              <button className="text-button" disabled={controllingModel} onClick={() => void controlModel('start')}>{text.start}</button>
            )}
            {ocr?.managed && ocr.ready && (
              <button className="text-button" disabled={controllingModel || busy} onClick={() => void controlModel('stop')}>{text.stop}</button>
            )}
          </div>
        </div>
      </header>

      <main className={job ? 'job-main' : 'landing-main'}>
        {!job && (
          <section className="intro">
            <p className="eyebrow">{text.eyebrow}</p>
            <h1>{text.heroPrimary}<br /><span>{text.heroSecondary}</span></h1>
            <p>{text.heroBody}</p>
          </section>
        )}

        {error && <div className="alert" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError('')} aria-label={text.closeError}>×</button></div>}

        {!job ? (
          <form className="upload-card" onSubmit={(event) => void submit(event)}>
            <div
              className={`dropzone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !file && fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click() }}
            >
              <input ref={fileInput} type="file" accept={ACCEPTED} onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0] ?? null)} />
              {file ? (
                <div className="selected-file">
                  <div className="file-icon">{file.name.split('.').pop()?.slice(0, 4).toUpperCase()}</div>
                  <div><strong>{file.name}</strong><span>{formatFileSize(file.size)}</span></div>
                  <button type="button" onClick={(event) => { event.stopPropagation(); chooseFile(null) }} aria-label={text.removeFile}>×</button>
                </div>
              ) : (
                <div className="drop-content">
                  <div className="upload-icon" aria-hidden="true">↑</div>
                  <strong>{text.dropFile}</strong>
                  <span>{text.chooseFile}</span>
                  <small>{text.formats}</small>
                </div>
              )}
            </div>

            <details className="settings">
              <summary><span>{text.settings}</span><small>{text.settingsHint}</small></summary>
              <div className="settings-grid">
                <label>{text.renderQuality}
                  <select value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
                    <option value={150}>{text.fast}</option>
                    <option value={200}>{text.balanced}</option>
                    <option value={300}>{text.maximum}</option>
                  </select>
                </label>
                <label>{text.parallelPages}
                  <select value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))}>
                    {[1, 2, 3, 4].map((value) => <option value={value} key={value}>{value}</option>)}
                  </select>
                </label>
                <label>{text.outputLimit}
                  <select value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))}>
                    <option value={4096}>4,096 tokens</option>
                    <option value={8192}>8,192 tokens</option>
                    <option value={16384}>16,384 tokens</option>
                    <option value={32768}>32,768 tokens</option>
                  </select>
                </label>
              </div>
            </details>
            <button className="primary-button" type="submit" disabled={!file || uploading}>
              {uploading ? text.uploading : text.startOcr}<span>→</span>
            </button>
          </form>
        ) : (
          <section className="workspace">
            <div className="job-header">
              <div><p className="eyebrow">{text.currentJob}</p><h2>{job.filename}</h2><span>{jobMessage(job, language)}</span></div>
              <div className="job-actions">
                {busy && <button className="secondary-button" onClick={() => void cancel()}>{text.cancel}</button>}
                {!busy && <button className="secondary-button" onClick={reset}>{text.newFile}</button>}
              </div>
            </div>
            <div className="progress-track"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
            <div className="metrics">
              <span><strong>{Math.round(job.progress * 100)}%</strong> {text.progress}</span>
              <span><strong>{job.completed_pages + job.failed_pages}/{job.total_pages || '—'}</strong> {text.pages}</span>
              {job.total_pages > 0 && <span className="current-page"><strong>{text.page} {activePage}</strong> / {job.total_pages}</span>}
              <span className={`status-pill status-${job.status}`}>{statusLabel(job.status, language)}</span>
            </div>

            {job.error && <div className="inline-error">{job.error}</div>}

            <div className="result-panel">
              <div className="result-toolbar">
                <div className="view-tabs">
                  <button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>{text.preview}</button>
                  <button className={view === 'source' ? 'active' : ''} onClick={() => setView('source')}>{text.markdown}</button>
                </div>
                <div className="export-actions">
                  <button disabled={!hasResult} onClick={() => void copyResult()}>{copied ? text.copied : text.copy}</button>
                  {hasResult && job.id && <>
                    <a href={`/api/jobs/${job.id}/export?format=markdown`}>.md</a>
                    <a href={`/api/jobs/${job.id}/export?format=text`}>.txt</a>
                    <a href={`/api/jobs/${job.id}/export?format=json`}>.json</a>
                  </>}
                </div>
              </div>
              {job.total_pages > 1 && (
                <div className="page-strip" ref={pageStrip} aria-label={text.pages}>
                  {job.pages.map((page) => (
                    <button
                      type="button"
                      key={page.page}
                      data-page-button={page.page}
                      className={`page-dot ${page.status} ${activePage === page.page ? 'active' : ''}`}
                      aria-current={activePage === page.page ? 'page' : undefined}
                      aria-label={`${text.page} ${page.page}`}
                      onClick={() => selectPage(page.page)}
                    >{page.page}</button>
                  ))}
                </div>
              )}
              <div className={`result-content ${view}`} ref={resultContent} onScroll={trackPreviewPage}>
                {!hasResult && busy && <div className="result-empty"><i /><p>{text.analyzing}</p><span>{text.streamingHint}</span></div>}
                {!hasResult && !busy && <div className="result-empty"><p>{text.noText}</p></div>}
                {hasResult && view === 'preview' && (
                  <div className="result-pages">
                    {job.pages.filter((page) => page.markdown || page.status !== 'pending').map((page) => (
                      <section className={`result-page ${activePage === page.page ? 'active' : ''}`} data-result-page={page.page} key={page.page}>
                        <div className="result-page-label"><span>{text.page} {page.page}</span>{page.elapsed_seconds !== null && <small>{page.elapsed_seconds.toFixed(1)} s</small>}</div>
                        {page.error && <div className="inline-error">{page.error}</div>}
                        <article className="markdown">
                          {page.markdown && <Suspense fallback={<span className="rendering-preview" />}><MarkdownPreview>{page.markdown}</MarkdownPreview></Suspense>}
                          {page.status === 'processing' && <span className="cursor" />}
                        </article>
                      </section>
                    ))}
                  </div>
                )}
                {hasResult && view === 'source' && <pre>{result}<span className={busy ? 'cursor' : ''} /></pre>}
              </div>
            </div>
          </section>
        )}
      </main>

      {!job && <footer><span>Open OCR Control</span><span>{text.processingLocal}</span><a href="/api/docs">{text.api}</a></footer>}
    </div>
  )
}

export default App
