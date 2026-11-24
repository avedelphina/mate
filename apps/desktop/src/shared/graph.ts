/**
 * Where to draw each document of a graph of links, so that linked ones are near and the rest apart: a
 * force layout (Fruchterman and Reingold). Every pair pushes apart, every link pulls together, and the
 * push cools. It starts from a circle and uses no random numbers, so one graph is always drawn the same.
 * Gives a point in a 1000 by 1000 box for each id, in the order of `ids`. Each link is two indexes.
 */
// ponytail: every pair is looked at on every step, so it is for a few hundred documents. Past that wants a grid.
export function layout(ids: string[], links: [number, number][], steps = 300): { x: number; y: number }[] {
  const n = ids.length
  if (n === 0) return []
  if (n === 1) return [{ x: 500, y: 500 }]
  const x = ids.map((_, at) => 500 + 300 * Math.cos((2 * Math.PI * at) / n))
  const y = ids.map((_, at) => 500 + 300 * Math.sin((2 * Math.PI * at) / n))
  const k = Math.sqrt((1000 * 1000) / n) * 0.7
  let heat = 120
  for (let step = 0; step < steps; step++) {
    const dx = new Array<number>(n).fill(0)
    const dy = new Array<number>(n).fill(0)
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        let ex = x[a] - x[b]
        let ey = y[a] - y[b]
        let d = Math.hypot(ex, ey)
        // Two on one point are pushed apart along a line of their own.
        if (d < 0.01) (ex = 0.01 * (a + 1)), (ey = 0.01 * (b + 1)), (d = Math.hypot(ex, ey))
        const push = (k * k) / d
        dx[a] += (ex / d) * push
        dy[a] += (ey / d) * push
        dx[b] -= (ex / d) * push
        dy[b] -= (ey / d) * push
      }
    }
    for (const [a, b] of links) {
      const ex = x[a] - x[b]
      const ey = y[a] - y[b]
      const d = Math.max(Math.hypot(ex, ey), 0.01)
      const pull = (d * d) / k
      dx[a] -= (ex / d) * pull
      dy[a] -= (ey / d) * pull
      dx[b] += (ex / d) * pull
      dy[b] += (ey / d) * pull
    }
    for (let at = 0; at < n; at++) {
      // A little pull to the middle keeps documents with no link from drifting away.
      dx[at] -= (x[at] - 500) * 0.05
      dy[at] -= (y[at] - 500) * 0.05
      const d = Math.max(Math.hypot(dx[at], dy[at]), 0.01)
      const move = Math.min(d, heat)
      x[at] += (dx[at] / d) * move
      y[at] += (dy[at] / d) * move
    }
    heat = Math.max(heat * 0.97, 1)
  }
  // Fit the drawing to the box.
  const [left, right, top, bottom] = [Math.min(...x), Math.max(...x), Math.min(...y), Math.max(...y)]
  const scale = 900 / Math.max(right - left, bottom - top, 1)
  return x.map((_, at) => ({ x: 50 + (x[at] - left) * scale + (900 - (right - left) * scale) / 2, y: 50 + (y[at] - top) * scale + (900 - (bottom - top) * scale) / 2 }))
}
