import { Chess } from 'chess.js'
import { START_FEN, strip, bitsFor, candidates, encode, replay, toBytes, edit, parseMoves, toPgn } from './codec.js'
import { sampleCanvas, pixelsFromSource, drawPixels, drawDiff } from './image.js'

const $ = (id) => document.getElementById(id)
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
const files = 'abcdefgh'

const state = {
  origBytes: null,
  origSans: [],
  plies: [],
  decoded: new Uint8Array(),
  cur: 0,
  playing: false,
  selected: null,
  targets: [],
}

/* ---------- board ---------- */

const boardEl = $('board')
const squares = []
for (let r = 0; r < 8; r++) {
  for (let f = 0; f < 8; f++) {
    const el = document.createElement('div')
    const name = files[f] + (8 - r)
    el.className = 'sq ' + ((r + f) % 2 ? 'd' : 'l')
    el.dataset.sq = name
    if (f === 0) el.insertAdjacentHTML('beforeend', `<span class="coord r">${8 - r}</span>`)
    if (r === 7) el.insertAdjacentHTML('beforeend', `<span class="coord f">${files[f]}</span>`)
    boardEl.append(el)
    squares.push(el)
  }
}

const fenAt = (cur) => (cur === 0 ? START_FEN : state.plies[cur - 1].fen)

function renderBoard() {
  const fen = fenAt(state.cur)
  const last = state.cur ? state.plies[state.cur - 1] : null
  const rows = fen.split(' ')[0].split('/')
  rows.forEach((row, r) => {
    let f = 0
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < +ch; i++) setSquare(r, f++, null)
      } else setSquare(r, f++, ch)
    }
  })
  squares.forEach((el) => {
    const sq = el.dataset.sq
    el.classList.toggle('last', !!last && (sq === last.from || sq === last.to))
    el.classList.toggle('sel', sq === state.selected)
    const tgt = state.targets.includes(sq)
    el.classList.toggle('tgt', tgt)
    el.classList.toggle('has', tgt && !!el.querySelector('.pc'))
  })
}

function setSquare(r, f, ch) {
  const el = squares[r * 8 + f]
  let pc = el.querySelector('.pc')
  if (!ch) return pc?.remove()
  if (!pc) {
    pc = document.createElement('span')
    el.append(pc)
  }
  const white = ch === ch.toUpperCase()
  pc.className = 'pc ' + (white ? 'w' : 'b')
  pc.textContent = GLYPH[ch.toLowerCase()] + '︎'
}

boardEl.addEventListener('click', (e) => {
  const sq = e.target.closest('.sq')?.dataset.sq
  if (!sq || !state.plies.length) return
  pause()
  const fen = fenAt(state.cur)
  if (state.selected && state.targets.includes(sq)) {
    const chess = new Chess(fen)
    const moves = chess.moves({ verbose: true }).filter((m) => m.from === state.selected && m.to === sq)
    const m = moves.find((x) => x.promotion === 'q') ?? moves[0]
    state.selected = null
    state.targets = []
    applyEdit(state.cur, m.san)
    return
  }
  const chess = new Chess(fen)
  const piece = chess.get(sq)
  if (piece && piece.color === chess.turn() && sq !== state.selected) {
    state.selected = sq
    state.targets = chess.moves({ verbose: true, square: sq }).map((m) => m.to)
  } else {
    state.selected = null
    state.targets = []
  }
  renderBoard()
})

/* ---------- playback ---------- */

const play = $('play')
let raf = 0
let acc = 0
let lastT = 0

function tick(t) {
  if (!state.playing) return
  acc += ((t - lastT) / 1000) * +$('speed').value
  lastT = t
  const step = Math.floor(acc)
  if (step) {
    acc -= step
    setCur(Math.min(state.plies.length, state.cur + step), { light: true })
  }
  if (state.cur >= state.plies.length) pause()
  else raf = requestAnimationFrame(tick)
}

function startPlay() {
  if (state.cur >= state.plies.length) state.cur = 0
  state.playing = true
  state.selected = null
  state.targets = []
  play.textContent = '⏸'
  lastT = performance.now()
  raf = requestAnimationFrame(tick)
}

function pause() {
  if (!state.playing) return
  state.playing = false
  cancelAnimationFrame(raf)
  play.textContent = '▶'
  setCur(state.cur)
}

play.onclick = () => (state.playing ? pause() : startPlay())
$('first').onclick = () => (pause(), setCur(0))
$('last').onclick = () => (pause(), setCur(state.plies.length))
$('prev').onclick = () => (pause(), setCur(Math.max(0, state.cur - 1)))
$('next').onclick = () => (pause(), setCur(Math.min(state.plies.length, state.cur + 1)))
$('scrub').oninput = (e) => setCur(+e.target.value, { light: state.playing })
document.addEventListener('keydown', (e) => {
  if (/TEXTAREA|SELECT|INPUT/.test(e.target.tagName) && e.target.type !== 'range') return
  if (e.key === 'ArrowLeft') $('prev').click()
  else if (e.key === 'ArrowRight') $('next').click()
  else if (e.key === ' ') (e.preventDefault(), play.click())
})

/* ---------- views ---------- */

function setCur(cur, { light = false } = {}) {
  state.cur = cur
  if (!light) {
    state.selected = null
    state.targets = []
  }
  $('scrub').value = cur
  renderBoard()
  renderDecoded()
  highlightMove()
  if (!light) renderAlternatives()
  renderStatus()
}

function bitsAt(cur) {
  if (!cur) return 0
  const p = state.plies[cur - 1]
  return p.bitStart + p.b
}

function renderDecoded() {
  const done = state.cur >= state.plies.length
  drawPixels($('decoded'), state.decoded, done ? state.decoded.length : bitsAt(state.cur) >> 3)
}

function renderStatus() {
  const n = state.plies.length
  const p = state.cur ? state.plies[state.cur - 1] : null
  const move = p ? `${Math.ceil(state.cur / 2)}${state.cur % 2 ? '.' : '…'} <b>${p.san}</b>` : 'start'
  const enc = p ? (p.inCode ? `<b>${p.b}</b> bit${p.b === 1 ? '' : 's'} <b>${p.b ? p.value.toString(2).padStart(p.b, '0') : '—'}</b>` : '<span style="color:var(--warn)">no code for this move</span>') : ''
  $('status').innerHTML = `ply <b>${state.cur}</b> / ${n} · ${move}${enc ? ' · ' + enc : ''}<br>bit <b>${bitsAt(state.cur).toLocaleString()}</b> / ${bitsAt(n).toLocaleString()}`
}

let activeEl = null
function highlightMove() {
  activeEl?.classList.remove('active')
  activeEl = state.cur ? $('moves').querySelector(`[data-i="${state.cur - 1}"]`) : null
  if (activeEl) {
    activeEl.classList.add('active')
    if (!state.playing || state.cur % 8 === 0) activeEl.scrollIntoView({ block: 'nearest' })
  }
}

function renderMoves() {
  let html = ''
  state.plies.forEach((p, i) => {
    if (i % 2 === 0) html += `<div class="mrow"><span class="num">${i / 2 + 1}</span>`
    const o = state.origSans[i]
    const cls = !p.inCode ? 'bad' : o === undefined || strip(o) !== strip(p.san) ? 'changed' : ''
    html += `<button class="mv ${cls}" data-i="${i}">${p.san}<small>${p.b ? p.value.toString(2).padStart(p.b, '0') : ''}</small></button>`
    if (i % 2 === 1 || i === state.plies.length - 1) html += '</div>'
  })
  $('moves').innerHTML = html
  activeEl = null
}

$('moves').addEventListener('click', (e) => {
  const b = e.target.closest('.mv')
  if (!b) return
  pause()
  setCur(+b.dataset.i + 1)
})

function renderAlternatives() {
  const chess = new Chess(fenAt(state.cur))
  const cand = candidates(chess)
  const b = bitsFor(cand.length)
  const played = state.plies[state.cur]
  $('alt-title').textContent = cand.length
    ? `Ply ${state.cur + 1} · ${cand.length} moves · ${b} bit${b === 1 ? '' : 's'}${played ? '' : ' · append'}`
    : 'No moves'
  $('alts').innerHTML = cand
    .map((m, i) => {
      const code = i < 1 << b
      const cur = played && strip(played.san) === strip(m) ? ' cur' : ''
      return `<button class="alt${cur}${code ? '' : ' nocode'}" data-san="${m}"><i>${code && b ? i.toString(2).padStart(b, '0') : '·'}</i>${m}</button>`
    })
    .join('')
}

$('alts').addEventListener('click', (e) => {
  const b = e.target.closest('.alt')
  if (b) applyEdit(state.cur, b.dataset.san)
})

function renderPgn() {
  $('pgn').value = toPgn(state.plies.map((p) => p.san))
}

function renderResults() {
  const orig = state.origBytes
  const dec = state.decoded
  const n = state.plies.length
  const info = drawPixels($('original'), orig)
  const changedPx = drawDiff($('diff'), orig, dec)
  let diffBits = 0
  let first = -1
  const len = Math.max(orig.length, dec.length)
  for (let i = 0; i < len; i++) {
    const x = (orig[i] ?? 0) ^ (dec[i] ?? 0)
    if (x) {
      if (first < 0) first = i * 8 + Math.clz32(x) - 24
      let v = x
      while (v) (diffBits += v & 1), (v >>= 1)
    }
  }
  const total = bitsAt(n)
  const needs = orig.length * 8
  const px = orig[0] * orig[1]
  let firstPly = -1
  if (first >= 0) {
    firstPly = state.plies.findIndex((p) => p.bitStart + p.b > first)
  }
  const edits = state.plies.filter((p, i) => strip(p.san) !== strip(state.origSans[i] ?? '')).length
  $('stats').innerHTML = [
    `Image needs <b>${needs.toLocaleString()}</b> bits · game carries <b>${total.toLocaleString()}</b> (${(total / Math.max(1, n)).toFixed(2)} bits/ply)`,
    `Edited plies <b>${edits}</b> · changed bits <span class="${diffBits ? 'bad' : ''}"><b>${diffBits.toLocaleString()}</b></span> · changed pixels <b>${changedPx}</b> / ${px}`,
    firstPly >= 0 ? `First divergence at bit <b>${first.toLocaleString()}</b> → <button class="link" id="jump">ply ${firstPly + 1}</button>` : 'Decoded image matches the original',
  ]
    .map((s) => `<div>${s}</div>`)
    .join('')
  $('jump')?.addEventListener('click', () => (pause(), setCur(firstPly + 1)))
  void info
}

/* ---------- game loading / editing ---------- */

function loadSans(sans, { cur, keepOrig = true } = {}) {
  const res = replay(sans)
  if (res.error) {
    toast(`Illegal move at ply ${res.error.ply + 1}: ${res.error.san}`)
    return false
  }
  state.plies = res.plies
  state.decoded = toBytes(res.plies)
  if (!keepOrig) {
    state.origSans = sans.slice()
  }
  $('scrub').max = state.plies.length
  renderMoves()
  renderPgn()
  renderResults()
  setCur(Math.min(cur ?? state.cur, state.plies.length))
  return true
}

function applyEdit(k, san) {
  pause()
  try {
    const sans = edit(state.plies, k, san)
    if (loadSans(sans, { cur: k + 1 })) {
      const p = state.plies[k]
      if (p && !p.inCode) toast('That move has no code — the encoder would never play it')
    }
  } catch (err) {
    toast(String(err.message ?? err))
  }
}

$('reset').onclick = () => {
  pause()
  loadSans(state.origSans, { cur: state.cur })
}

$('apply').onclick = () => {
  pause()
  const sans = parseMoves($('pgn').value)
  loadSans(sans, { cur: state.cur })
}
$('copy').onclick = () => navigator.clipboard.writeText($('pgn').value).then(() => toast('Copied'))
$('download').onclick = () => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([$('pgn').value], { type: 'text/plain' }))
  a.download = 'encoded.pgn'
  a.click()
}
$('pgnfile').onchange = async (e) => {
  const f = e.target.files[0]
  if (!f) return
  $('pgn').value = await f.text()
  $('apply').click()
}

/* ---------- encoding ---------- */

let source = null

function encodeSource() {
  if (!source) return
  pause()
  $('busy').textContent = 'Encoding…'
  $('encode').disabled = true
  setTimeout(() => {
    try {
      const bytes = pixelsFromSource(source, +$('size').value, $('mode').value === '1')
      const sans = encode(bytes)
      state.origBytes = bytes
      if (loadSans(sans, { cur: 0, keepOrig: false })) {
        toast(`${bytes.length.toLocaleString()} bytes → ${sans.length.toLocaleString()} plies`)
      }
    } catch (err) {
      toast(String(err.message ?? err))
    }
    $('busy').textContent = ''
    $('encode').disabled = false
  }, 30)
}

$('encode').onclick = encodeSource
$('file').onchange = async (e) => {
  const f = e.target.files[0]
  if (!f) return
  source = await createImageBitmap(f)
  encodeSource()
}
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', async (e) => {
  e.preventDefault()
  const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'))
  if (f) {
    source = await createImageBitmap(f)
    encodeSource()
  }
})

let toastTimer
function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200)
}

source = sampleCanvas()
encodeSource()
