/**
 * Seals a post: renders it, bundles its images with it, encrypts the lot, and
 * writes one opaque blob into public/vault/.
 *
 * Why not just unlist it: this repository is public, and a URL is a file path.
 * Anyone who can list the repo can read the path, so no amount of hiding keeps a
 * secret whose secret *is* a path — one `grep -rn 'hidden: true'` was enough. The
 * fix is to stop protecting the address and protect the content instead. The path
 * can then be as public as it likes.
 *
 * What ends up committed is the blob and a post file with no body. The plaintext
 * markdown and the original images live in content-private/, which is gitignored.
 *
 * Images go inside the same blob rather than staying in public/assets/. Screenshot
 * filenames tend to name their subject, so encrypting the prose and leaving them
 * next to it protects nothing.
 *
 * Raw bytes, not base64: data URIs would inflate 1.4 MB of screenshots by a third
 * for nothing, since the browser can build blob: URLs from the bytes directly.
 *
 * Code blocks are highlighted here with Shiki on the dracula theme, the same one
 * the rest of the site uses. They cannot go through astro-expressive-code: that
 * runs at build time over content Astro can see, and this content only exists
 * after someone types the key. Shiki writes its colours as inline styles, so the
 * injected HTML paints itself with no stylesheet to ship alongside it — which
 * plain marked output does not, leaving bare <pre> blocks that read as body text.
 *
 * Layout of the blob:
 *
 *   [16] salt        PBKDF2 salt
 *   [12] iv          AES-GCM nonce
 *   [..] ciphertext  AES-GCM(container), tag appended
 *
 * and the container inside it:
 *
 *   [4]  header length, big endian
 *   [..] header JSON: { html: {off,len}, assets: [{name,type,off,len}] }
 *   [..] payloads, concatenated
 *
 * IMPORTANT: sealing the current commit does not remove the plaintext from git
 * history. Earlier commits still carry it, and `git show <sha>:<path>` will print
 * it. Purging that needs a history rewrite and a force push, which is a separate
 * and destructive decision.
 *
 * Usage:
 *   node scripts/seal-post.mjs <slug> '<flag>'
 *
 * Do not commit the flag, and clear it from your shell history.
 */
import { createHash, pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { marked } from 'marked'
import { codeToHtml } from 'shiki'

const PRIVATE = 'content-private'
const VAULT = 'public/vault'
const ITERATIONS = 210_000

const MIME = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml'
}

const [slug, flag] = process.argv.slice(2)

if (!slug || !flag) {
	console.error("usage: node scripts/seal-post.mjs <slug> '<flag>'")
	process.exit(1)
}

const source = join(PRIVATE, `${slug}.md`)

if (!existsSync(source)) {
	console.error(`  no encuentro ${source}`)
	process.exit(1)
}

/* ------------------------------------------------------------------ render --- */

const raw = readFileSync(source, 'utf8')
const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)

if (!match) {
	console.error(`  ${source} no tiene frontmatter`)
	process.exit(1)
}

const [, frontmatter, body] = match

let html = marked.parse(body, { async: false, gfm: true })

// Swap marked's bare <pre><code> for Shiki's highlighted markup. Done after
// marked rather than through a custom renderer so the fence language survives.
const fences = [...html.matchAll(/<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g)]

for (const [tag, language, escaped] of fences) {
	const code = escaped
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\n$/, '')

	// An unknown or missing language must not fail the seal — fall back to plain
	// text, which still gets the frame and the background.
	let highlighted
	try {
		highlighted = await codeToHtml(code, { lang: language ?? 'text', theme: 'dracula' })
	} catch {
		highlighted = await codeToHtml(code, { lang: 'text', theme: 'dracula' })
	}
	html = html.replace(tag, highlighted)
}

// Point every image at its bundled copy instead of a path under public/. The
// browser fills these in from blob: URLs after decrypting.
const referenced = new Set()
html = html.replace(/<img\b[^>]*>/g, (tag) => {
	const src = tag.match(/\ssrc="([^"]+)"/)
	if (!src) return tag
	const name = basename(src[1])
	referenced.add(name)
	return tag.replace(/\ssrc="[^"]+"/, ` data-asset="${name}"`)
})

/* ------------------------------------------------------------------ bundle --- */

const assetDir = join(PRIVATE, 'assets')
const available = existsSync(assetDir) ? readdirSync(assetDir) : []
const missing = [...referenced].filter((name) => !available.includes(name))

if (missing.length) {
	console.error(`  faltan en ${assetDir}: ${missing.join(', ')}`)
	process.exit(1)
}

const payloads = []
const assets = []
let offset = 0

const push = (bytes) => {
	const at = offset
	payloads.push(bytes)
	offset += bytes.length
	return at
}

const htmlBytes = Buffer.from(html, 'utf8')
const htmlAt = push(htmlBytes)

for (const name of referenced) {
	const bytes = readFileSync(join(assetDir, name))
	assets.push({
		name,
		type: MIME[extname(name).toLowerCase()] ?? 'application/octet-stream',
		off: push(bytes),
		len: bytes.length
	})
}

// The real title and description travel inside the blob too. Left in the public
// frontmatter they describe the vulnerability to anyone reading the repo, which
// undoes most of the point of encrypting the body.
const field = (name) => frontmatter.match(new RegExp(`^${name}:\\s*"(.*)"\\s*$`, 'm'))?.[1]

const header = Buffer.from(
	JSON.stringify({
		title: field('title'),
		description: field('description'),
		html: { off: htmlAt, len: htmlBytes.length },
		assets
	}),
	'utf8'
)
const headerLength = Buffer.alloc(4)
headerLength.writeUInt32BE(header.length)

const container = Buffer.concat([headerLength, header, ...payloads])

/* ------------------------------------------------------------------- seal ---- */

const salt = randomBytes(16)
const iv = randomBytes(12)
const key = pbkdf2Sync(flag, salt, ITERATIONS, 32, 'sha256')

const cipher = createCipheriv('aes-256-gcm', key, iv)
const sealed = Buffer.concat([salt, iv, cipher.update(container), cipher.final(), cipher.getAuthTag()])

if (!existsSync(VAULT)) mkdirSync(VAULT, { recursive: true })

// Named by hash rather than by slug: the filename should not restate what the
// blob is, since public/vault/ is as browsable as the rest of the repo.
const id = createHash('sha256').update(`vault:${slug}`).digest('hex').slice(0, 16)
writeFileSync(join(VAULT, `${id}.bin`), sealed)

/* ------------------------------------------------- post file, body removed --- */

// Everything that describes the subject is dropped from the public file: the
// title and description are replaced with neutral ones, and tags, target and
// platform go entirely — the target field alone gave the subject away.
const DESCRIBES_SUBJECT = /^(title|description|tags|target|platform|sealed):/

const kept = frontmatter
	.split('\n')
	.filter((line) => !DESCRIBES_SUBJECT.test(line))
	.join('\n')

writeFileSync(
	join('src/content/post', `${slug}.md`),
	[
		'---',
		'title: "Locked"',
		'description: "A locked post. Look around maybe you can find the key."',
		'tags: []',
		kept,
		`sealed: "${id}"`,
		'---',
		'',
		'This post is locked. Its title, text and screenshots are encrypted in a single',
		'blob and are not present in this repository in readable form.',
		''
	].join('\n')
)

/* ------------------------------------------------------------------ report --- */

const kb = (n) => `${Math.round(n / 1024)} KB`
console.log(`\n  sellado ${slug}`)
console.log(`    blob        public/vault/${id}.bin  (${kb(sealed.length)})`)
console.log(`    html        ${kb(htmlBytes.length)}`)
console.log(`    imagenes    ${assets.length}  (${kb(offset - htmlBytes.length)})`)
console.log(`    pbkdf2      ${ITERATIONS.toLocaleString('en-US')} iteraciones, sha256`)
console.log(`\n  ahora: borrar de public/assets/blog las ${assets.length} imagenes ya empaquetadas.`)
assets.forEach((a) => console.log(`    ${a.name}`))
