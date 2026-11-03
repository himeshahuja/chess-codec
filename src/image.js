import { parseImage } from './codec.js'

// Draws a small procedural picture so the app has something to show on load.
export function sampleCanvas() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const sky = g.createLinearGradient(0, 0, 0, 128)
  sky.addColorStop(0, '#1b1464')
  sky.addColorStop(0.55, '#c0396b')
  sky.addColorStop(1, '#ffb25b')
  g.fillStyle = sky
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#ffe9a8'
  g.beginPath()
  g.arc(64, 72, 26, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#0d0a1f'
  g.beginPath()
  g.moveTo(0, 128)
  g.lineTo(0, 92)
  g.lineTo(30, 70)
  g.lineTo(52, 96)
  g.lineTo(84, 62)
  g.lineTo(128, 100)
  g.lineTo(128, 128)
  g.fill()
  return c
}

// Scales to fit within maxSide, returns header + raw pixel bytes.
export function pixelsFromSource(source, maxSide, gray) {
  const sw = source.naturalWidth || source.width
  const sh = source.naturalHeight || source.height
  const k = Math.min(1, maxSide / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * k))
  const h = Math.max(1, Math.round(sh * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  g.imageSmoothingQuality = 'high'
  g.drawImage(source, 0, 0, w, h)
  const rgba = g.getImageData(0, 0, w, h).data
  const ch = gray ? 1 : 3
  const out = new Uint8Array(3 + w * h * ch)
  out.set([w, h, gray ? 1 : 0])
  for (let i = 0, o = 3; i < w * h; i++) {
    const r = rgba[i * 4], gr = rgba[i * 4 + 1], b = rgba[i * 4 + 2]
    if (gray) out[o++] = Math.round(0.299 * r + 0.587 * gr + 0.114 * b)
    else {
      out[o++] = r
      out[o++] = gr
      out[o++] = b
    }
  }
  return out
}

// Paints bytes onto a canvas. Pixels beyond `avail` bytes stay transparent.
export function drawPixels(canvas, bytes, avail = bytes.length) {
  const info = parseImage(bytes)
  const g = canvas.getContext('2d')
  if (!info) {
    canvas.width = canvas.height = 1
    g.clearRect(0, 0, 1, 1)
    return false
  }
  const { w, h, channels } = info
  canvas.width = w
  canvas.height = h
  const img = g.createImageData(w, h)
  const lim = Math.min(avail, bytes.length)
  for (let i = 0; i < w * h; i++) {
    const o = 3 + i * channels
    if (o + channels > lim) continue
    img.data[i * 4] = bytes[o]
    img.data[i * 4 + 1] = bytes[channels === 3 ? o + 1 : o]
    img.data[i * 4 + 2] = bytes[channels === 3 ? o + 2 : o]
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return true
}

// Marks pixels (in the original's geometry) whose bytes differ in the decoded stream.
export function drawDiff(canvas, orig, dec) {
  const info = parseImage(orig)
  const g = canvas.getContext('2d')
  const { w, h, channels } = info
  canvas.width = w
  canvas.height = h
  const img = g.createImageData(w, h)
  let changed = 0
  for (let i = 0; i < w * h; i++) {
    const o = 3 + i * channels
    let diff = false
    for (let c = 0; c < channels; c++) if (orig[o + c] !== dec[o + c]) diff = true
    if (diff) {
      changed++
      img.data.set([251, 113, 133, 255], i * 4)
    } else {
      const v = channels === 3 ? orig[o] * 0.3 + orig[o + 1] * 0.59 + orig[o + 2] * 0.11 : orig[o]
      img.data.set([v * 0.35, v * 0.35, v * 0.35, 255], i * 4)
    }
  }
  g.putImageData(img, 0, 0)
  return changed
}
