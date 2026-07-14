import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MarkdownPreview from './MarkdownPreview'

describe('MarkdownPreview', () => {
  it('renders raw HTML tables and LaTeX inside their cells', () => {
    const { container } = render(
      <MarkdownPreview>{'<table><tr><td>\\( x_{i} \\)</td><td>Code</td></tr><tr><td>\\( x_{1} \\)</td><td>00000</td></tr></table>'}</MarkdownPreview>,
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Code')).toBeInTheDocument()
    expect(screen.getByText('00000')).toBeInTheDocument()
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
  })

  it('renders OCR-style prose math and strips unsafe HTML', () => {
    const { container } = render(
      <MarkdownPreview>{'For every edge ( w(e) ), its length is [ w(K) = w(v_0, v_1) + \\dots ].<script>window.bad = true</script><span style="color:red" onclick="bad()">safe</span>'}</MarkdownPreview>,
    )

    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelector('script')).not.toBeInTheDocument()
    const safe = screen.getByText('safe')
    expect(safe).not.toHaveAttribute('style')
    expect(safe).not.toHaveAttribute('onclick')
  })

  it('preserves explicit intent for simple formulas without altering code', () => {
    const { container } = render(<MarkdownPreview>{'\\(x\\) and `\\(literal\\)`'}</MarkdownPreview>)

    expect(container.querySelectorAll('.katex')).toHaveLength(1)
    expect(screen.getByText('\\(literal\\)')).toBeInTheDocument()
  })
})
