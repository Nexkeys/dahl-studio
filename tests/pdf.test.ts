import { afterAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { makePdf, type PdfText } from './pdfFixture'
import { parsePageRange, readPdf } from '../src/main/pdf/read'
import { openPdf } from '../src/main/pdf/pdfjs'
import { readImage } from '../src/main/ocr/read'
import { windowsOcrHelper } from '../src/main/ocr/windowsOcr'

afterAll(() => windowsOcrHelper.kill())

const para = (x: number, y: number, lines: string[], size = 11): PdfText[] => lines.map((text, i) => ({ x, y: y - i * 14, size, text }))

/** A report page: title across the page, two columns (heading, paragraph, list), then a table across both columns. */
function reportPdf(): Buffer {
  const texts: PdfText[] = [
    { x: 72, y: 740, size: 24, text: 'Annual Report 2026', bold: true },
    { x: 72, y: 700, size: 14, text: 'Introduction', bold: true },
    ...para(72, 680, ['Northwind grew in every region this', 'year, and costs stayed flat. The', 'board approved two new products.']),
    { x: 72, y: 630, size: 11, text: '• Revenue rose by twelve percent' },
    { x: 72, y: 616, size: 11, text: '• Three new offices opened' },
    { x: 320, y: 700, size: 14, text: 'Outlook', bold: true },
    ...para(320, 680, ['Next year the focus moves to', 'service quality and to exports', 'in Latin America.']),
    { x: 72, y: 540, size: 14, text: 'Sales by product', bold: true }
  ]
  const rows = [['Product', 'Units', 'Price'], ['Widget', '1,200', '9.50'], ['Gadget', '860', '14.00'], ['Gizmo', '415', '22.75']]
  rows.forEach((r, i) => r.forEach((c, k) => texts.push({ x: 72 + k * 160, y: 510 - i * 18, size: 10, text: c, bold: i === 0 })))
  return makePdf([{ texts }], 'Northwind annual report')
}

async function scannedPage(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500"><rect width="100%" height="100%" fill="white"/><text x="60" y="140" font-family="Arial" font-size="56">Scanned invoice 4471</text><text x="60" y="300" font-family="Arial" font-size="48">Total due 1250 EUR</text></svg>`
  const jpeg = await sharp(Buffer.from(svg)).flatten({ background: '#fff' }).jpeg({ quality: 90 }).toBuffer()
  return makePdf([{ texts: [{ x: 72, y: 740, size: 12, text: 'Page one has a text layer.' }] }, { image: { jpeg, w: 1200, h: 500, x: 50, y: 300, dw: 510, dh: 212 } }], 'Scan')
}

describe('PDF reading', () => {
  it('rebuilds reading order, headings, a list and a table, with metadata', async () => {
    const md = await readPdf(reportPdf(), 'report.pdf')
    expect(md).toContain('Title: Northwind annual report | Pages: 1')
    expect(md).toContain('# Annual Report 2026')
    expect(md).toContain('## Introduction')
    expect(md).toContain('Northwind grew in every region this year, and costs stayed flat. The board approved two new products.')
    expect(md).toContain('- Revenue rose by twelve percent\n- Three new offices opened')
    // the left column is read before the right one
    expect(md.indexOf('Three new offices')).toBeLessThan(md.indexOf('## Outlook'))
    expect(md).toContain('| Product | Units | Price |\n| --- | --- | --- |\n| Widget | 1,200 | 9.50 |')
    expect(md).toContain('| Gizmo | 415 | 22.75 |')
  }, 180_000)

  it('finds a scanned page and reads it with OCR (stubbed), from a real rendering', async () => {
    let rendered: { width: number; height: number; dark: number } | null = null
    const md = await readPdf(await scannedPage(), 'scan.pdf', {
      ocr: async (png) => {
        const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
        rendered = { width: info.width, height: info.height, dark: data.filter((v) => v < 100).length }
        return 'Scanned invoice 4471'
      }
    })
    expect(md).toContain('## Page 1 of 2\n\nPage one has a text layer.')
    expect(md).toContain('(Scanned page: the text below was read with OCR.')
    expect(md).toContain('Scanned invoice 4471')
    expect(rendered!.width).toBeGreaterThanOrEqual(1500) // rendered at about 2000 px wide for OCR
    expect(rendered!.dark).toBeGreaterThan(1000) // the scanned text is really in the rendering
  }, 180_000)

  it.skipIf(process.platform !== 'win32')('reads a scanned page with the real OCR pipeline', async () => {
    const md = await readPdf(await scannedPage(), 'scan.pdf', { pages: '2', ocr: async (png, signal) => (await readImage(png, { signal })).text })
    expect(md).toMatch(/Scanned invoice 4471/)
    expect(md).toMatch(/Total due 1250 EUR/)
  }, 180_000)

  it('gives an overview of a long PDF and reads page ranges on request', async () => {
    const pages = Array.from({ length: 14 }, (_, i) => ({ texts: [{ x: 72, y: 740, size: 18, text: `Chapter ${i + 1}` }, { x: 72, y: 700, size: 11, text: `Body text of page ${i + 1}.` }] }))
    const pdf = makePdf(pages, 'Book')
    const overview = await readPdf(pdf, 'book.pdf')
    expect(overview).toContain('Pages: 14')
    expect(overview).toContain('p14: Chapter 14')
    expect(overview).toContain('## Page 3 of 14')
    expect(overview).not.toContain('## Page 4 of 14')
    expect(overview).toContain('Call read_pdf with a page range')
    const some = await readPdf(pdf, 'book.pdf', { pages: '13-14' })
    expect(some).toContain('Body text of page 13.')
    expect(some).toContain('Body text of page 14.')
    expect(some).not.toContain('Body text of page 12.')
    const cut = await readPdf(pdf, 'book.pdf', { pages: '1-14', maxChars: 600 })
    expect(cut).toMatch(/Stopped before page \d+ .*Call read_pdf with pages "\d+-\d+"/)
  }, 120_000)

  it('parses page ranges and rejects bad ones', () => {
    expect(parsePageRange('2,4,7-9', 20)).toEqual([2, 4, 7, 8, 9])
    expect(parsePageRange('18-', 20)).toEqual([18, 19, 20])
    expect(parsePageRange('', 5)).toEqual([])
    expect(() => parsePageRange('abc', 5)).toThrow(/Invalid page range/)
    expect(() => parsePageRange('9-12', 5)).toThrow(/has 5 pages/)
  }, 120_000)

  it('reports a broken file clearly', async () => {
    await expect(openPdf(Buffer.from('this is not a pdf at all'))).rejects.toThrow(/not a valid PDF|could not be opened/)
  })
})
