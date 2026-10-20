// The Cutter server: the Cutter app itself, running in Chrome on a server
// (Railway), so a batch keeps being made with the phone closed - the same
// code as on the phone, so the same videos. No dependencies: Node's own
// http, fs and child_process.
//
//   phone (Batch tab, Settings "Server")         this server                     Chrome (headless)
//    Connect: its login  -------------------->  /connect, checked by the     ->  campaign.html?server=1, logged
//                                                Cutter's own login function      in with that login (serverMode.ts)
//    bank files, 8 MB pieces  --------------->  /files  -> /data/files         <-  /local/files/<id>
//    bank settings, Start over, Stop  ------->  /banks  -> /data/inbox         <-  /local/inbox (every few seconds)
//    progress  <------------------------------  /status <- /data/status.json   <-  /local/status
//                                                                                   videos go to Postiz through the
//                                                                                   postiz function, as from the phone
//
// The public routes need the phone's Cutter login (Authorization: Bearer),
// checked with the login function's `whoami`; once connected, only that
// login's space. The /local routes and the app itself are served on a second
// port bound to 127.0.0.1: only the Chrome on this machine reaches them.

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8080)
const APP_PORT = Number(process.env.APP_PORT ?? 8081)
const DATA = process.env.DATA_DIR ?? '/data'
const DIST = process.env.DIST_DIR ?? path.resolve(HERE, '..', 'dist')
const CHROME = process.env.CHROME_PATH ?? '/opt/chrome/chrome'
const ORIGINS = (process.env.ALLOWED_ORIGIN ?? 'https://silence-cutter.netlify.app').split(',').map((s) => s.trim())
const CUTTER_URL = process.env.CUTTER_URL ?? 'https://uykuoibqdxmpbbrsmyad.supabase.co/functions/v1/cutter'
const PUBLISHABLE_KEY = 'sb_publishable_UhAfC6SJRmnDOR5Y10CmPg_DFepNyVA'
/** A piece of an upload: the phone sends files in pieces this size at most. */
const PIECE = 8 * 1024 * 1024
/** Chrome is started again when the page hasn't said it is alive for this long. */
const STUCK_MS = 20 * 60 * 1000
const VERSION = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'

const dir = (...p) => path.join(DATA, ...p)
for (const d of ['files', 'uploads', 'inbox', 'chrome']) fs.mkdirSync(dir(d), { recursive: true })

const log = (...words) => console.log(new Date().toISOString(), ...words)

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

function readJsonSync(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Written whole or not at all: a crash mid-write never leaves half a file. */
async function writeJson(file, value) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(value))
  await fsp.rename(tmp, file)
}

// --- Who is calling -------------------------------------------------------

const KEEP_MS = 5 * 60 * 1000
const checked = new Map()

/** For trying the server on a computer only: this token stands for a test
 *  space, no login function asked. Never set on the real server. */
const TEST_TOKEN = process.env.CUTTER_SERVER_TEST_TOKEN

/** The shared space a Cutter login belongs to, or null when it is no good. */
async function spaceFor(token) {
  if (!token || token.length > 2000) return null
  if (TEST_TOKEN && token === TEST_TOKEN) return 'test-space'
  const hit = checked.get(token)
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.space
  const res = await fetch(CUTTER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: PUBLISHABLE_KEY },
    body: JSON.stringify({ action: 'whoami', token }),
  }).catch(() => null)
  if (!res) throw new Error('The login check could not be reached.')
  if (res.status === 401 || res.status === 403) return null
  const data = await res.json().catch(() => ({}))
  const space = typeof data.space === 'string' && data.space ? data.space : null
  if (space) checked.set(token, { at: Date.now(), space })
  return space
}

const sessionFile = dir('session.json')

// --- Chrome ----------------------------------------------------------------

let chrome = null
let chromeStarted = 0
let wanted = false

function startChrome() {
  if (chrome || !wanted) return
  // An old app version kept by a service worker would keep running after a
  // deploy: the page always loads the version this server serves.
  fs.rmSync(dir('chrome', 'Default', 'Service Worker'), { recursive: true, force: true })
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${dir('chrome')}`,
    // For trying it on a computer (a debugging port, say); unset on the real server.
    ...(process.env.CHROME_EXTRA_ARGS ?? '').split(' ').filter(Boolean),
    `http://localhost:${APP_PORT}/campaign.html?server=1`,
  ]
  chromeStarted = Date.now()
  // His time zone, not the server's: the batch's days and times are his.
  const zone = readJsonSync(sessionFile)?.posting?.profile?.timezone
  chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TZ: typeof zone === 'string' && zone ? zone : 'UTC' } })
  chrome.stderr.on('data', () => {})
  log('chrome started')
  chrome.on('exit', (code, signal) => {
    log('chrome stopped', code ?? signal)
    chrome = null
    if (wanted) setTimeout(startChrome, 5000)
  })
}

function restartChrome(why) {
  log('restarting chrome:', why)
  if (chrome) chrome.kill('SIGKILL')
  else startChrome()
}

setInterval(async () => {
  if (!chrome) return
  const status = await readJson(dir('status.json'), null)
  const alive = Math.max(chromeStarted, Date.parse(status?.at ?? '') || 0)
  if (Date.now() - alive > STUCK_MS) restartChrome('the page went quiet')
}, 60_000)

// --- Files from the phone ---------------------------------------------------

const safeId = (id) => (typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null)

async function filesHere() {
  const names = await fsp.readdir(dir('files')).catch(() => [])
  const out = {}
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const meta = await readJson(dir('files', name), null)
    if (meta?.id && fs.existsSync(dir('files', meta.id))) out[meta.id] = { size: meta.size, from: meta.from }
  }
  return out
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('exit', (code) => resolve({ code, out }))
    p.on('error', () => resolve({ code: -1, out: '' }))
  })
}

/** Chrome here reads H.264, not the iPhone's HEVC: such a file (or an HDR
 *  one) is made into H.264 once, when it arrives, at a quality that keeps it
 *  as it was. Everything else is kept exactly as the phone sent it. */
async function readable(file) {
  const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,color_transfer', '-of', 'json', file])
  let stream = null
  try {
    stream = JSON.parse(probe.out).streams?.[0] ?? null
  } catch {
    return { ok: true }
  }
  if (!stream) return { ok: true }
  const hdr = ['arib-std-b67', 'smpte2084'].includes(stream.color_transfer)
  if (stream.codec_name === 'h264' && !hdr) return { ok: true }
  const out = `${file}.h264.mp4`
  const tonemap = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'
  const args = ['-v', 'error', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p']
  if (hdr) args.push('-vf', tonemap)
  args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-fps_mode', 'passthrough', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out)
  const made = await run('ffmpeg', args)
  if (made.code !== 0) return { ok: false, why: `This clip couldn't be made readable here (${stream.codec_name}).` }
  await fsp.rename(out, file)
  return { ok: true, from: stream.codec_name + (hdr ? ' HDR' : '') }
}

async function piece(id, n, total, meta, body) {
  const parts = dir('uploads', id)
  await fsp.mkdir(parts, { recursive: true })
  await fsp.writeFile(path.join(parts, String(n)), body)
  const have = (await fsp.readdir(parts)).filter((f) => /^\d+$/.test(f)).map(Number)
  if (have.length < total) return { have, done: false }
  const whole = dir('files', id)
  const tmp = `${whole}.${crypto.randomUUID()}.tmp`
  const out = fs.createWriteStream(tmp)
  for (let k = 0; k < total; k++) {
    await new Promise((resolve, reject) => {
      const from = fs.createReadStream(path.join(parts, String(k)))
      from.on('error', reject)
      from.on('end', resolve)
      from.pipe(out, { end: false })
    })
  }
  await new Promise((resolve) => out.end(resolve))
  const size = (await fsp.stat(tmp)).size
  if (size !== meta.size) {
    await fsp.rm(tmp, { force: true })
    await fsp.rm(parts, { recursive: true, force: true })
    throw new Error(`The file arrived broken (${size} of ${meta.size} bytes). It will be sent again.`)
  }
  await fsp.rename(tmp, whole)
  await fsp.rm(parts, { recursive: true, force: true })
  const made = meta.type?.startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(meta.name ?? '') ? await readable(whole) : { ok: true }
  if (!made.ok) {
    await fsp.rm(whole, { force: true })
    throw new Error(made.why)
  }
  await writeJson(dir('files', `${id}.json`), { id, name: meta.name, type: meta.type, size: meta.size, from: made.from ?? null, at: new Date().toISOString() })
  return { have, done: true }
}

// Clips no batch uses any more go: the disk is small (5 GB on Railway's Hobby
// plan). Only once no bank names a file, and the app hasn't read it for two
// days - a video still waiting to be made from a clip he took out reads it
// when its turn comes - and never in the first two days after a start.
const KEEP_UNUSED_MS = 2 * 24 * 60 * 60 * 1000
const startedAt = Date.now()
const readAt = new Map()

function bankFileIds(bank) {
  const files = [...(bank?.reactions ?? []), ...(bank?.products ?? []), ...(bank?.music ?? []), ...(bank?.steps ?? []).flatMap((s) => s.files ?? [])]
  if (bank?.formula?.left) files.push(bank.formula.left)
  if (bank?.formula?.right) files.push(bank.formula.right)
  return files.map((f) => f?.id).filter(Boolean)
}

async function sweepFiles() {
  const status = await readJson(dir('status.json'), null)
  // The page hasn't said lately what it has: keep everything.
  if (!status?.banks || Date.now() - Date.parse(status.at ?? '') > 5 * 60_000) return
  const used = new Set(Object.values(status.banks).flatMap(bankFileIds))
  for (const { bank } of Object.values((await inbox()).banks ?? {})) for (const id of bankFileIds(bank)) used.add(id)
  const now = Date.now()
  for (const name of await fsp.readdir(dir('files')).catch(() => [])) {
    if (!name.endsWith('.json')) continue
    const meta = await readJson(dir('files', name), null)
    if (!meta?.id || used.has(meta.id)) continue
    const last = Math.max(startedAt, readAt.get(meta.id) ?? 0, Date.parse(meta.at ?? '') || 0)
    if (now - last < KEEP_UNUSED_MS) continue
    await fsp.rm(dir('files', meta.id), { force: true })
    await fsp.rm(dir('files', name), { force: true })
    log('let go of', meta.name ?? meta.id, '- no batch uses it')
  }
  // Uploads cut off halfway and never finished.
  for (const name of await fsp.readdir(dir('uploads')).catch(() => [])) {
    const stat = await fsp.stat(dir('uploads', name)).catch(() => null)
    if (stat && now - stat.mtimeMs > KEEP_UNUSED_MS) await fsp.rm(dir('uploads', name), { recursive: true, force: true })
  }
}
setInterval(() => void sweepFiles().catch((error) => log('sweep', error instanceof Error ? error.message : error)), 60 * 60 * 1000)

// --- The phone's settings and asks ----------------------------------------

async function inbox() {
  return readJson(dir('inbox', 'inbox.json'), { banks: {}, commands: [] })
}

let inboxTurn = Promise.resolve()

/** One change at a time, so two arriving together never undo each other. */
function toInbox(change) {
  const turn = inboxTurn.then(async () => {
    const box = await inbox()
    change(box)
    await writeJson(dir('inbox', 'inbox.json'), box)
  })
  inboxTurn = turn.catch(() => {})
  return turn
}

// --- HTTP ------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  const json = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
  res.end(json)
}

function body(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > max) {
        reject(new Error('Too big.'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const jsonBody = async (req, max = 2_000_000) => JSON.parse((await body(req, max)).toString('utf8') || '{}')

async function freeGB() {
  try {
    const s = await fsp.statfs(DATA)
    return Math.round(((s.bavail * s.bsize) / 1e9) * 10) / 10
  } catch {
    return null
  }
}

const publicServer = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  const cors = origin && ORIGINS.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' })
    return res.end()
  }
  if (origin && !cors['access-control-allow-origin']) return send(res, 403, { error: 'Not from the Cutter.' })
  const url = new URL(req.url ?? '/', 'http://x')
  const parts = url.pathname.split('/').filter(Boolean)
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, version: VERSION }, cors)

    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    const space = await spaceFor(token)
    if (!space) return send(res, 401, { error: 'Sign in to the Cutter again.' }, cors)
    const session = await readJson(sessionFile, null)

    if (req.method === 'POST' && url.pathname === '/connect') {
      if (session && session.space !== space) return send(res, 403, { error: 'This server already makes videos for another Cutter login.' }, cors)
      // His name and posting profile (whose Postiz key, accounts, times): what
      // the app on the phone has, so the app here posts the same way.
      const { name, posting } = await jsonBody(req)
      const profile = (p) => p?.profile?.id ?? null
      // One person's videos per server: his friend's go to their own Postiz.
      if (profile(session?.posting) && profile(posting) && profile(session.posting) !== profile(posting)) {
        return send(res, 403, { error: "This server already makes videos for another person's Postiz. Each of you needs your own server." }, cors)
      }
      // A new login or profile only: the app reads them when it starts.
      const fresh = !session || session.token !== token || profile(session.posting) !== profile(posting)
      await writeJson(sessionFile, { token, space, name: typeof name === 'string' ? name : null, posting: posting ?? null, at: new Date().toISOString() })
      wanted = true
      if (fresh && chrome) restartChrome('a new login')
      else startChrome()
      return send(res, 200, { ok: true, version: VERSION, freeGB: await freeGB() }, cors)
    }
    if (!session || session.space !== space) return send(res, 403, { error: 'Connect this server in Settings first.' }, cors)

    if (req.method === 'GET' && url.pathname === '/files') return send(res, 200, { files: await filesHere() }, cors)

    if (req.method === 'PUT' && parts[0] === 'files' && parts.length === 3) {
      const id = safeId(parts[1])
      const n = Number(parts[2])
      const total = Number(url.searchParams.get('total'))
      const size = Number(url.searchParams.get('size'))
      if (!id || !Number.isInteger(n) || !Number.isInteger(total) || n < 0 || n >= total || !(size > 0)) return send(res, 400, { error: 'Bad piece.' }, cors)
      const bytes = await body(req, PIECE + 1024)
      const meta = { size, name: url.searchParams.get('name') ?? id, type: url.searchParams.get('type') ?? '' }
      return send(res, 200, await piece(id, n, total, meta, bytes), cors)
    }

    if (req.method === 'PUT' && parts[0] === 'banks' && parts.length === 2) {
      const campaignId = safeId(parts[1])
      if (!campaignId) return send(res, 400, { error: 'Bad campaign.' }, cors)
      const { bank } = await jsonBody(req)
      if (!bank || bank.campaignId !== campaignId) return send(res, 400, { error: 'Bad bank.' }, cors)
      await toInbox((box) => (box.banks[campaignId] = { bank, at: new Date().toISOString() }))
      return send(res, 200, { ok: true }, cors)
    }

    if (req.method === 'POST' && parts[0] === 'banks' && parts.length === 3 && ['start-over', 'back-to-phone'].includes(parts[2])) {
      const campaignId = safeId(parts[1])
      if (!campaignId) return send(res, 400, { error: 'Bad campaign.' }, cors)
      await toInbox((box) => box.commands.push({ id: crypto.randomUUID(), campaignId, command: parts[2], at: new Date().toISOString() }))
      return send(res, 200, { ok: true }, cors)
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      const status = await readJson(dir('status.json'), null)
      return send(res, 200, { version: VERSION, chrome: chrome ? 'running' : wanted ? 'starting' : 'off', freeGB: await freeGB(), page: status }, cors)
    }

    return send(res, 404, { error: 'Unknown.' }, cors)
  } catch (error) {
    log('error', req.method, url.pathname, error instanceof Error ? error.message : error)
    return send(res, 500, { error: error instanceof Error ? error.message : 'Something went wrong.' }, cors)
  }
})

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

const localServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  try {
    if (url.pathname === '/local/session') {
      const session = await readJson(sessionFile, null)
      return send(res, session ? 200 : 404, session ? { token: session.token, name: session.name, posting: session.posting } : { error: 'Not connected.' })
    }
    if (url.pathname.startsWith('/local/files/')) {
      const id = safeId(url.pathname.slice('/local/files/'.length))
      const meta = id ? await readJson(dir('files', `${id}.json`), null) : null
      if (!meta || !fs.existsSync(dir('files', id))) return send(res, 404, { error: 'Not here.' })
      readAt.set(id, Date.now())
      res.writeHead(200, { 'content-type': meta.type || 'application/octet-stream', 'content-length': fs.statSync(dir('files', id)).size })
      return fs.createReadStream(dir('files', id)).pipe(res)
    }
    if (url.pathname === '/local/inbox' && req.method === 'GET') return send(res, 200, await inbox())
    if (url.pathname === '/local/inbox/done' && req.method === 'POST') {
      // What the page took in: a bank is let go only if nothing newer came.
      const { banks = {}, commands = [] } = await jsonBody(req)
      await toInbox((box) => {
        for (const [id, at] of Object.entries(banks)) if (box.banks[id]?.at === at) delete box.banks[id]
        box.commands = box.commands.filter((c) => !commands.includes(c.id))
      })
      return send(res, 200, { ok: true })
    }
    if (url.pathname === '/local/status' && req.method === 'POST') {
      await writeJson(dir('status.json'), { ...(await jsonBody(req)), at: new Date().toISOString() })
      return send(res, 200, { ok: true })
    }
    if (url.pathname === '/local/log' && req.method === 'POST') {
      log('page:', (await body(req, 20_000)).toString('utf8'))
      return send(res, 200, { ok: true })
    }
    // The app itself. Never its service worker: see startChrome.
    if (/\/(sw|registerSW)\.js$/.test(url.pathname)) return send(res, 404, { error: 'No service worker here.' })
    const file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)))
    if (!file.startsWith(DIST)) return send(res, 403, { error: 'No.' })
    const stat = await fsp.stat(file).catch(() => null)
    const target = stat?.isFile() ? file : path.join(DIST, 'campaign.html')
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    return fs.createReadStream(target).pipe(res)
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : 'Something went wrong.' })
  }
})

publicServer.listen(PORT, () => log(`for the phone on :${PORT}`))
localServer.listen(APP_PORT, '127.0.0.1', () => log(`the app for chrome on 127.0.0.1:${APP_PORT}`))

// Connected before this start (a deploy, a restart): carry on at once.
if (fs.existsSync(sessionFile)) {
  wanted = true
  startChrome()
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    wanted = false
    chrome?.kill('SIGTERM')
    setTimeout(() => process.exit(0), 3000)
  })
}
