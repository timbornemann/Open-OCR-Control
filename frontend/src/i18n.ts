import type { Batch, Job, JobStatus, OcrStatus } from './types'

export type Language = 'en' | 'de'

export const LANGUAGE_STORAGE_KEY = 'open-ocr-control-language'

export const COPY = {
  en: {
    language: 'Language',
    english: 'English',
    german: 'German',
    checkingStatus: 'Checking model status…',
    modelReady: 'OCR model is ready',
    modelStarting: 'OCR model is starting…',
    modelStopped: 'OCR model is stopped',
    modelUnavailable: 'OCR model is unavailable',
    serverUnavailable: 'Application server is unreachable',
    start: 'Start',
    stop: 'Stop',
    eyebrow: 'LOCAL · PRIVATE · GPU-ACCELERATED',
    heroPrimary: 'Documents in.',
    heroSecondary: 'Structured text out.',
    heroBody: 'Turn PDFs, images, and Office documents into clean, structured text with Baidu Unlimited-OCR — entirely on this machine.',
    closeError: 'Dismiss error',
    removeFile: 'Remove file',
    singleMode: 'Single document',
    batchMode: 'Batch mode',
    dropFile: 'Drop a file here',
    dropFiles: 'Drop files here',
    chooseFile: 'or click to browse',
    chooseFiles: 'or click to select multiple files',
    formats: 'PDF · PNG · JPG · TIFF · DOCX · PPTX · XLSX · up to 100 MB',
    settings: 'Processing settings',
    settingsHint: 'Optimized for speed',
    renderQuality: 'Render quality',
    fast: 'Fast · 150 DPI',
    balanced: 'Balanced · 200 DPI',
    maximum: 'Maximum · 300 DPI',
    parallelPages: 'Parallel pages',
    outputLimit: 'Output limit',
    uploading: 'Uploading…',
    startOcr: 'Start OCR',
    startBatch: 'Start batch',
    uploadFailed: 'Upload failed',
    modelControlFailed: 'Could not control the OCR container',
    restoringSession: 'Restoring the current OCR session…',
    currentJob: 'CURRENT JOB',
    currentBatch: 'BATCH',
    cancel: 'Cancel',
    newFile: 'New file',
    progress: 'Progress',
    pages: 'Pages',
    page: 'Page',
    preview: 'Preview',
    markdown: 'Markdown',
    rawMarkdown: 'Raw .md',
    completeZip: 'Complete .zip',
    allResultsZip: 'All results .zip',
    copy: 'Copy',
    copied: 'Copied ✓',
    analyzing: 'Unlimited-OCR is analyzing the document…',
    streamingHint: 'Recognized text appears here live.',
    noText: 'No text was recognized.',
    processingLocal: 'Processing stays on this system.',
    api: 'API',
    files: 'Files',
  },
  de: {
    language: 'Sprache',
    english: 'Englisch',
    german: 'Deutsch',
    checkingStatus: 'Modellstatus wird geprüft…',
    modelReady: 'OCR-Modell ist bereit',
    modelStarting: 'OCR-Modell wird gestartet…',
    modelStopped: 'OCR-Modell ist gestoppt',
    modelUnavailable: 'OCR-Modell ist nicht erreichbar',
    serverUnavailable: 'App-Server ist nicht erreichbar',
    start: 'Starten',
    stop: 'Stoppen',
    eyebrow: 'LOKAL · PRIVAT · GPU-BESCHLEUNIGT',
    heroPrimary: 'Dokumente rein.',
    heroSecondary: 'Strukturierter Text raus.',
    heroBody: 'PDFs, Bilder und Office-Dokumente werden lokal mit Baidu Unlimited-OCR in sauberen, strukturierten Text verwandelt.',
    closeError: 'Fehler schließen',
    removeFile: 'Datei entfernen',
    singleMode: 'Einzeldokument',
    batchMode: 'Batch-Modus',
    dropFile: 'Datei hier ablegen',
    dropFiles: 'Dateien hier ablegen',
    chooseFile: 'oder zum Auswählen klicken',
    chooseFiles: 'oder mehrere Dateien auswählen',
    formats: 'PDF · PNG · JPG · TIFF · DOCX · PPTX · XLSX · bis 100 MB',
    settings: 'Verarbeitungseinstellungen',
    settingsHint: 'Für Geschwindigkeit optimiert',
    renderQuality: 'Renderqualität',
    fast: 'Schnell · 150 DPI',
    balanced: 'Ausgewogen · 200 DPI',
    maximum: 'Maximal · 300 DPI',
    parallelPages: 'Parallele Seiten',
    outputLimit: 'Ausgabelimit',
    uploading: 'Wird hochgeladen…',
    startOcr: 'OCR starten',
    startBatch: 'Batch starten',
    uploadFailed: 'Upload fehlgeschlagen',
    modelControlFailed: 'OCR-Container konnte nicht gesteuert werden',
    restoringSession: 'Aktuelle OCR-Sitzung wird wiederhergestellt…',
    currentJob: 'AKTUELLER AUFTRAG',
    currentBatch: 'BATCH',
    cancel: 'Abbrechen',
    newFile: 'Neue Datei',
    progress: 'Fortschritt',
    pages: 'Seiten',
    page: 'Seite',
    preview: 'Vorschau',
    markdown: 'Markdown',
    rawMarkdown: 'Roh-.md',
    completeZip: 'Vollständig .zip',
    allResultsZip: 'Alle Ergebnisse .zip',
    copy: 'Kopieren',
    copied: 'Kopiert ✓',
    analyzing: 'Unlimited-OCR analysiert das Dokument…',
    streamingHint: 'Erkannter Text erscheint hier live.',
    noText: 'Kein Text erkannt.',
    processingLocal: 'Die Verarbeitung bleibt auf diesem System.',
    api: 'API',
    files: 'Dateien',
  },
} as const

export function initialLanguage(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Language {
  return storage?.getItem(LANGUAGE_STORAGE_KEY) === 'de' ? 'de' : 'en'
}

export function modelMessage(status: OcrStatus | null, language: Language): string {
  const text = COPY[language]
  if (!status) return text.checkingStatus
  if (status.ready || status.state === 'ready') return text.modelReady
  if (status.state === 'starting') return text.modelStarting
  if (['stopped', 'missing', 'exited'].includes(status.state)) return text.modelStopped
  return text.modelUnavailable
}

const STATUS_LABELS: Record<Language, Record<JobStatus, string>> = {
  en: { queued: 'Queued', preparing: 'Preparing', waiting_for_ocr: 'Waiting for OCR', processing: 'Processing', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' },
  de: { queued: 'Warteschlange', preparing: 'Vorbereitung', waiting_for_ocr: 'Warte auf OCR', processing: 'Verarbeitung', completed: 'Abgeschlossen', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen' },
}

export function statusLabel(status: JobStatus, language: Language): string {
  return STATUS_LABELS[language][status]
}

export function jobMessage(job: Job, language: Language): string {
  const processed = job.completed_pages + job.failed_pages
  const total = job.total_pages || '—'
  const messages: Record<Language, Record<JobStatus, string>> = {
    en: {
      queued: 'Upload accepted. The document is queued.',
      preparing: 'Preparing pages for recognition…',
      waiting_for_ocr: 'Starting Unlimited-OCR…',
      processing: `${processed} of ${total} pages processed`,
      completed: `${job.completed_pages} page${job.completed_pages === 1 ? '' : 's'} processed successfully`,
      failed: 'The document could not be processed.',
      cancelled: 'Processing was cancelled.',
    },
    de: {
      queued: 'Upload angenommen. Das Dokument wartet auf Verarbeitung.',
      preparing: 'Seiten werden für die Erkennung vorbereitet…',
      waiting_for_ocr: 'Unlimited-OCR wird gestartet…',
      processing: `${processed} von ${total} Seiten verarbeitet`,
      completed: `${job.completed_pages} Seite${job.completed_pages === 1 ? '' : 'n'} erfolgreich verarbeitet`,
      failed: 'Das Dokument konnte nicht verarbeitet werden.',
      cancelled: 'Die Verarbeitung wurde abgebrochen.',
    },
  }
  return messages[language][job.status]
}

export function batchMessage(batch: Batch, language: Language): string {
  const finished = batch.completed_files + batch.failed_files
  if (language === 'de') {
    if (batch.status === 'queued') return 'Batch wurde angenommen.'
    if (batch.status === 'processing') return `${finished} von ${batch.total_files} Dateien verarbeitet`
    if (batch.status === 'completed') return `${batch.completed_files} Dateien erfolgreich verarbeitet`
    if (batch.status === 'cancelled') return 'Batch-Verarbeitung wurde abgebrochen.'
    return 'Der Batch konnte nicht verarbeitet werden.'
  }
  if (batch.status === 'queued') return 'The batch was accepted.'
  if (batch.status === 'processing') return `${finished} of ${batch.total_files} files processed`
  if (batch.status === 'completed') return `${batch.completed_files} files processed successfully`
  if (batch.status === 'cancelled') return 'Batch processing was cancelled.'
  return 'The batch could not be processed.'
}
