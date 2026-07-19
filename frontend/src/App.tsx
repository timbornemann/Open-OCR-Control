import { ChangeEvent, DragEvent, FormEvent, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COPY, LANGUAGE_STORAGE_KEY, batchMessage, initialLanguage, jobMessage, modelMessage, statusLabel, type Language } from './i18n'
import type { Batch, Job, OcrStatus, PageAsset, PageResult } from './types'
import { combinePages, combineRawPages, formatFileSize, parseEvent } from './utils'

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.doc,.docx,.odt,.rtf,.ppt,.pptx,.xls,.xlsx,.ods'
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const MarkdownPreview = lazy(() => import('./MarkdownPreview'))
export const SESSION_STORAGE_KEY = 'open-ocr-control-session'

function fileIdentity(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`
}

type StoredSession =
  | { kind: 'job'; id: string }
  | { kind: 'batch'; id: string; selected_job_id: string | null }

function readStoredSession(): StoredSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? 'null') as Partial<StoredSession> | null
    if (!parsed || typeof parsed.id !== 'string') return null
    if (parsed.kind === 'job') return { kind: 'job', id: parsed.id }
    if (parsed.kind === 'batch') {
      return {
        kind: 'batch',
        id: parsed.id,
        selected_job_id: typeof parsed.selected_job_id === 'string' ? parsed.selected_job_id : null,
      }
    }
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY)
  }
  return null
}

function storeSession(session: StoredSession | null): void {
  if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_STORAGE_KEY)
}

function emptyPage(page: number): PageResult {
  return { page, status: 'pending', markdown: '', raw_markdown: '', assets: [], error: null, elapsed_seconds: null }
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
  const [files, setFiles] = useState<File[]>([])
  const [uploadMode, setUploadMode] = useState<'single' | 'batch'>('single')
  const [job, setJob] = useState<Job | null>(null)
  const [batch, setBatch] = useState<Batch | null>(null)
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
  const [storedSession] = useState<StoredSession | null>(() => readStoredSession())
  const [sessionReady, setSessionReady] = useState(() => storedSession === null)
  const eventSource = useRef<EventSource | null>(null)
  const selectedJobId = useRef<string | null>(null)
  const batchState = useRef<Batch | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const pageStrip = useRef<HTMLDivElement | null>(null)
  const resultContent = useRef<HTMLDivElement | null>(null)
  const text = COPY[language]

  useEffect(() => {
    selectedJobId.current = job?.id ?? null
  }, [job?.id])

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
      if (selectedJobId.current !== job.id) return
      setActivePage(Math.min(Math.max(job.completed_pages + job.failed_pages, 1), job.total_pages))
    }
  }, [job?.completed_pages, job?.failed_pages, job?.id, job?.status, job?.total_pages])

  const mutateJob = useCallback((jobId: string, update: (value: Job) => Job) => {
    setJob((current) => current?.id === jobId ? update(current) : current)
    setBatch((current) => {
      if (!current) return current
      const next = {
        ...current,
        jobs: current.jobs.map((item) => item.id === jobId ? update(item) : item),
      }
      batchState.current = next
      return next
    })
  }, [])

  const updatePage = useCallback((jobId: string, pageNumber: number, update: (page: PageResult) => PageResult) => {
    mutateJob(jobId, (current) => {
      const pages = [...current.pages]
      while (pages.length < Math.max(current.total_pages, pageNumber)) pages.push(emptyPage(pages.length + 1))
      pages[pageNumber - 1] = update(pages[pageNumber - 1])
      return { ...current, pages }
    })
  }, [mutateJob])

  const loadJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/jobs/${jobId}`)
    if (response.ok) {
      const loaded = (await response.json()) as Job
      mutateJob(jobId, () => loaded)
    }
  }, [mutateJob])

  const loadBatch = useCallback(async (batchId: string) => {
    const response = await fetch(`/api/batches/${batchId}`)
    if (!response.ok) return
    const loaded = (await response.json()) as Batch
    batchState.current = loaded
    setBatch(loaded)
    const selected = loaded.jobs.find((item) => item.id === selectedJobId.current)
      ?? loaded.jobs[0]
      ?? null
    selectedJobId.current = selected?.id ?? null
    setJob(selected)
  }, [])

  const handleJobEvent = useCallback((jobId: string, name: string, payload: unknown) => {
    if (name === 'job_status' || name === 'job_progress') {
      const data = payload as Partial<Job>
      mutateJob(jobId, (current) => {
        const total = data.total_pages ?? current.total_pages
        const pages = [...current.pages]
        while (pages.length < total) pages.push(emptyPage(pages.length + 1))
        return { ...current, ...data, pages }
      })
      return
    }
    if (name === 'page_started') {
      const data = payload as { page: number }
      if (selectedJobId.current === jobId) setActivePage(data.page)
      updatePage(jobId, data.page, (page) => ({ ...page, status: 'processing' }))
      return
    }
    if (name === 'page_delta') {
      const data = payload as { page: number; delta: string }
      updatePage(jobId, data.page, (page) => ({ ...page, markdown: page.markdown + data.delta }))
      return
    }
    if (name === 'page_completed') {
      const data = payload as {
        page: number
        markdown: string
        raw_markdown: string
        assets: PageAsset[]
        elapsed_seconds: number
      }
      updatePage(jobId, data.page, (page) => ({
        ...page,
        status: 'completed',
        markdown: data.markdown,
        raw_markdown: data.raw_markdown,
        assets: data.assets,
        elapsed_seconds: data.elapsed_seconds,
      }))
      return
    }
    if (name === 'page_failed') {
      const data = payload as { page: number; error: string }
      updatePage(jobId, data.page, (page) => ({ ...page, status: 'failed', error: data.error }))
    }
  }, [mutateJob, updatePage])

  const connectEvents = useCallback((jobId: string, lastEventId = 0) => {
    eventSource.current?.close()
    const source = new EventSource(`/api/jobs/${jobId}/events?after_event_id=${lastEventId}`)
    eventSource.current = source

    for (const name of ['job_status', 'job_progress', 'page_started', 'page_delta', 'page_completed', 'page_failed']) {
      source.addEventListener(name, (event) => handleJobEvent(jobId, name, parseEvent<unknown>(event)))
    }
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
  }, [handleJobEvent, loadJob, refreshOcr])

  const connectBatchEvents = useCallback((batchId: string, lastEventId = 0) => {
    eventSource.current?.close()
    const source = new EventSource(`/api/batches/${batchId}/events?after_event_id=${lastEventId}`)
    eventSource.current = source

    const updateBatch = (event: Event) => {
      const data = parseEvent<Partial<Batch>>(event)
      const current = batchState.current
      if (!current) return
      const activeJobChanged = data.current_job_id !== undefined
        && data.current_job_id !== current.current_job_id
      const next = { ...current, ...data, jobs: current.jobs }
      batchState.current = next
      setBatch(next)

      if (activeJobChanged && data.current_job_id) {
        const activeJob = next.jobs.find((item) => item.id === data.current_job_id)
        if (activeJob) {
          selectedJobId.current = activeJob.id
          setJob(activeJob)
          setActivePage(1)
          setView('preview')
        }
      }
    }
    for (const name of ['batch_status', 'batch_progress']) source.addEventListener(name, updateBatch)
    source.addEventListener('job_event', (event) => {
      const data = parseEvent<{ job_id: string; event: string; data: unknown }>(event)
      handleJobEvent(data.job_id, data.event, data.data)
    })
    for (const name of ['completed', 'failed', 'cancelled']) {
      source.addEventListener(name, () => {
        source.close()
        void loadBatch(batchId)
        void refreshOcr()
      })
    }
    source.onerror = () => {
      // Native EventSource reconnects automatically while a batch is active.
    }
  }, [handleJobEvent, loadBatch, refreshOcr])

  useEffect(() => {
    if (!storedSession) return
    let active = true

    const restore = async () => {
      try {
        const response = await fetch(
          storedSession.kind === 'batch'
            ? `/api/batches/${storedSession.id}`
            : `/api/jobs/${storedSession.id}`,
        )
        if (!active) return
        if (!response.ok) {
          if (response.status === 404) storeSession(null)
          return
        }
        if (storedSession.kind === 'batch') {
          const restored = (await response.json()) as Batch
          if (!active) return
          const selected = restored.jobs.find((item) => item.id === storedSession.selected_job_id)
            ?? restored.jobs[0]
            ?? null
          batchState.current = restored
          setBatch(restored)
          setJob(selected)
          selectedJobId.current = selected?.id ?? null
          if (!TERMINAL.has(restored.status)) connectBatchEvents(restored.id, restored.last_event_id)
        } else {
          const restored = (await response.json()) as Job
          if (!active) return
          setBatch(null)
          batchState.current = null
          setJob(restored)
          selectedJobId.current = restored.id
          if (!TERMINAL.has(restored.status)) connectEvents(restored.id, restored.last_event_id)
        }
      } catch {
        // Keep the stored ID so a later reload can retry when the server is reachable again.
      } finally {
        if (active) setSessionReady(true)
      }
    }

    void restore()
    return () => { active = false }
  }, [connectBatchEvents, connectEvents, storedSession])

  useEffect(() => {
    if (!sessionReady) return
    if (batch && job) {
      storeSession({ kind: 'batch', id: batch.id, selected_job_id: job.id })
    } else if (job) {
      storeSession({ kind: 'job', id: job.id })
    } else {
      storeSession(null)
    }
  }, [batch?.id, job?.id, sessionReady])

  const chooseFiles = (selected: File[]) => {
    storeSession(null)
    setError('')
    setJob(null)
    batchState.current = null
    setBatch(null)
    setFiles((current) => {
      if (uploadMode === 'single') return selected.slice(0, 1)
      const known = new Set(current.map(fileIdentity))
      const added = selected.filter((file) => {
        const identity = fileIdentity(file)
        if (known.has(identity)) return false
        known.add(identity)
        return true
      })
      return [...current, ...added]
    })
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    chooseFiles(Array.from(event.dataTransfer.files))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (files.length === 0) return
    setUploading(true)
    setError('')
    const body = new FormData()
    if (uploadMode === 'batch') {
      for (const selected of files) body.append('files', selected)
    } else {
      body.append('file', files[0])
    }
    body.append('dpi', String(dpi))
    body.append('page_concurrency', String(concurrency))
    body.append('max_tokens', String(maxTokens))
    try {
      const response = await fetch(uploadMode === 'batch' ? '/api/batches' : '/api/jobs', { method: 'POST', body })
      if (!response.ok) throw new Error(await apiError(response))
      setActivePage(1)
      if (uploadMode === 'batch') {
        const created = (await response.json()) as Batch
        batchState.current = created
        setBatch(created)
        setJob(created.jobs[0] ?? null)
        selectedJobId.current = created.jobs[0]?.id ?? null
        storeSession({ kind: 'batch', id: created.id, selected_job_id: created.jobs[0]?.id ?? null })
        connectBatchEvents(created.id, created.last_event_id)
      } else {
        const created = (await response.json()) as Job
        batchState.current = null
        setBatch(null)
        setJob(created)
        selectedJobId.current = created.id
        storeSession({ kind: 'job', id: created.id })
        connectEvents(created.id, created.last_event_id)
      }
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
    const response = await fetch(batch ? `/api/batches/${batch.id}` : `/api/jobs/${job.id}`, { method: 'DELETE' })
    if (response.ok) {
      if (batch) {
        const cancelled = (await response.json()) as Batch
        batchState.current = cancelled
        setBatch(cancelled)
        const selected = cancelled.jobs.find((item) => item.id === job.id)
          ?? cancelled.jobs[0]
          ?? null
        selectedJobId.current = selected?.id ?? null
        setJob(selected)
      } else {
        setJob((await response.json()) as Job)
      }
    }
    eventSource.current?.close()
  }

  const result = useMemo(() => combinePages(job?.pages ?? []), [job?.pages])
  const rawResult = useMemo(() => combineRawPages(job?.pages ?? []), [job?.pages])
  const busy = batch ? !TERMINAL.has(batch.status) : job ? !TERMINAL.has(job.status) : false
  const hasResult = result.length > 0
  const batchHasResult = batch?.jobs.some((item) => combinePages(item.pages).length > 0) ?? false

  const copyResult = async () => {
    await navigator.clipboard.writeText(rawResult)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const reset = () => {
    eventSource.current?.close()
    storeSession(null)
    batchState.current = null
    setJob(null)
    setBatch(null)
    setFiles([])
    setError('')
    setCopied(false)
    setActivePage(1)
    setView('preview')
    if (fileInput.current) fileInput.current.value = ''
  }

  const selectJob = (selected: Job) => {
    selectedJobId.current = selected.id
    setJob(selected)
    setActivePage(1)
    setView('preview')
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

      <main className={sessionReady && job ? 'job-main' : 'landing-main'}>
        {sessionReady && !job && (
          <section className="intro">
            <p className="eyebrow">{text.eyebrow}</p>
            <h1>{text.heroPrimary}<br /><span>{text.heroSecondary}</span></h1>
            <p>{text.heroBody}</p>
          </section>
        )}

        {error && <div className="alert" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError('')} aria-label={text.closeError}>×</button></div>}

        {!sessionReady ? (
          <section className="restore-session" aria-live="polite">
            <i />
            <p>{text.restoringSession}</p>
          </section>
        ) : !job ? (
          <form className="upload-card" onSubmit={(event) => void submit(event)}>
            <div className="upload-mode" role="group" aria-label={text.files}>
              <button
                type="button"
                className={uploadMode === 'single' ? 'active' : ''}
                aria-pressed={uploadMode === 'single'}
                onClick={() => { setUploadMode('single'); setFiles([]); if (fileInput.current) fileInput.current.value = '' }}
              >{text.singleMode}</button>
              <button
                type="button"
                className={uploadMode === 'batch' ? 'active' : ''}
                aria-pressed={uploadMode === 'batch'}
                onClick={() => { setUploadMode('batch'); setFiles([]); if (fileInput.current) fileInput.current.value = '' }}
              >{text.batchMode}</button>
            </div>
            <div
              className={`dropzone ${dragging ? 'is-dragging' : ''} ${files.length > 0 ? 'has-file' : ''}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => (files.length === 0 || uploadMode === 'batch') && fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click() }}
            >
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED}
                multiple={uploadMode === 'batch'}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  chooseFiles(Array.from(event.target.files ?? []))
                  event.currentTarget.value = ''
                }}
              />
              {files.length > 0 ? (
                <div className="selected-files">
                  {files.map((selected, index) => (
                    <div className="selected-file" key={`${selected.name}-${selected.size}-${index}`}>
                      <div className="file-icon">{selected.name.split('.').pop()?.slice(0, 4).toUpperCase()}</div>
                      <div><strong>{selected.name}</strong><span>{formatFileSize(selected.size)}</span></div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                        }}
                        aria-label={`${text.removeFile}: ${selected.name}`}
                      >×</button>
                    </div>
                  ))}
                  {uploadMode === 'batch' && (
                    <button
                      type="button"
                      className="add-files"
                      aria-label={text.addFiles}
                      onClick={(event) => {
                        event.stopPropagation()
                        fileInput.current?.click()
                      }}
                    >
                      <span aria-hidden="true">+</span>
                      <span><strong>{text.addFiles}</strong><small>{text.dropMoreFiles}</small></span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="drop-content">
                  <div className="upload-icon" aria-hidden="true">↑</div>
                  <strong>{uploadMode === 'batch' ? text.dropFiles : text.dropFile}</strong>
                  <span>{uploadMode === 'batch' ? text.chooseFiles : text.chooseFile}</span>
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
            <button className="primary-button" type="submit" disabled={files.length === 0 || uploading}>
              {uploading ? text.uploading : uploadMode === 'batch' ? text.startBatch : text.startOcr}<span>→</span>
            </button>
          </form>
        ) : (
          <section className="workspace">
            {batch && (
              <div className="document-tabs" role="tablist" aria-label={text.files}>
                {batch.jobs.map((item, index) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={item.id === job.id}
                    className={`${item.id === job.id ? 'active' : ''} status-${item.status}`}
                    onClick={() => selectJob(item)}
                    key={item.id}
                    title={item.filename}
                  >
                    <i />
                    <span>{index + 1}. {item.filename}</span>
                  </button>
                ))}
                {batchHasResult && (
                  <a className="batch-export" href={`/api/batches/${batch.id}/export`}>
                    {text.allResultsZip}
                  </a>
                )}
              </div>
            )}
            <div className="job-header">
              <div>
                <p className="eyebrow">{batch ? `${text.currentBatch} · ${batch.completed_files + batch.failed_files}/${batch.total_files}` : text.currentJob}</p>
                <h2>{job.filename}</h2>
                <span>{batch ? batchMessage(batch, language) : jobMessage(job, language)}</span>
              </div>
              <div className="job-actions">
                {busy && <button className="secondary-button" onClick={() => void cancel()}>{text.cancel}</button>}
                {!busy && <button className="secondary-button" onClick={reset}>{text.newFile}</button>}
              </div>
            </div>
            <div className="progress-track"><i style={{ width: `${Math.round((batch?.progress ?? job.progress) * 100)}%` }} /></div>
            <div className="metrics">
              <span><strong>{Math.round((batch?.progress ?? job.progress) * 100)}%</strong> {text.progress}</span>
              {batch && <span><strong>{batch.completed_files + batch.failed_files}/{batch.total_files}</strong> {text.files}</span>}
              <span><strong>{job.completed_pages + job.failed_pages}/{job.total_pages || '—'}</strong> {text.pages}</span>
              {job.total_pages > 0 && <span className="current-page"><strong>{text.page} {activePage}</strong> / {job.total_pages}</span>}
              <span className={`status-pill status-${batch?.status ?? job.status}`}>{statusLabel(batch?.status ?? job.status, language)}</span>
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
                    <a href={`/api/jobs/${job.id}/export?format=markdown`}>{text.rawMarkdown}</a>
                    <a href={`/api/jobs/${job.id}/export?format=complete`}>{text.completeZip}</a>
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
                {hasResult && view === 'source' && <pre>{rawResult}<span className={busy ? 'cursor' : ''} /></pre>}
              </div>
            </div>
          </section>
        )}
      </main>

      {sessionReady && !job && <footer><span>Open OCR Control</span><span>{text.processingLocal}</span><a href="/api/docs">{text.api}</a></footer>}
    </div>
  )
}

export default App
