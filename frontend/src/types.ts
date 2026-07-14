export type JobStatus =
  | 'queued'
  | 'preparing'
  | 'waiting_for_ocr'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface PageResult {
  page: number
  status: string
  markdown: string
  error: string | null
  elapsed_seconds: number | null
}

export interface Job {
  id: string
  filename: string
  status: JobStatus
  message: string
  progress: number
  total_pages: number
  completed_pages: number
  failed_pages: number
  pages: PageResult[]
  error: string | null
}

export interface OcrStatus {
  state: string
  ready: boolean
  managed: boolean
  message: string
  model: string
  container_status: string | null
}

