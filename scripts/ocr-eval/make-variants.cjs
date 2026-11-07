// Adds blurry, downscaled variants (60% size, slight blur, JPEG quality 70) for six of the eval pages.
// Usage: node scripts/ocr-eval/make-variants.cjs <outDir>
const sharp = require('sharp')
const path = require('node:path')

const out = path.resolve(process.argv[2])
const names = ['login', 'dashboard', 'article', 'table', 'settings', 'dialog']
;(async () => {
  for (const n of names) {
    const src = path.join(out, `${n}-normal.png`)
    const meta = await sharp(src).metadata()
    const jpg = await sharp(src).resize(Math.round(meta.width * 0.6)).blur(0.5).jpeg({ quality: 70 }).toBuffer()
    await sharp(jpg).png().toFile(path.join(out, `${n}-blurry.png`))
  }
  console.log('blurry variants:', names.length)
})()
