/**
 * Buries a breadcrumb to /0x00 inside the generated sitemap.
 *
 * The sitemap is a strange place to read for fun, which is the point: whoever
 * finds this went looking through files nobody links to. It is an XML comment,
 * so crawlers ignore it and the document stays valid.
 *
 * This runs after `astro build` because @astrojs/sitemap writes the file itself —
 * its `serialize` hook shapes individual entries and cannot add free text.
 *
 * The other way in is an HTML comment emitted by BaseLayout.astro. Neither states
 * what is there; both need decoding.
 *
 * Usage:  node scripts/hide-breadcrumb.mjs      (wired into `npm run build`)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'

// Base64 of the path, on its own, with one line of framing. Enough that a person
// who found it knows it is meant for them; not enough to skip the decoding.
const BREADCRUMB = `<!--
  Nothing below this line is missing by accident.
  LzB4MDA=
-->`

const sitemaps = readdirSync(DIST).filter((file) => /^sitemap.*\.xml$/.test(file))

if (!sitemaps.length) {
	console.error('  hide-breadcrumb: no sitemap found in dist/ — did astro build run?')
	process.exit(1)
}

// The index file just points at the others; the breadcrumb goes in the one that
// actually lists pages, so it sits among the URLs rather than beside them.
const target = sitemaps.find((file) => file !== 'sitemap-index.xml') ?? sitemaps[0]
const path = join(DIST, target)
const xml = readFileSync(path, 'utf8')

if (xml.includes('LzB4MDA=')) {
	console.log(`  breadcrumb ya presente en ${target}`)
	process.exit(0)
}

// After the closing tag, so no parser has to care where it landed.
writeFileSync(path, `${xml.trimEnd()}\n${BREADCRUMB}\n`)
console.log(`  breadcrumb escondido en ${target}`)
