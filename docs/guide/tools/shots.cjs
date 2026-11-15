// Takes the guide's screenshots (docs/guide/shots/) in demo mode.
//
//   npm run dev -- --host 127.0.0.1 --port 5173      (in another terminal)
//   CHROME=/path/to/chrome node docs/guide/tools/shots.cjs [group ...]
//
// CHROME: a Chrome that makes H.264 (Chrome for Testing 138, see CLAUDE.md) so
// videos play and get made; Playwright must be installed (it is in the cloud
// container). Each group starts the demo fresh. Every shot is checked for real
// names that the app's own hints carry, and for anything wider than the phone.

const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE || 'http://127.0.0.1:5173'
const OUT = path.join(__dirname, '..', 'shots')
const MEDIA = path.join(__dirname, '..', '..', '..', 'src', 'demo', 'media')
const FAKE = process.env.FAKE_MEDIA || '' // a folder with cam.y4m and mic2.wav, for the camera and the mic
const SCALE = Number(process.env.SCALE || 2)
// Real names the app's own hints and placeholders carry: never in a shot.
const NEVER = /vertus|pumpfun|lovable|openart|sydney|inflow|godaddy|ilyan|ziad|traderzi|mediamaxing/i

fs.mkdirSync(OUT, { recursive: true })

/** A time zone where it is early afternoon now, so the greeting and times look like a working day. */
function afternoonZone() {
  const zones = ['Pacific/Honolulu', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Atlantic/Azores', 'Europe/London', 'Europe/Paris', 'Europe/Athens', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland']
  const hour = (tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  return zones.reduce((best, tz) => (Math.abs(hour(tz) - 14) < Math.abs(hour(best) - 14) ? tz : best))
}
const TZ = process.env.TZ_SHOTS || afternoonZone()

const problems = []
const browsers = []
/** One shot's actions: a failure is noted and the next shot goes on. */
async function step(name, fn) {
  try {
    await fn()
  } catch (error) {
    problems.push(`${name}: ${String(error.message || error).split('\n')[0]}`)
  }
}

async function start({ theme = 'dark', devices = false } = {}) {
  const args = ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
  if (devices && FAKE) args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${FAKE}/cam.y4m`, `--use-file-for-fake-audio-capture=${FAKE}/mic2.wav`)
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args })
  browsers.push(browser)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SCALE, timezoneId: TZ, isMobile: true, hasTouch: true, colorScheme: theme, permissions: devices ? ['camera', 'microphone'] : [] })
  const page = await ctx.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 200)}`))
  // Questions the app asks are answered no, unless a step said yes to the next one.
  page.on('dialog', (d) => {
    const yes = page.acceptNext
    page.acceptNext = false
    ;(yes ? d.accept() : d.dismiss()).catch(() => {})
  })
  await page.goto(`${BASE}/campaign.html?demo=1`)
  await page.waitForTimeout(5000)
  if (theme === 'light') {
    await page.evaluate(() => localStorage.setItem('cutter.theme', 'light'))
    await page.reload()
    await page.waitForTimeout(4000)
  }
  await dismiss(page)
  return { browser, page }
}

async function dismiss(page) {
  for (const b of await page.getByRole('button', { name: 'Dismiss' }).all()) await b.click().catch(() => {})
  await page.waitForTimeout(300)
}

// What each step of the guide points at on a shot: numbered markers drawn
// over it in the PDF (build_pdf.cjs), in this order. Kept in shots/marks.json.
const B = (p, name) => p.getByRole('button', { name })
const X = (p, text) => p.getByText(text, { exact: true })
/** A file picker drawn as a button (VideoPicker and the music one). */
const P = (p, text) => p.locator('.picker', { hasText: text })
const MARKS = {
  '01-start-01-sign-in': (p) => [p.locator('input').nth(0), p.locator('input').nth(1), B(p, /^Sign in$/)],
  '01-start-02-videos-home': (p) => [B(p, /^Set up$/), X(p, 'Record'), X(p, 'Add videos'), p.locator('nav.tabbar')],
  '01-start-03-more': (p) => [B(p, /^Campaigns/), B(p, /^Bank/), B(p, /^Settings/)],
  '01-start-04-posting': (p) => [B(p, /^Change keys$/), p.locator('label.toggle, .setting').filter({ hasText: 'Send finished videos' }).locator('input').first()],
  '01-start-05-posting-keys': (p) => [p.getByRole('radio', { name: 'Postiz' }).or(B(p, 'Postiz')), p.locator('input').nth(0), p.locator('input').nth(1), B(p, /^Connect$/)],
  '01-start-07-week-tracker': (p) => [p.locator('.tracker-grid button').nth(5)],
  '01-start-09-voice-intro': (p) => [p.locator('select').first(), B(p, /^Start$/)],
  '01-start-11-voice-done': (p) => [B(p, /^Done$/)],
  '01-start-12-record': (p) => [B(p, 'Record'), B(p, 'Flip camera'), B(p, /^Done/)],
  '01-start-13-recording': (p) => [B(p, 'Pause'), B(p, /Delete the last part/), B(p, /^Done/)],
  '02-cut-02-needs-you': (p) => [B(p, /^Check captions$/).nth(0), X(p, 'Needs you ·').or(p.getByText(/^Needs you/)).first(), B(p, /^Check captions$/).nth(1)],
  '02-cut-03-check-questions': (p) => [p.locator('select').first(), p.getByPlaceholder('No headline').first(), B(p, /^Next/)],
  '02-cut-04-quick-check': (p) => [B(p, /^Approve/), B(p, 'Timeline editor')],
  '02-cut-05-timeline': (p) => [p.locator('.tl-clip').first(), B(p, /^Text$/), B(p, /^Overlay$/), B(p, /^Sound$/), B(p, /^Captions$/), B(p, /^Headline$/)],
  '02-cut-06-clip-speed': (p) => [p.locator('.tl-speeds')],
  '02-cut-07-text': (p) => [p.getByPlaceholder('Type your words'), p.locator('.cuts-text-hold').first()],
  '02-cut-08-overlay': (p) => [B(p, /A photo or video from my phone/), p.locator('button img').first()],
  '02-cut-11-caption-sheet': (p) => [B(p, /Check (again|captions) with Claude/), p.locator('.caption-sheet textarea').first()],
  '02-cut-12-made': (p) => [p.getByRole('link', { name: /^Save$/ })],
  '02-cut-13-reaction-video': (p) => [p.locator('select').first(), p.getByPlaceholder(/Headline on the reaction/), P(p, /^Choose$/)],
  '02-cut-14-timeline-editor': (p) => [p.getByText('+ Add the videos, in order'), p.getByRole('radio', { name: 'Cut the silences' }).or(B(p, /Cut the silences/)), B(p, /Open the timeline editor/)],
  '02-cut-15-cut-only': (p) => [B(p, /^Balanced$/), p.getByText('Add videos', { exact: true }).first()],
  '02-cut-16-cut-only-done': (p) => [p.getByRole('link', { name: /Save video/ })],
  '03-camp-01-list': (p) => [B(p, /^New campaign$/)],
  '03-camp-02-campaign': (p) => [B(p, /^Brand & logo$/), B(p, /^Morning routine/), B(p, /^New angle$/), B(p, /Postiz/)],
  '03-camp-03-brand': (p) => [p.locator('input[type=text]').nth(0), p.getByRole('radio', { name: 'Talking head' }).or(B(p, 'Talking head')), p.locator('input[type=text]').nth(1), B(p, /Change image|Choose image/), B(p, /^Save campaign$/)],
  '03-camp-05-angle-headline': (p) => [p.getByPlaceholder(/Your headline/), p.locator('label').filter({ hasText: 'Write it from the video' }).locator('input'), B(p, /^Outline$/).first()],
  '03-camp-10-posting-accounts': (p) => [p.locator('input[type=checkbox]').first(), B(p, /Look again/), p.getByLabel('Most posts a day')],
  '03-camp-11-posting-times': (p) => [p.getByRole('radio', { name: 'Random times' }).or(B(p, 'Random times')), p.locator('select').first()],
  '03-camp-12-posting-approval': (p) => [p.getByRole('radio', { name: 'I approve' }).or(B(p, 'I approve')), p.locator('label').filter({ hasText: 'Remind me to submit' }).locator('input')],
  '03-camp-13-posting-caption': (p) => [p.getByRole('radio', { name: 'Claude writes it' }).or(B(p, 'Claude writes it')), p.locator('textarea').first(), p.getByPlaceholder(/#/).first()],
  '03-camp-14-captions-by-kind': (p) => [p.getByPlaceholder('e.g. #advancedpost'), p.getByPlaceholder('e.g. #basicpost'), B(p, /^Save posting$/)],
  '03-camp-17-bank': (p) => [B(p, /^Add pictures$/), B(p, /^Add music$/)],
  '04-post-01-to-approve': (p) => [p.locator('textarea').first(), B(p, /^Approve$/).first(), B(p, /^Post now$/).first(), B(p, /^Approve all/)],
  '04-post-02-more-options': (p) => [B(p, /^Approve, post later$/), B(p, /^Change time$/), B(p, /^Add music$/)],
  '04-post-03-add-music': (p) => [p.locator('.music-after select'), B(p, /Add music & approve|^Add music$/).first()],
  '04-post-05-scheduled': (p) => [p.getByText(/^Today$/).first(), B(p, /^Take back$/).first()],
  '04-post-07-didnt-go-out': (p) => [B(p, /^Post it myself$/), B(p, /^Let the Cutter post it$/)],
  '04-post-09-select-stop': (p) => [p.locator('.chips button, .chip').first(), B(p, /Stop \d+ post|Tick posts to stop/)],
  '04-post-10-new-post': (p) => [p.locator('select').first(), p.getByPlaceholder('Anything Claude should know? (optional)'), p.getByText(/\+ Add more videos|\+ Choose the videos/).first()],
  '04-post-11-new-post-when': (p) => [p.getByRole('radio', { name: /Spread them/ }).or(B(p, /Spread them/)), p.locator('button.btn.primary', { hasText: /^Post \d/ })],
  '04-post-12-limits': (p) => [p.locator('input[type=number]').first(), p.locator('input[type=checkbox]').first()],
  '05-batch-01-top': (p) => [p.locator('.chooser, .batch-hero').first(), p.locator('.batch-status').first()],
  '05-batch-02-formats': (p) => [p.locator('.format-head').first(), B(p, /\+ Add a format/)],
  '05-batch-03-reaction-format': (p) => [P(p, /^\+ Add$/).nth(0), P(p, /^\+ Add$/).nth(1)],
  '05-batch-04-talking-head': (p) => [P(p, /Drop in clips/), B(p, /^Change$/), p.locator('[aria-label="Speed"], .seg').filter({ hasText: '1.1×' }).first()],
  '05-batch-06-clips': (p) => [B(p, /hook-1\.mp4/), p.getByRole('radio', { name: 'Raw' }).or(B(p, /^Raw$/)).first(), P(p, /^\+ Add$/)],
  '05-batch-07-clip-screen': (p) => [p.locator('.clip-editor-close'), B(p, 'Next clip'), B(p, /^Length$/), p.locator('[aria-label="Cut by the Cutter or kept raw"]'), p.locator('[aria-label="This clip\'s speed"]')],
  '05-batch-11-steps-rules': (p) => [B(p, /^Names and order$/), B(p, /^Words on screen$/).first(), p.locator('.talk-step-rules input[type=checkbox]').first()],
  '05-batch-12-words-on-screen': (p) => [B(p, /Text at the top/), p.getByPlaceholder('Type the words')],
  '05-batch-14-hook-looks': (p) => [p.getByRole('checkbox', { name: 'Snapchat' }), B(p, /^More Outline$/), p.locator('textarea').first()],
  '05-batch-15-claude-x': (p) => [p.locator('.formula-logos'), p.getByRole('radio', { name: 'Amount a day' }).or(B(p, /^Amount a day$/))],
  '05-batch-17-copies': (p) => [p.locator('.copies .picker')],
  '05-batch-18-videos-a-day': (p) => [p.getByRole('radio', { name: 'Every day' }), B(p, 'More a day')],
  '05-batch-20-start': (p) => [p.locator('.batch-make'), B(p, /^Start over$/)],
  '05-batch-22-making': (p) => [p.locator('.batch-status').first()],
  '05-batch-23-clip-check': (p) => [p.locator('.drop-check-steps'), B(p, /^Mirror/)],
  '06-formats-02-script': (p) => [P(p, /^\+ Takes$/), B(p, /^Look & clips$/)],
  '07-an-01-overview': (p) => [p.getByText('LAST 30 DAYS').or(p.getByText(/^Last \d+ days$/)).first()],
  '07-an-02-cold-accounts': (p) => [B(p, /^Pause$/).first(), B(p, /^Yes$/).first()],
  '07-an-03-when-to-post': (p) => [B(p, /^Turn off$/).first()],
  '07-an-04-campaign': (p) => [B(p, /^Yes, \d+ a day$/), B(p, /^Use the best hooks$/)],
  '08-trial-04-start': (p) => [B(p, /Not talking - a viral reel/), P(p, /^Pick videos$/), B(p, /^Start$/)],
  '09-motion-01-pick': (p) => [p.locator('.motion-format').first(), p.getByPlaceholder(/Tap an example below/)],
  '09-motion-02-plan': (p) => [B(p, 'Play it as it will be made')],
  '09-motion-04-chat': (p) => [p.getByPlaceholder(/make the sum come in later/), B(p, /Make the video/)],
  '09-warm-01-main': (p) => [B(p, /^Film \d+ in one go$/), B(p, /^\+ Idea$/)],
  '09-warm-04-idea': (p) => [B(p, /^Film it$/).first()],
  '10-set-03-cutting': (p) => [p.getByRole('radio', { name: 'Balanced' }), p.getByRole('radio', { name: 'Fit' })],
  '10-set-06-people': (p) => [B(p, /^Make link$/)],
  '10-set-07-look': (p) => [p.getByRole('radio', { name: 'Light' }), p.locator('label').filter({ hasText: 'Show tips' }).locator('input')],
}
const MARKS_FILE = path.join(OUT, 'marks.json')
const marks = fs.existsSync(MARKS_FILE) ? JSON.parse(fs.readFileSync(MARKS_FILE, 'utf8')) : {}

/** Where each target is on the screen, as fractions of it; off screen or not found: null. */
async function placesOf(page, name) {
  const targets = MARKS[name]
  if (!targets) return null
  const out = []
  for (const target of targets(page)) {
    // The first match that is on the screen (a list can hold the same button above it).
    let box = null
    let seen = false
    for (const one of (await target.all().catch(() => [])).slice(0, 30)) {
      box = await one.boundingBox({ timeout: 1500 }).catch(() => null)
      seen = !!box && box.width > 0 && box.y + box.height > 0 && box.y < 844 && box.x < 390
      if (seen) break
    }
    if (!seen) {
      const count = await target.count().catch(() => -1)
      problems.push(`${name}: marker ${out.length + 1} not on screen (found ${count}, at ${box ? Math.round(box.y) : '-'})`)
      if (process.env.DOM_DIR) fs.writeFileSync(path.join(process.env.DOM_DIR, `${name}.html`), await page.content())
    }
    out.push(seen ? { x: box.x / 390, y: box.y / 844, w: box.width / 390, h: box.height / 844 } : null)
  }
  return out
}

async function snap(page, name) {
  await page.waitForTimeout(700)
  const text = await page.innerText('body').catch(() => '')
  const hit = text.match(NEVER)
  if (hit) problems.push(`${name}: real name "${hit[0]}" on screen`)
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  if (wide) problems.push(`${name}: wider than the phone`)
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  const places = await placesOf(page, name)
  if (places) {
    marks[name] = places
    fs.writeFileSync(MARKS_FILE, JSON.stringify(marks, null, 1))
  }
  console.log('shot', name)
}

const tap = async (page, name, i = 0) => {
  await page.getByRole('button', { name }).nth(i).click()
  await page.waitForTimeout(900)
}
const tab = async (page, name) => {
  await page.locator('nav.tabbar button', { hasText: name }).first().click()
  await page.waitForTimeout(1600)
}
const more = async (page, row) => {
  await tab(page, 'More')
  await page.getByRole('button', { name: new RegExp('^' + row) }).first().click()
  await page.waitForTimeout(1800)
}
/** Scrolls the page so this is near the top of the screen. */
const toTop = async (page, locator, offset = 16) => {
  const el = locator.first()
  await el.waitFor({ timeout: 8000 })
  await el.evaluate((e, off) => {
    let box = e.parentElement
    while (box && box !== document.body) {
      const s = getComputedStyle(box)
      if (/(auto|scroll)/.test(s.overflowY) && box.scrollHeight > box.clientHeight) {
        box.scrollBy(0, e.getBoundingClientRect().top - box.getBoundingClientRect().top - off)
        return
      }
      box = box.parentElement
    }
    window.scrollBy(0, e.getBoundingClientRect().top - off)
  }, offset)
  await page.waitForTimeout(500)
}
const scrollTop = (page) => page.evaluate(() => window.scrollTo(0, 0))

const groups = {
  async start() {
    for (const theme of ['dark', 'light']) {
      const { browser, page } = await start({ theme })
      const t = theme === 'light' ? '-light' : ''
      await snap(page, `01-start-02-videos-home${t}`)
      if (theme === 'dark') {
        await toTop(page, page.getByText('This week'))
        await page.locator('.tracker button, .week-tracker button').filter({ hasText: /^\d+$/ }).nth(5).click().catch(() => {})
        await snap(page, '01-start-07-week-tracker')
        await toTop(page, page.getByText('Your campaigns'), 60)
        await snap(page, '01-start-08-campaigns-strip')
        await tab(page, 'More')
        await snap(page, '01-start-03-more')
        await page.getByRole('button', { name: /^Settings/ }).click()
        await page.waitForTimeout(1500)
        await toTop(page, page.getByText('Postiz ·'), 60)
        await snap(page, '01-start-04-posting')
        await tap(page, /^Change keys$/)
        await snap(page, '01-start-05-posting-keys')
        // Signed out: the sign-in page.
        await page.evaluate(() => localStorage.removeItem('cutter.session'))
        await page.reload()
        await page.waitForTimeout(3000)
        await snap(page, '01-start-01-sign-in')
      }
      await browser.close()
    }
    if (FAKE) {
      const { browser, page } = await start({ devices: true })
      await tap(page, /^Set up$/)
      await snap(page, '01-start-09-voice-intro')
      await tap(page, /^Start/)
      for (let i = 0; i < 60; i++) {
        const t = await page.innerText('body')
        if (/Done reading/.test(t)) {
          await page.waitForTimeout(1500)
          await snap(page, '01-start-10-voice-read')
          await page.waitForTimeout(3500)
          await tap(page, 'Done reading')
        } else if (/Now say your/.test(t)) {
          await page.waitForTimeout(2500)
          await tap(page, /^Done$/)
        } else if (/Done: /.test(t)) {
          await snap(page, '01-start-11-voice-done')
          await tap(page, /^Done$/)
          break
        }
        await page.waitForTimeout(700)
      }
      await page.getByText('Record', { exact: true }).first().click()
      await page.waitForTimeout(4000)
      await snap(page, '01-start-12-record')
      await page.getByRole('button', { name: 'Record' }).click()
      await page.waitForTimeout(3500)
      await snap(page, '01-start-13-recording')
      await page.getByRole('button', { name: 'Pause' }).click()
      await browser.close()
    }
  },

  async cutting() {
    const { browser, page } = await start()
    await toTop(page, page.locator('.vrow').first(), 70)
    await snap(page, '02-cut-01-rows')
    await page.getByText('Needs you').first().click().catch(() => {})
    await toTop(page, page.getByText('Three reasons').first(), 70)
    await snap(page, '02-cut-02-needs-you')
    await scrollTop(page)
    await tap(page, /^Check captions$/)
    await snap(page, '02-cut-03-check-questions')
    await tap(page, /^Next/)
    await page.waitForTimeout(3500)
    await snap(page, '02-cut-04-quick-check')
    await tap(page, 'Timeline editor')
    await page.waitForTimeout(3500)
    await snap(page, '02-cut-05-timeline')
    await page.locator('.tl-clip').nth(1).click()
    await page.waitForTimeout(800)
    await page.locator('nav.tl-tools button', { hasText: 'Speed' }).click()
    await page.waitForTimeout(800)
    await snap(page, '02-cut-06-clip-speed')
    await page.locator('.tl-speeds button', { hasText: '1.25' }).click()
    await page.locator('nav.tl-tools button', { hasText: 'Back' }).click().catch(() => {})
    await page.waitForTimeout(600)
    await tap(page, /^Text$/)
    await page.getByPlaceholder('Type your words').fill('Link in bio')
    await page.waitForTimeout(600)
    await snap(page, '02-cut-07-text')
    await tap(page, /^Done$/)
    await tap(page, /^Overlay$/)
    await snap(page, '02-cut-08-overlay')
    await page.locator('button img').first().click()
    await page.waitForTimeout(1200)
    await tap(page, /^Done$/).catch(() => {})
    await tap(page, /^Sound$/)
    await toTop(page, page.getByText(/Add a sound at/), 330).catch(() => {})
    await snap(page, '02-cut-09-sound')
    await tap(page, /^Cancel$/)
    await tap(page, /^Headline$/)
    await snap(page, '02-cut-10-headline')
    await tap(page, /^Done$/)
    await page.getByRole('button', { name: /^Captions$/ }).first().click()
    await page.waitForTimeout(1500)
    await snap(page, '02-cut-11-caption-sheet')
    await page.getByRole('button', { name: 'Close the captions' }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: /^Approve/ }).first().click()
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000)
      if (/→/.test(await page.innerText('body'))) break
    }
    await page.getByText(/0:1\d → /).first().click().catch(() => {})
    await toTop(page, page.getByText(/0:1\d → /).first(), 120)
    await snap(page, '02-cut-12-made')
    await scrollTop(page)
    await tap(page, /^Reaction video$/)
    await snap(page, '02-cut-13-reaction-video')
    await tap(page, /^Back$/)
    await tap(page, /^Timeline editor$/)
    await snap(page, '02-cut-14-timeline-editor')
    await tap(page, /^Back$/)
    // Cut only.
    await page.goto(`${BASE}/#cut`)
    await page.waitForTimeout(4000)
    await snap(page, '02-cut-15-cut-only')
    for (const label of [/Cut .um.s and stumbles/, /Write captions/]) {
      const box = page.getByLabel(label)
      if ((await box.count()) && (await box.isChecked())) await box.uncheck()
    }
    await page.locator('input[type=file]').first().setInputFiles(path.join(MEDIA, 'talk-fitpocket.mp4'))
    for (let i = 0; i < 60 && !/Done/.test(await page.innerText('body')); i++) await page.waitForTimeout(1500)
    await snap(page, '02-cut-16-cut-only-done')
    await browser.close()
  },

  async campaigns() {
    const { browser, page } = await start()
    await more(page, 'Campaigns')
    await snap(page, '03-camp-01-list')
    await page.getByRole('button', { name: /^Moonbrew/ }).first().click()
    await page.waitForTimeout(1000)
    await snap(page, '03-camp-02-campaign')
    await tap(page, /^Brand & logo$/)
    await snap(page, '03-camp-03-brand')
    await tap(page, /^Cancel$/)
    await page.getByRole('button', { name: /^Morning routine/ }).first().click()
    await page.waitForTimeout(1500)
    await snap(page, '03-camp-04-angle-look')
    await toTop(page, page.getByText('Headline', { exact: true }).first(), 80)
    await snap(page, '03-camp-05-angle-headline')
    for (const [part, n] of [['Pictures', '06'], ['Sound', '07'], ['Effects', '08'], ['Clips', '09']]) {
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.getByRole('tab', { name: part }).click().catch(async () => page.getByRole('button', { name: new RegExp('^' + part + '$') }).click())
      await page.waitForTimeout(1200)
      await snap(page, `03-camp-${n}-angle-${part.toLowerCase()}`)
    }
    await tap(page, /^Cancel$/)
    await page.getByRole('button', { name: /Postiz/ }).first().click()
    await page.waitForTimeout(1500)
    await snap(page, '03-camp-10-posting-accounts')
    await toTop(page, page.getByText('Your times'), 70)
    await snap(page, '03-camp-11-posting-times')
    await toTop(page, page.getByText('Before it posts'), 70)
    await snap(page, '03-camp-12-posting-approval')
    await toTop(page, page.getByText('Caption', { exact: true }).first(), 70)
    await snap(page, '03-camp-13-posting-caption')
    await toTop(page, page.getByText('Added to the caption, by kind of video'), 70)
    await snap(page, '03-camp-14-captions-by-kind')
    await toTop(page, page.getByText('Instagram location').first(), 70)
    await snap(page, '03-camp-15-instagram-location')
    await tap(page, /^Cancel$/)
    await page.locator('summary', { hasText: 'Stop or end' }).click()
    await tap(page, /^End campaign/)
    await page.waitForTimeout(1200)
    await toTop(page, page.getByText('Stop or end this campaign'), 70)
    await snap(page, '03-camp-16-stop-end')
    await more(page, 'Bank')
    await snap(page, '03-camp-17-bank')
    await browser.close()
  },

  async posting() {
    const { browser, page } = await start()
    await tab(page, 'Posts')
    await snap(page, '04-post-01-to-approve')
    await page.locator('summary', { hasText: 'More options' }).first().click()
    await page.waitForTimeout(600)
    await toTop(page, page.locator('summary', { hasText: 'More options' }).first(), 380)
    await snap(page, '04-post-02-more-options')
    await tap(page, /^Add music$/)
    await toTop(page, page.locator('.music-after').first(), 300)
    await snap(page, '04-post-03-add-music')
    await tap(page, /^Cancel$/)
    await scrollTop(page)
    await toTop(page, page.getByText('Brand', { exact: true }).first(), 80)
    await snap(page, '04-post-04-brand')
    await toTop(page, page.getByText(/^Today$/).first(), 30)
    await snap(page, '04-post-05-scheduled')
    await toTop(page, page.getByText('Just posted'), 30)
    await page.getByText('Posted', { exact: true }).first().click().catch(() => {})
    await page.waitForTimeout(800)
    await snap(page, '04-post-06-just-posted')
    await page.getByText("Didn't go out").last().click()
    await page.waitForTimeout(800)
    await page.locator('text=Not posted').last().click()
    await page.waitForTimeout(800)
    await toTop(page, page.getByText("Didn't go out").last(), 30)
    await snap(page, '04-post-07-didnt-go-out')
    await page.evaluate(() => (location.hash = '#posts/missed/demo-missed-0'))
    await page.waitForTimeout(2500)
    await snap(page, '04-post-08-missed-sheet')
    await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {})
    await scrollTop(page)
    await tap(page, /^Select$/)
    await page.locator('.stop-picker input[type=checkbox], label input[type=checkbox]').nth(1).check().catch(() => {})
    await snap(page, '04-post-09-select-stop')
    await page.getByRole('button', { name: /^Cancel$/ }).last().click()
    await page.waitForTimeout(800)
    await tap(page, /New post/)
    await page.getByLabel('Choose the videos').setInputFiles([path.join(MEDIA, 'talk-moonbrew.mp4'), path.join(MEDIA, 'talk-fitpocket.mp4')])
    await page.waitForTimeout(6000)
    await page.getByPlaceholder('Anything Claude should know? (optional)').fill('Post them tomorrow')
    await snap(page, '04-post-10-new-post')
    await toTop(page, page.getByText(/how many a day|Spread them/).first(), 80)
    await snap(page, '04-post-11-new-post-when')
    await browser.close()
    // Limits and Buffer (Settings).
    const second = await start()
    await more(second.page, 'Settings')
    await second.page.getByRole('button', { name: /Pause and daily limits/ }).click()
    await second.page.waitForTimeout(1200)
    await snap(second.page, '04-post-12-limits')
    await second.page.getByRole('button', { name: /Settings/ }).first().click()
    await second.page.waitForTimeout(1000)
    await toTop(second.page, second.page.getByText('Backup · Buffer'), 70)
    await snap(second.page, '04-post-13-buffer')
    await toTop(second.page, second.page.getByText('Notifications', { exact: true }), 70)
    await snap(second.page, '04-post-14-notifications')
    await second.browser.close()
  },

  async batch() {
    const { browser, page } = await start()
    await tab(page, 'Batch')
    await snap(page, '05-batch-01-top')
    await toTop(page, page.getByText('Formats').first(), 30)
    await snap(page, '05-batch-02-formats')
    await page.locator('.format-head').first().click()
    await page.waitForTimeout(1000)
    await toTop(page, page.locator('.format-head').first(), 30)
    await snap(page, '05-batch-03-reaction-format')
    await page.locator('.format-head').first().click()
    await page.locator('.format-head').nth(1).click()
    await page.waitForTimeout(1500)
    await toTop(page, page.locator('.format-head').nth(1), 30)
    await snap(page, '05-batch-04-talking-head')
    await tap(page, /^Change$/)
    await toTop(page, page.getByText('What the Cutter does with your clips'), 30)
    await snap(page, '05-batch-05-drop-in-checklist')
    await tap(page, /^Cancel$/)
    await toTop(page, page.getByText(/Your clips/i).first(), 30)
    await snap(page, '05-batch-06-clips')
    await page.getByRole('button', { name: /hook-1\.mp4/ }).click()
    await page.waitForTimeout(2500)
    await snap(page, '05-batch-07-clip-screen')
    await tap(page, /^Length$/)
    await page.waitForTimeout(3500)
    await snap(page, '05-batch-08-clip-length')
    await page.getByRole('button', { name: /^Back$/ }).first().click().catch(() => {})
    await page.waitForTimeout(800)
    await page.locator('.clip-editor-close').click()
    await page.waitForTimeout(800)
    await page.locator('summary', { hasText: 'How the videos look' }).first().click()
    await toTop(page, page.locator('summary', { hasText: 'How the videos look' }).first(), 30)
    await snap(page, '05-batch-09-how-videos-look')
    await toTop(page, page.getByText('Captions height').first(), 30)
    await snap(page, '05-batch-10-captions-height')
    await page.locator('summary', { hasText: 'Steps and rules' }).first().click()
    await toTop(page, page.locator('summary', { hasText: 'Steps and rules' }).first(), 30)
    await snap(page, '05-batch-11-steps-rules')
    await step('05-batch-12', async () => {
      await page.getByRole('button', { name: /^Words on screen$/ }).first().click()
      await page.waitForTimeout(2000)
      await page.getByRole('button', { name: /Text at the top/ }).click()
      await page.getByPlaceholder('Type the words').fill('Step 1: open it')
      await page.waitForTimeout(800)
      await toTop(page, page.locator('.step-texts').first(), 20)
      await snap(page, '05-batch-12-words-on-screen')
      await page.locator('.step-texts').getByRole('button', { name: /^Cancel$/ }).click()
      await page.waitForTimeout(800)
    })
    await step('05-batch-13', async () => {
      await page.getByRole('button', { name: /^Names and order$/ }).click()
      await page.waitForTimeout(800)
      await toTop(page, page.getByText(/Product showcase order/), 20)
      await snap(page, '05-batch-13-step-order')
      await page.getByRole('button', { name: /^Cancel$/ }).last().click()
      await page.waitForTimeout(800)
    })
    await step('05-batch-14', async () => {
      await toTop(page, page.getByRole('checkbox', { name: 'Claude + X' }), 160)
      await snap(page, '05-batch-14-hook-looks')
    })
    await step('05-batch-15', async () => {
      await page.getByRole('checkbox', { name: 'Claude + X' }).click()
      await page.waitForTimeout(1000)
      await toTop(page, page.locator('.formula-logos'), 24)
      await snap(page, '05-batch-15-claude-x')
      await page.getByRole('checkbox', { name: 'Claude + X' }).click()
      await page.waitForTimeout(600)
    })
    await step('05-batch-16', async () => {
      await toTop(page, page.getByText('From the music bank').first(), 80)
      await snap(page, '05-batch-16-music')
    })
    await step('05-batch-17', async () => {
      await toTop(page, page.getByText('One video, new songs'), 30)
      await snap(page, '05-batch-17-copies')
    })
    await step('05-batch-18', async () => {
      await toTop(page, page.getByText('How often'), 60)
      await snap(page, '05-batch-18-videos-a-day')
    })
    await step('05-batch-19', async () => {
      await page.getByRole('radio', { name: 'Some days' }).click()
      await page.waitForTimeout(800)
      await snap(page, '05-batch-19-some-days')
      await page.getByRole('radio', { name: 'Every day' }).click()
      await page.waitForTimeout(800)
    })
    await step('05-batch-20', async () => {
      await toTop(page, page.locator('.batch-make'), 260)
      await snap(page, '05-batch-20-start')
    })
    await step('05-batch-21', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await snap(page, '05-batch-21-variations')
    })
    await step('05-batch-22', async () => {
      await toTop(page, page.getByText('Videos a day').first(), 200)
      await page.getByRole('button', { name: 'More a day' }).click()
      await page.waitForTimeout(2500)
      await scrollTop(page)
      await snap(page, '05-batch-22-making')
    })
    await browser.close()
    const second = await start()
    await tab(second.page, 'Batch')
    await second.page.locator('.format-head').nth(1).click()
    await second.page.waitForTimeout(1200)
    await tap(second.page, /Check where every clip is again/)
    await second.page.getByRole('button', { name: /^Check/ }).first().click().catch(() => {})
    await second.page.waitForTimeout(3000)
    await snap(second.page, '05-batch-23-clip-check')
    await second.browser.close()
  },

  async hooks() {
    const { page } = await start()
    await tab(page, 'Batch')
    await step('05-batch-14', async () => {
      await toTop(page, page.getByRole('checkbox', { name: 'Claude + X' }), 160)
      await snap(page, '05-batch-14-hook-looks')
    })
    await step('05-batch-15', async () => {
      await page.getByRole('checkbox', { name: 'Claude + X' }).click()
      await page.waitForTimeout(1200)
      await toTop(page, page.locator('.formula-logos'), 24)
      await snap(page, '05-batch-15-claude-x')
    })
  },

  async ancamp() {
    const { page } = await start()
    await tab(page, 'Analytics')
    await page.waitForTimeout(1500)
    await step('07-an-04', async () => {
      await toTop(page, page.getByText('Moonbrew', { exact: true }).first(), 30)
      await snap(page, '07-an-04-campaign')
    })
  },

  async formats() {
    const { browser, page } = await start()
    await more(page, 'Formats')
    await snap(page, '06-formats-01-list')
    await page.getByRole('button', { name: /Day in the life/ }).click()
    await page.waitForTimeout(1500)
    await snap(page, '06-formats-02-script')
    await page.getByRole('button', { name: /^‹ Formats|Formats$/ }).first().click().catch(() => {})
    await page.waitForTimeout(1000)
    await tap(page, /New format/)
    await page.getByPlaceholder(/Morning routine/).fill('Three reasons')
    await snap(page, '06-formats-03-new')
    await browser.close()
  },

  async analytics() {
    for (const theme of ['dark', 'light']) {
      const { browser, page } = await start({ theme })
      await tab(page, 'Analytics')
      await page.waitForTimeout(1500)
      const t = theme === 'light' ? '-light' : ''
      await snap(page, `07-an-01-overview${t}`)
      if (theme === 'dark') {
        await toTop(page, page.getByText('Accounts that stopped getting views'), 30)
        await snap(page, '07-an-02-cold-accounts')
        await toTop(page, page.getByText('When to post'), 30)
        await snap(page, '07-an-03-when-to-post')
        await toTop(page, page.locator('.analytics-campaign, section, article').filter({ hasText: /^Moonbrew/ }).getByText('Moonbrew', { exact: true }).first(), 30).catch(async () => toTop(page, page.getByText('Moonbrew', { exact: true }).first(), 30))
        await snap(page, '07-an-04-campaign')
        await toTop(page, page.getByText(/What works · views a video/).first(), 30)
        await snap(page, '07-an-05-what-works')
        await toTop(page, page.getByText('REACTIONS').first(), 30)
        await snap(page, '07-an-06-what-works-more')
      }
      await browser.close()
    }
  },

  async trial() {
    const { browser, page } = await start()
    await more(page, 'Trial reels')
    await page.waitForTimeout(1500)
    await snap(page, '08-trial-01-loop')
    await toTop(page, page.getByText(/copies a day/).first(), 30)
    await snap(page, '08-trial-02-settings')
    await toTop(page, page.getByText(/To approve ·/).first(), 30)
    await snap(page, '08-trial-03-copies')
    await toTop(page, page.getByText(/Add another video|Start a Trial loop/).first(), 30)
    await snap(page, '08-trial-04-start')
    await browser.close()
  },

  async motion() {
    const { browser, page } = await start()
    await more(page, 'Motion graphics')
    await page.waitForTimeout(3000)
    await snap(page, '09-motion-02-plan')
    await toTop(page, page.getByText(/Over your face/).first(), 30)
    await snap(page, '09-motion-03-moments')
    await toTop(page, page.getByText(/Tell Claude what to change/).first(), 200)
    await snap(page, '09-motion-04-chat')
    // It asks first ("This plan is let go") - say yes.
    page.acceptNext = true
    await page.getByRole('button', { name: /Start again with another video/ }).click()
    await page.waitForTimeout(2000)
    await scrollTop(page)
    await snap(page, '09-motion-01-pick')
    await more(page, 'Warm-ups')
    await snap(page, '09-warm-01-main')
    await toTop(page, page.getByText('Where they go'), 30)
    await snap(page, '09-warm-02-where')
    await toTop(page, page.getByText(/Waiting for your OK/).first(), 30)
    await snap(page, '09-warm-03-approve')
    await toTop(page, page.getByText('Point at the text').last(), 120)
    await snap(page, '09-warm-04-idea')
    await scrollTop(page)
    await tap(page, /^\+ Idea$/)
    await snap(page, '09-warm-05-new-idea')
    await browser.close()
  },

  async settings() {
    for (const theme of ['dark', 'light']) {
      const { browser, page } = await start({ theme })
      await more(page, 'Settings')
      const t = theme === 'light' ? '-light' : ''
      await snap(page, `10-set-01-top${t}`)
      if (theme === 'dark') {
        await toTop(page, page.getByText('Your voice').first(), 30)
        await snap(page, '10-set-02-voice')
        await toTop(page, page.getByText('Cutting').first(), 30)
        await snap(page, '10-set-03-cutting')
        await toTop(page, page.getByText('Captions', { exact: true }).first(), 30)
        await snap(page, '10-set-04-captions-effects')
        await toTop(page, page.getByText('Server', { exact: true }).first(), 30)
        await snap(page, '10-set-05-server')
        await toTop(page, page.getByText('People', { exact: true }).first(), 30)
        await snap(page, '10-set-06-people')
        await toTop(page, page.getByText('Appearance').first(), 30)
        await snap(page, '10-set-07-look')
      }
      await browser.close()
    }
  },
}

;(async () => {
  const wanted = process.argv.slice(2)
  console.log('time zone', TZ)
  for (const [name, run] of Object.entries(groups)) {
    if (wanted.length && !wanted.includes(name)) continue
    try {
      // A group stuck on something it waits for gives up after 6 minutes.
      await Promise.race([run(), new Promise((_, reject) => setTimeout(() => reject(new Error('took over 6 minutes')), 360_000))])
    } catch (error) {
      problems.push(`${name} stopped: ${String(error.message || error).split('\n')[0]}`)
    }
    for (const b of browsers.splice(0)) await b.close().catch(() => {})
  }
  console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no problems')
  process.exit(0)
})()
