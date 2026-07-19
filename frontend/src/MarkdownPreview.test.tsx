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
    const { container } = render(<MarkdownPreview>{'\\(x\\) and `\\(\\alpha_{literal}\\)`'}</MarkdownPreview>)

    expect(container.querySelectorAll('.katex')).toHaveLength(1)
    expect(screen.getByText('\\(\\alpha_{literal}\\)')).toBeInTheDocument()
  })

  it('renders OCR display formulas containing spaced subscripts as one formula', () => {
    const markdown = String.raw`where P denotes the prefix segment of length \( L_{m} \), which is globally visible to all subsequent tokens, and \( \mathcal{D}_{n}(t) \) denotes the causal sliding window of width n over the decode region. The attention weight from token t to position \( j \in \mathcal{N}(t) \) is then computed as
\[
\alpha_ {t j} = \frac {\exp \left(\frac {\mathbf {q} _ {t} ^ {\top} \mathbf {k} _ {j}}{\sqrt {d _ {k}}}\right)}{\sum_ {i \in \mathcal {N} (t)} \exp \left(\frac {\mathbf {q} _ {i} ^ {\top} \mathbf {k} _ {i}}{\sqrt {d _ {k}}}\right)}, \quad j \in \mathcal {N} (t), \tag {3}
\]
where \( q_{t} \), \( k_{j} \), and \( v_{j} \) are the query, key, and value vectors, respectively, and \( d_{k} \) is the dimension of the key-vector. The output representation is obtained by aggregating values over the same accessible set:
\[
\mathbf {o} _ {t} = \sum_ {j \in N (t)} \alpha_ {t j} \mathbf {v} _ {j}. \tag {4}
\]`
    const { container } = render(<MarkdownPreview>{markdown}</MarkdownPreview>)

    expect(container.querySelectorAll('.katex-display')).toHaveLength(2)
    expect(container.querySelectorAll('.katex-display br')).toHaveLength(0)
    expect(container.querySelector('.katex-error')).not.toBeInTheDocument()
    expect(container).not.toHaveTextContent('\\[')
    expect(container).not.toHaveTextContent('\\]')
  })

  it('preserves single OCR line breaks in contents and reference paragraphs', () => {
    const markdown = `Contents
1 Introduction 3
2 Related Works 4
2.1 Pipeline-based Framework 4

[31] W. Wang, Z. Gao, L. Gu, et al. Internv13.5. 2025.
[32] H. Wei, L. Kong, J. Chen, et al. Vary. 2024.
[33] H. Wei, C. Liu, J. Chen, et al. General OCR theory. 2024.`
    const { container } = render(<MarkdownPreview>{markdown}</MarkdownPreview>)
    const paragraphs = container.querySelectorAll('p')

    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0].querySelectorAll('br')).toHaveLength(3)
    expect(paragraphs[1].querySelectorAll('br')).toHaveLength(2)
    expect(paragraphs[0]).toHaveTextContent('Contents1 Introduction 32 Related Works 4')
    expect(paragraphs[1]).toHaveTextContent('[31] W. Wang')
    expect(paragraphs[1]).toHaveTextContent('[32] H. Wei')
    expect(paragraphs[1]).toHaveTextContent('[33] H. Wei')
  })

  it('renders same-origin extracted document images', () => {
    render(
      <MarkdownPreview>{'![Page image](/api/jobs/job-1/assets/page-0001-image-001.jpg)'}</MarkdownPreview>,
    )

    expect(screen.getByRole('img', { name: 'Page image' })).toHaveAttribute(
      'src',
      '/api/jobs/job-1/assets/page-0001-image-001.jpg',
    )
  })

  it('blocks model-provided external image sources', () => {
    render(<MarkdownPreview>{'![Remote](https://example.com/tracker.png)'}</MarkdownPreview>)

    expect(screen.queryByRole('img', { name: 'Remote' })).not.toBeInTheDocument()
  })
})
