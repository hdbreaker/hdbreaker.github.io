/**
 * Generates SVG cover images for every post.
 *
 * Not AI art: every cover is grown from the post's slug with a seeded PRNG, so it
 * is unique per post, stable across runs, and locked to the site palette.
 *
 * The subject is PCB routing drawn the way real board art looks:
 *
 *  - Hairlines, not heavy strokes. Earlier versions used 5-9px so they would read
 *    at thumbnail size, and the weight is exactly what made them look clumsy.
 *    Reference board art is delicate; the SVG scales, so detail survives on
 *    retina even when the stroke lands near a pixel.
 *  - Traces branch. Trunks descend from the top edge, split at 45°, and end — that
 *    growth is what reads as routing instead of as a set of parallel lines.
 *  - Terminations are dots, rings and concentric targets, not chunky pads.
 *  - Some runs travel as bundles: two or three traces held at constant spacing,
 *    the single most recognisable feature of a real board.
 *  - Density is uneven and one side of the frame is left sparse.
 *  - Exactly one net is live, in volt green.
 *
 * The card window is 300x208 (1.442) and the canvas is 900x620 (1.452), so the
 * crop is under one percent and the full frame can be composed with confidence.
 *
 * These are a fallback, not content: PostCard uses a post's own `coverImage` when
 * it has one and reaches for `covers/<slug>.svg` otherwise. So giving a post real
 * artwork is two lines of frontmatter, and deleting them reverts to the generated
 * board. One is produced for every slug on every build.
 *
 * Usage:  node scripts/generate-covers.mjs
 */
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const POSTS = 'src/content/post'
const OUT = 'public/assets/blog/covers'

const W = 900
const H = 620
const STEP = 20 // routing grid

const BG = '#0B0D14'
const BG2 = '#141828'
const VOLT = '#57FD6B'
const LINE = '#4A5578'
const FAINT = '#222840'

const THIN = 3
const LIVE = 4.5

/** Mulberry32, seeded from a string: same post, same cover, every run. */
function rng(seed) {
	let a = 0
	for (const ch of seed) a = (a * 31 + ch.charCodeAt(0)) >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}
const range = (n) => [...Array(n).keys()]
const snap = (v) => Math.round(v / STEP) * STEP

/* ------------------------------------------------------------ terminations --- */

/** Dot, ring, or concentric target — the three endings real board art uses. */
function cap(r, x, y, hot) {
	const c = hot ? VOLT : LINE
	const kind = r()
	if (kind < 0.42) return `<circle cx="${x}" cy="${y}" r="${hot ? 7 : 5.5}" fill="${c}"/>`
	if (kind < 0.76)
		return `<circle cx="${x}" cy="${y}" r="${hot ? 10 : 8}" fill="none" stroke="${c}" stroke-width="${hot ? 4 : 3}"/>`
	return `<circle cx="${x}" cy="${y}" r="${hot ? 13 : 11}" fill="none" stroke="${c}" stroke-width="${hot ? 4 : 3}"/><circle cx="${x}" cy="${y}" r="${hot ? 5 : 4}" fill="${c}"/>`
}

/* -------------------------------------------------------------------- grow --- */

/**
 * Grows one trace downward from (x, y): vertical runs joined by 45° corners, with
 * a chance to fork. Pushes paths and caps into `out`; recurses on forks.
 *
 * `bundle` draws the run as 2-3 parallel traces at constant spacing, which is the
 * detail that makes it look like a board rather than a diagram.
 */
function grow(r, x, y, out, opts) {
	const { end, depth, hot, bundle } = opts
	let cx = x
	let cy = y
	const pts = [[cx, cy]]
	let guard = 0

	while (cy < end && guard++ < 14) {
		// vertical run
		const drop = STEP * (2 + Math.floor(r() * 5))
		cy = Math.min(cy + drop, end)
		pts.push([cx, cy])
		if (cy >= end) break

		// 45° corner, sometimes
		if (r() > 0.42) {
			const dir = r() > 0.5 ? 1 : -1
			const d = STEP * (1 + Math.floor(r() * 2))
			const nx = cx + dir * d
			if (nx > 40 && nx < W - 40) {
				cy += d
				cx = nx
				pts.push([cx, cy])
			}
		}

		// fork: a child branches away and grows on its own
		if (depth < 2 && r() > 0.66) {
			const dir = r() > 0.5 ? 1 : -1
			const d = STEP * 2
			const bx = cx + dir * d
			if (bx > 60 && bx < W - 60) {
				out.paths.push(
					`<path d="M ${cx} ${cy} L ${bx} ${cy + d}" fill="none" stroke="${LINE}" stroke-width="${THIN}"/>`
				)
				grow(r, bx, cy + d, out, {
					end: end - STEP * (2 + Math.floor(r() * 6)),
					depth: depth + 1,
					hot: false,
					bundle: false
				})
			}
		}

		// stop early sometimes, so trunks reach different heights
		if (r() > 0.82) break
	}

	const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'} ${px} ${py}`).join(' ')
	const stroke = hot ? VOLT : LINE
	const width = hot ? LIVE : THIN

	if (bundle) {
		// parallel siblings, offset horizontally: a routed bus
		const n = 2 + Math.floor(r() * 2)
		range(n).forEach((k) => {
			const off = (k + 1) * 7
			const dd = pts.map(([px, py], i) => `${i ? 'L' : 'M'} ${px + off} ${py + off}`).join(' ')
			out.paths.push(
				`<path d="${dd}" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${hot ? 0.75 : 0.5}"/>`
			)
			const [ex, ey] = pts[pts.length - 1]
			out.caps.push(cap(r, ex + off, ey + off, false))
		})
	}

	out.paths.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`)
	const [ex, ey] = pts[pts.length - 1]
	out.caps.push(cap(r, ex, ey, hot))
}

/* ------------------------------------------------------------------- frame --- */

function svg(slug) {
	const r = rng(slug)
	const out = { paths: [], caps: [] }

	// trunks descend from the top edge, clustered rather than evenly spread, and
	// biased to one half so the other stays sparse
	const trunks = 5 + Math.floor(r() * 4)
	const leftHeavy = r() > 0.5
	const spread = 0.52 + r() * 0.24
	const base = leftHeavy ? 0.06 : 1 - spread - 0.06

	const hot = Math.floor(r() * trunks)
	const bundled = Math.floor(r() * trunks)

	range(trunks).forEach((i) => {
		const t = (i + 0.5) / trunks
		const x = snap(W * (base + spread * t) + (r() - 0.5) * STEP * 3)
		grow(r, x, -20, out, {
			end: snap(H - 90 - r() * 300),
			depth: 0,
			hot: i === hot,
			bundle: i === bundled
		})
	})

	// loose vias, denser on the busy side
	const loose = range(6 + Math.floor(r() * 6))
		.map(() => {
			const x = snap(W * (leftHeavy ? r() * 0.7 : 0.3 + r() * 0.7))
			const y = snap(80 + r() * (H - 140))
			return `<circle cx="${x}" cy="${y}" r="3.5" fill="${FAINT}"/>`
		})
		.join('\n    ')

	const gx = leftHeavy ? 0.34 : 0.66

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG2}"/><stop offset="1" stop-color="${BG}"/>
    </linearGradient>
    <radialGradient id="glow" cx="${gx}" cy="0.18" r="0.72">
      <stop offset="0" stop-color="${VOLT}" stop-opacity="0.13"/>
      <stop offset="1" stop-color="${VOLT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <g stroke-linecap="round" stroke-linejoin="round">
    ${loose}
    ${out.paths.join('\n    ')}
    ${out.caps.join('\n    ')}
  </g>
</svg>
`
}

/* ------------------------------------------------------------------- main --- */

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// One per slug, unconditionally. PostCard falls back to these when a post does
// not name its own coverImage, so every post must have one waiting. Output is
// deterministic, so re-running produces no diff.
let made = 0
for (const file of readdirSync(POSTS).filter((f) => f.endsWith('.md'))) {
	const slug = file.replace(/\.md$/, '')
	writeFileSync(join(OUT, `${slug}.svg`), svg(slug))
	made++
}
console.log(`  ${made} covers en ${OUT}`)
