import { Chess } from 'chess.js'

// Scheme: at every position the legal moves are sorted alphabetically (SAN).
// With n candidates the move carries floor(log2 n) bits: bits value v -> cand[v].
// Moves that deliver checkmate (or stalemate) are excluded so the game never
// ends early. Data is read MSB-first, one chunk per ply, zero-padded at the end.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const strip = (san) => san.replace(/[+#!?]/g, '')
export const bitsFor = (n) => (n < 2 ? 0 : 31 - Math.clz32(n))

const countPieces = (fen, upper) => {
  const placement = fen.split(' ')[0]
  let n = 0
  for (const c of placement) if (/[a-z]/i.test(c) && (c === c.toUpperCase()) === upper) n++
  return n
}

export function candidates(chess) {
  const moves = chess.moves().filter((m) => !m.endsWith('#'))
  // Stalemate is only plausible when the defender is nearly bare; skip the cost otherwise.
  const defenderIsWhite = chess.turn() === 'b'
  if (countPieces(chess.fen(), defenderIsWhite) <= 3) {
    return moves
      .filter((m) => {
        chess.move(m)
        const stale = chess.isStalemate()
        chess.undo()
        return !stale
      })
      .sort()
  }
  return moves.sort()
}

export function encode(bytes) {
  const chess = new Chess()
  const total = bytes.length * 8
  const sans = []
  let pos = 0
  while (pos < total) {
    const cand = candidates(chess)
    if (!cand.length) {
      throw new Error(`Game dead-ended at ply ${sans.length} with ${total - pos} bits left`)
    }
    const b = bitsFor(cand.length)
    let v = 0
    for (let i = 0; i < b; i++, pos++) {
      const bit = pos < total ? (bytes[pos >> 3] >> (7 - (pos & 7))) & 1 : 0
      v = (v << 1) | bit
    }
    sans.push(cand[v])
    chess.move(cand[v])
  }
  return sans
}

// Replays a SAN list. Each ply records what it encodes:
//   idx    position in the candidate list (-1 if not a candidate, e.g. a mating move)
//   value  the bits it contributes (idx masked to b bits)
//   inCode false if the move is legal but cannot be produced by the encoder
export function replay(sans) {
  const chess = new Chess()
  const plies = []
  let bit = 0
  for (const raw of sans) {
    const cand = candidates(chess)
    const want = strip(raw)
    const idx = cand.findIndex((c) => strip(c) === want)
    let move
    try {
      move = chess.move(idx >= 0 ? cand[idx] : want)
    } catch {
      return { plies, bits: bit, error: { ply: plies.length, san: raw } }
    }
    const b = bitsFor(cand.length)
    const inCode = idx >= 0 && idx < 1 << b
    plies.push({
      san: move.san,
      from: move.from,
      to: move.to,
      fen: chess.fen(),
      n: cand.length,
      b,
      idx,
      value: idx >= 0 ? idx & ((1 << b) - 1) : 0,
      inCode,
      bitStart: bit,
    })
    bit += b
  }
  return { plies, bits: bit, error: null }
}

export function toBytes(plies) {
  const last = plies[plies.length - 1]
  const total = last ? last.bitStart + last.b : 0
  const bytes = new Uint8Array(Math.ceil(total / 8))
  for (const p of plies) {
    for (let i = 0; i < p.b; i++) {
      if ((p.value >> (p.b - 1 - i)) & 1) {
        const pos = p.bitStart + i
        bytes[pos >> 3] |= 0x80 >> (pos & 7)
      }
    }
  }
  return bytes
}

// Replace ply k with newSan. Later moves are kept where still legal; otherwise
// the move at the same candidate index is used. Returns the new SAN list.
export function edit(plies, k, newSan) {
  const chess = k === 0 ? new Chess() : new Chess(plies[k - 1].fen)
  const move = chess.move(strip(newSan))
  const sans = plies.slice(0, k).map((p) => p.san)
  sans.push(move.san)
  for (let i = k + 1; i < plies.length; i++) {
    const cand = candidates(chess)
    if (!cand.length) break
    const want = strip(plies[i].san)
    const san = cand.find((c) => strip(c) === want) ?? cand[Math.max(plies[i].idx, 0) % cand.length]
    sans.push(san)
    chess.move(san)
  }
  return sans
}

// Header: [w, h, mode] then pixels. mode 0 = RGB, 1 = grayscale.
export function parseImage(bytes) {
  if (bytes.length < 3) return null
  const [w, h, mode] = bytes
  if (!w || !h || mode > 1) return null
  return { w, h, mode, channels: mode ? 1 : 3 }
}

export function parseMoves(text) {
  return text
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
}

export function toPgn(sans) {
  let out = '[Event "Chess Codec"]\n[Site "?"]\n[Result "*"]\n\n'
  let line = ''
  sans.forEach((san, i) => {
    const tok = (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + san
    if (line.length + tok.length + 1 > 80) {
      out += line + '\n'
      line = tok
    } else line = line ? `${line} ${tok}` : tok
  })
  return `${out}${line} *\n`
}
