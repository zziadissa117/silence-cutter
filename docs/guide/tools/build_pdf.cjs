// Prints docs/guide/cutter-guide.html to docs/guide/cutter-guide.pdf (A4),
// with the page numbers written into its contents.
//
//   node docs/guide/tools/build_pdf.cjs
//
// Needs Playwright's Chromium and python3 with pypdf (to read back which page
// each section starts on). Two passes: print, find the pages, print again.

const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const GUIDE = path.join(__dirname, '..')
const HTML = path.join(GUIDE, 'cutter-guide.html')
const PDF = path.join(GUIDE, 'cutter-guide.pdf')

const footer = `<div style="width:100%;font-family:Inter,Arial,sans-serif;font-size:7.5px;color:#9a97a8;padding:0 15mm;display:flex;justify-content:space-between">
  <span>The Cutter Guide</span><span class="pageNumber"></span></div>`

async function print(page, file) {
  await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer })
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('file://' + HTML, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  // The PDF carries smaller copies of the screenshots (JPEG, 1.5x - still over
  // 300 dpi at the size they print): the PNGs made it 16 MB, too much for a phone.
  const small = path.join(os.tmpdir(), `guide-shots-${process.pid}`)
  const used = await page.evaluate(() => [...new Set([...document.images].map((i) => i.getAttribute('src')).filter((src) => src.startsWith('shots/')))])
  execFileSync('python3', ['-c', `
import os, sys
from PIL import Image
src, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
os.makedirs(out, exist_ok=True)
for name in names:
    path = os.path.join(src, name)
    if not os.path.exists(path):
        continue
    im = Image.open(path).convert('RGB')
    im = im.resize((im.width * 3 // 4, im.height * 3 // 4), Image.LANCZOS)
    im.save(os.path.join(out, os.path.splitext(os.path.basename(name))[0] + '.jpg'), quality=84, optimize=True)
`, GUIDE, small, ...used])
  await page.evaluate((dir) => {
    for (const img of document.images) {
      const src = img.getAttribute('src')
      if (src.startsWith('shots/')) img.src = 'file://' + dir + '/' + src.slice(6).replace(/\.png$/, '.jpg')
    }
  }, small)
  await page.waitForFunction(() => [...document.images].every((i) => i.complete))
  // Every image loaded, or the build stops: a missing screenshot is a mistake.
  const missing = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')))
  if (missing.length && !process.env.DRAFT) throw new Error(`Missing screenshots: ${missing.join(', ')}`)
  // The numbered markers on the screenshots: a ring around each thing to tap and
  // its number, placed from shots/marks.json (written by tools/shots.cjs with the
  // screenshots). A figure's data-start is its first number. Every number a
  // lesson's steps use must be on one of its screenshots, and the other way round.
  const marks = JSON.parse(fs.readFileSync(path.join(GUIDE, 'shots', 'marks.json'), 'utf8'))
  const wrong = await page.evaluate((marks) => {
    const wrong = []
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
    const pct = (v) => `${(v * 100).toFixed(3)}%`
    for (const lesson of document.querySelectorAll('.lesson')) {
      const drawn = new Set()
      for (const fig of lesson.querySelectorAll('figure[data-shot]')) {
        const name = fig.dataset.shot
        const start = Number(fig.dataset.start || 1)
        const places = marks[name] || []
        if (!places.length) wrong.push(`${name}: no markers`)
        const frame = fig.querySelector('.frame')
        places.forEach((box, i) => {
          const n = start + i
          if (!box) return wrong.push(`${name}: marker ${n} not on screen`)
          drawn.add(n)
          const padX = 4 / 390
          const padY = 4 / 844
          const left = clamp(box.x - padX, 0, 1)
          const top = clamp(box.y - padY, 0, 1)
          const ring = document.createElement('div')
          ring.className = 'hl'
          ring.style.left = pct(left)
          ring.style.top = pct(top)
          ring.style.width = pct(clamp(box.x + box.w + padX, 0, 1) - left)
          ring.style.height = pct(clamp(box.y + box.h + padY, 0, 1) - top)
          const pin = document.createElement('div')
          pin.className = 'mk'
          pin.textContent = String(n)
          pin.style.left = pct(clamp(left, 0.05, 0.95))
          pin.style.top = pct(clamp(top, 0.025, 0.975))
          frame.append(ring, pin)
        })
      }
      const said = new Set([...lesson.querySelectorAll('ol.do .k')].map((k) => Number(k.textContent)))
      const title = lesson.querySelector('h3').textContent
      for (const n of said) if (!drawn.has(n)) wrong.push(`${title}: step ${n} has no marker`)
      for (const n of drawn) if (!said.has(n)) wrong.push(`${title}: marker ${n} has no step`)
    }
    return wrong
  }, marks)
  if (wrong.length && !process.env.DRAFT) throw new Error(`Markers:\n  ${wrong.join('\n  ')}`)
  else if (wrong.length) console.log('markers:', wrong.join('; '))
  // A marker at the start of each section, to find its page in the printed file.
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.toc [data-for]')].map((cell) => {
      const id = cell.getAttribute('data-for')
      const mark = document.createElement('span')
      // Letters only, in white: digits and see-through text came back garbled.
      const word = id.replace(/\d+/g, (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][Number(n)])
      mark.textContent = `xqx${word}xqx`
      // Inside the section's heading, out of the flow: always on its first page.
      mark.style.cssText = 'position:absolute;left:0;top:0;font-size:8px;line-height:1;color:#ffffff'
      const heading = document.getElementById(id).querySelector('h2')
      heading.style.position = 'relative'
      heading.prepend(mark)
      return id
    }),
  )
  const first = path.join(os.tmpdir(), `guide-pass1-${process.pid}.pdf`)
  await print(page, first)
  const pages = JSON.parse(
    execFileSync('python3', ['-c', `
import json, re, sys
from pypdf import PdfReader
found = {}
for n, p in enumerate(PdfReader(sys.argv[1]).pages, 1):
    text = p.extract_text() or ''
    for word in re.findall(r'xqx([a-z]+)xqx', text.replace(' ', '')):
        found.setdefault(word, n)
print(json.dumps(found))
`, first]).toString(),
  )
  if (!process.env.KEEP) fs.unlinkSync(first)
  else console.log("first pass", first)
  const wordOf = (id) => id.replace(/\d+/g, (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][Number(n)])
  for (const id of ids) pages[id] = pages[wordOf(id)]
  const lost = ids.filter((id) => !pages[id])
  if (lost.length) throw new Error(`No page found for: ${lost.join(', ')}`)
  await page.evaluate((found) => {
    for (const cell of document.querySelectorAll('.toc [data-for]')) cell.textContent = String(found[cell.getAttribute('data-for')])
    for (const mark of document.querySelectorAll('span')) if (/^xqx[a-z]+xqx$/.test(mark.textContent)) mark.remove()
  }, pages)
  await print(page, PDF)
  await browser.close()
  fs.rmSync(small, { recursive: true, force: true })
  console.log('pages', JSON.stringify(pages))
  console.log('wrote', PDF, Math.round(fs.statSync(PDF).size / 1024), 'KB')
})()
