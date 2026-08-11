import type { SiteConfig } from '@/types'
import type { AstroExpressiveCodeOptions } from 'astro-expressive-code'

export const siteConfig: SiteConfig = {
	// Used as both a meta property (src/components/BaseHead.astro L:31 + L:49) & the generated satori png (src/pages/og-image/[slug].png.ts)
	author: 'Alejandro Parodi',
	// Full site title. Used for og:site_name and as the fallback page title.
	title: 'Alejandro Parodi - Offensive Security Engineer & Founder',
	/**
	 * Short brand appended to every <title>. The full title above is 56 characters,
	 * which on its own exceeds what search results display, so page titles were
	 * being truncated to nothing but the suffix.
	 */
	shortTitle: 'Alejandro Parodi',
	// Meta property used as the default description meta property
	description: 'Offensive Security Engineer, Red Teamer, and Founder with 10+ years experience in cybersecurity. Currently building Volt AI. CVE researcher and Nimhawk C2 framework developer.',
	// HTML lang property, found in src/layouts/Base.astro L:18
	lang: 'en-GB',
	// Meta property, found in src/components/BaseHead.astro L:42
	ogLocale: 'en_GB',
	// Date.prototype.toLocaleDateString() parameters, found in src/utils/date.ts.
	date: {
		locale: 'en-GB',
		options: {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}
	}
}

/**
 * Primary navigation. There is no footer, so every browsable section has to be
 * reachable from here.
 */
export const menuLinks: Array<{ title: string; path: string }> = [
	{
		title: 'Blog',
		path: '/blog/'
	},
	{
		title: 'Tools',
		path: '/tools/'
	},
	{
		title: 'Topics',
		path: '/tags/'
	}
]

/**
 * Hand-picked "best of" list for the home page, in the order it should appear.
 * This is an editorial ranking, not a feed — nothing here is derived from dates
 * or tags. Add, remove and reorder slugs by hand; titles and descriptions are
 * read from each post so the copy never drifts out of sync.
 */
export const featuredResearch: string[] = [
	'samsung-tv-v8-rce',
	'cve-2018-16119-tp-link-router-rce',
	'escalating-tplink-firmware-vulnerabilities',
	'mercury-browser-intent-hijacking-android',
	'vlc-vob-stack-overflow-vulnerability',
	'audacious-stack-overflow-vulnerability',
	'qqplayer-heap-overflow-vulnerability',
	'limesurvey-rce-tcpdf-serialization',
	'wix-premium-zone-bypass-vulnerability',
	'shellshock-qmail-exploitation',
	'license-plate-hacking-argentina'
]

/**
 * The controlled tag vocabulary, grouped by axis. This is the same closed set the
 * posts were migrated onto: a tag names a technique or a vulnerability class, never
 * a product or a CVE — those live in each post's `target` and `cve` fields.
 *
 * Anything tagged outside this list still renders on /tags/, under "Other", so a
 * stray tag surfaces instead of disappearing.
 */
export const tagGroups: Array<{ title: string; blurb: string; tags: string[] }> = [
	{
		title: 'Vulnerability class',
		blurb: 'What the bug actually is.',
		tags: [
			'rce',
			'memory-corruption',
			'type-confusion',
			'ssrf',
			'path-traversal',
			'csrf',
			'idor',
			'auth-bypass'
		]
	},
	{
		title: 'Technique',
		blurb: 'How it was found or driven to impact.',
		tags: ['rop', 'fuzzing', 'reverse-engineering', 'exploit-development', 'osint']
	},
	{
		title: 'Domain',
		blurb: 'Where it lives.',
		tags: [
			'browser-exploitation',
			'firmware',
			'iot',
			'mobile',
			'web-security',
			'red-team',
			'vulnerability-research'
		]
	}
]

/** External profiles. Used for the JSON-LD `sameAs` of the Person node. */
export const socialLinks: Array<{ title: string; url: string }> = [
	{ title: 'GitHub', url: 'https://github.com/hdbreaker' },
	{ title: 'X', url: 'https://x.com/hdbreaker_' },
	{ title: 'LinkedIn', url: 'https://www.linkedin.com/in/alejandroparodi/' },
	{ title: 'RSS', url: '/rss.xml' }
]

// https://expressive-code.com/reference/configuration/
export const expressiveCodeOptions: AstroExpressiveCodeOptions = {
	// One dark, one light theme => https://expressive-code.com/guides/themes/#available-themes
	themes: ['dracula', 'github-light'],
	themeCssSelector(theme, { styleVariants }) {
		// If one dark and one light theme are available
		// generate theme CSS selectors compatible with cactus-theme dark mode switch
		if (styleVariants.length >= 2) {
			const baseTheme = styleVariants[0]?.theme
			const altTheme = styleVariants.find((v) => v.theme.type !== baseTheme?.type)?.theme
			if (theme === baseTheme || theme === altTheme) return `[data-theme='${theme.type}']`
		}
		// return default selector
		return `[data-theme="${theme.name}"]`
	},
	useThemedScrollbars: false,
	styleOverrides: {
		frames: {
			frameBoxShadowCssValue: 'none'
		},
		uiLineHeight: 'inherit',
		codeFontSize: '0.875rem',
		codeLineHeight: '1.7142857rem',
		borderRadius: '4px',
		codePaddingInline: '1rem',
		codeFontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;'
	}
}
