import assert from 'node:assert'
import { Chess } from 'chess.js'
import { encode, replay, toBytes, edit, toPgn, parseMoves } from '../src/codec.js'

const rand = (n) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256))
const same = (a, b, n) => a.slice(0, n).every((v, i) => v === b[i])

for (const size of [1, 16, 300, 3075]) {
  for (let trial = 0; trial < 3; trial++) {
    const data = rand(size)
    const t0 = performance.now()
    const sans = encode(data)
    const t1 = performance.now()
    const res = replay(sans)
    assert.equal(res.error, null)
    assert.ok(res.plies.every((p) => p.inCode))
    assert.ok(same(toBytes(res.plies), data, size), 'roundtrip mismatch')

    // legal in an independent engine, and never ends early
    const c = new Chess()
    sans.forEach((s) => c.move(s))
    const pgnMoves = parseMoves(toPgn(sans))
    assert.deepEqual(pgnMoves, sans)

    if (trial === 0) {
      console.log(`${size}B -> ${sans.length} plies (${(size * 8 / sans.length).toFixed(2)} b/ply) enc ${(t1 - t0).toFixed(0)}ms`)
    }
  }
}

// edit: only the changed ply's bits (and anything after) may differ
const data = rand(400)
const base = replay(encode(data)).plies
const k = Math.floor(base.length / 2)
const alt = base[k].idx === 0 ? 1 : 0
const cand = new Chess(base[k - 1].fen).moves().sort()
const sans = edit(base, k, cand[alt])
const res = replay(sans)
assert.equal(res.error, null)
const out = toBytes(res.plies)
const firstDiff = base[k].bitStart >> 3
assert.ok(same(out, toBytes(base), firstDiff), 'bits before edit must be untouched')
console.log('edit at ply', k, 'ok; plies', base.length, '->', res.plies.length)
console.log('all good')
