/**
 * A tiny PDF writer for test fixtures: text in the standard Helvetica fonts at exact positions, and optionally one
 * JPEG image per page (a "scanned" page). Real PDF syntax with a correct xref table, so pdf.js parses it normally.
 */
export interface PdfText {
  x: number
  y: number
  size: number
  text: string
  bold?: boolean
}
export interface PdfPage {
  width?: number
  height?: number
  texts?: PdfText[]
  /** JPEG bytes drawn at (x, y) with size (dw, dh) in points; w and h are the pixel size */
  image?: { jpeg: Buffer; w: number; h: number; x: number; y: number; dw: number; dh: number }
}

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

export function makePdf(pages: PdfPage[], title = 'Test document'): Buffer {
  const objs: (string | Buffer)[] = []
  const add = (body: string | Buffer): number => (objs.push(body), objs.length)
  const catalog = add('')
  const pagesObj = add('')
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const info = add(`<< /Title (${esc(title)}) /Producer (Dahl Studio tests) >>`)
  const kids: number[] = []
  for (const p of pages) {
    const W = p.width ?? 612
    const H = p.height ?? 792
    const ops: string[] = []
    let xobj = ''
    if (p.image) {
      const im = p.image
      const head = `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`
      const id = add(Buffer.concat([Buffer.from(head, 'latin1'), im.jpeg, Buffer.from('\nendstream', 'latin1')]))
      xobj = ` /XObject << /Im1 ${id} 0 R >>`
      ops.push(`q ${im.dw} 0 0 ${im.dh} ${im.x} ${im.y} cm /Im1 Do Q`)
    }
    for (const t of p.texts ?? []) ops.push(`BT /${t.bold ? 'F2' : 'F1'} ${t.size} Tf ${t.x} ${t.y} Td (${esc(t.text)}) Tj ET`)
    const stream = ops.join('\n')
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobj} >> /Contents ${content} 0 R >>`))
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  let offset = chunks[0].length
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(offset)
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), typeof o === 'string' ? Buffer.from(o, 'latin1') : o, Buffer.from('\nendobj\n', 'latin1')])
    chunks.push(b)
    offset += b.length
  })
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('')
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'))
  return Buffer.concat(chunks)
}
