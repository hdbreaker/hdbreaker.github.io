/**
 * Derives the constants the /0x00 challenge page needs, without ever storing the
 * answer.
 *
 * The flag and the hidden slug must not be greppable. This repository is public,
 * so keeping them out of the built bundle is not enough — they must not be in the
 * source either. Nothing here is committed except the output: one hash and two
 * ciphertexts, none of which can be reversed without solving the chain.
 *
 * Two properties matter, and the obvious construction gets the second one wrong:
 *
 *  1. Verification is a hash comparison, so no plaintext flag exists to be read.
 *
 *  2. The slug is encrypted under a keystream DERIVED from the flag by hashing,
 *     not under the flag itself. Encrypting directly against a repeating key
 *     leaks plaintext to anyone who knows part of it — and the flag's `hdbreaker{`
 *     prefix is public, since it is printed in the page's input placeholder. That
 *     alone decrypted the first ten characters of the slug, which is more than
 *     enough to guess the rest. Hashing avalanches: one wrong character in the
 *     flag changes every byte of the keystream.
 *
 * The keystream is domain-separated from the verification hash (`slug:<n>:` vs
 * the bare flag), so publishing FLAG_HASH gives nothing away about the keystream.
 *
 * Usage:
 *   node scripts/generate-challenge.mjs '<flag>' '<xor-key>' '<hidden-slug>'
 *
 * Paste the printed constants into src/pages/0x00.astro. Do not commit the
 * arguments, and clear them from your shell history.
 */
import { createHash } from 'node:crypto'

const [flag, xorKey, slug] = process.argv.slice(2)

if (!flag || !xorKey || !slug) {
	console.error("usage: node scripts/generate-challenge.mjs '<flag>' '<xor-key>' '<slug>'")
	process.exit(1)
}

const sha256 = (input) => createHash('sha256').update(input, 'utf8').digest()

/** SHA-256 in counter mode, stretched to `length` bytes. Mirrored in 0x00.astro. */
function keystream(secret, length) {
	const blocks = []
	for (let i = 0; blocks.length * 32 < length; i += 1) blocks.push(sha256(`slug:${i}:${secret}`))
	return Buffer.concat(blocks).subarray(0, length)
}

const xorKeystream = (plain, secret) => {
	const bytes = Buffer.from(plain, 'utf8')
	const ks = keystream(secret, bytes.length)
	return [...bytes].map((byte, i) => (byte ^ ks[i]).toString(16).padStart(2, '0')).join('')
}

/**
 * Layer 2 keeps the simple repeating-key XOR on purpose: it is the recognisable
 * classroom construction, the plaintext is the flag rather than anything that
 * needs protecting, and the key is a word the solver has to go and find.
 */
const xorHex = (plain, key) =>
	[...Buffer.from(plain, 'utf8')]
		.map((byte, i) => (byte ^ key.charCodeAt(i % key.length)).toString(16).padStart(2, '0'))
		.join('')

const layer2 = xorHex(flag, xorKey)

// Layer 1: what the page displays. A char-code array — the most recognisable
// encoding in JavaScript, so it is obvious what to do and only then gets harder.
const layer1Plain = `Layer 2 is repeating-key XOR, hex below. The key is one function name, lowercase: the one that chkAbsPath and _fini both reach. It is drawn on a post cover somewhere in this blog.\n\n${layer2}`

console.log('\n--- paste into src/pages/0x00.astro ---\n')
console.log(`const FLAG_HASH = '${sha256(flag).toString('hex')}'`)
console.log(`const SLUG_CIPHER = '${xorKeystream(slug, flag)}'`)
console.log(`const LAYER1 =\n\t'${[...Buffer.from(layer1Plain, 'utf8')].join(',')}'`)

// --- self-check -------------------------------------------------------------
// Confirms the prefix leak is actually gone: encrypting under a flag that shares
// the real one's public prefix must not reproduce any of the slug.
const withKnownPrefix = xorKeystream(slug, `${flag.slice(0, 10)}xxxxxxxxxxxxxxxxxxxxxxxxx`)
const cipher = xorKeystream(slug, flag)
let shared = 0
while (shared < cipher.length && cipher[shared] === withKnownPrefix[shared]) shared += 1
console.log(`\n--- self-check ---`)
console.log(`bytes leaked to a known 10-char prefix: ${Math.floor(shared / 2)} (must be 0)`)
