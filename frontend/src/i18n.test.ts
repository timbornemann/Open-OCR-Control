import { describe, expect, it } from 'vitest'
import { initialLanguage, statusLabel } from './i18n'

describe('language selection', () => {
  it('defaults to English and restores German explicitly', () => {
    expect(initialLanguage({ getItem: () => null })).toBe('en')
    expect(initialLanguage({ getItem: () => 'de' })).toBe('de')
  })

  it('localizes job states', () => {
    expect(statusLabel('waiting_for_ocr', 'en')).toBe('Waiting for OCR')
    expect(statusLabel('waiting_for_ocr', 'de')).toBe('Warte auf OCR')
  })
})
