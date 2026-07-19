export type JobStatus =
  | 'queued'
  | 'preparing'
  | 'waiting_for_ocr'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type BatchStatus = Extract<JobStatus, 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'>

export interface PageAsset {
  filename: string
  media_type: string
  width: number
  height: number
}

export interface PageResult {
  page: number
  status: string
  markdown: string
  raw_markdown: string
  assets: PageAsset[]
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
  batch_id: string | null
  last_event_id: number
}

export interface Batch {
  id: string
  status: BatchStatus
  message: string
  progress: number
  total_files: number
  completed_files: number
  failed_files: number
  current_job_id: string | null
  last_event_id: number
  jobs: Job[]
}

export interface OcrStatus {
  state: string
  ready: boolean
  managed: boolean
  message: string
  model: string
  container_status: string | null
}
