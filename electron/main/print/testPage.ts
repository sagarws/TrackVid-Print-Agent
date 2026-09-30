/**
 * A one-page PDF for the "Test print" button, built by hand so the agent needs
 * no PDF library. 4 × 6 in — the usual shipping-label size — with a few lines
 * of Helvetica, which every PDF reader has built in.
 */
export const buildTestPdf = (printer: string, when: Date): Buffer => {
  const escape = (text: string) => text.replace(/[\\()]/g, match => `\\${match}`).replace(/[^\x20-\x7e]/g, '?')
  const lines = [
    { size: 20, text: 'TrackVid Print Agent' },
    { size: 12, text: 'Test page' },
    { size: 10, text: `Printer: ${printer}` },
    { size: 10, text: `Sent: ${when.toLocaleString()}` },
    { size: 10, text: 'If you can read this, printing works.' }
  ]
  let y = 380
  const content = lines
    .map(({ size, text }) => {
      const op = `BT /F1 ${size} Tf 24 ${y} Td (${escape(text)}) Tj ET`
      y -= size + 14
      return op
    })
    .join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}
