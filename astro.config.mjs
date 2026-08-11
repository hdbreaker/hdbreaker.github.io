import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import tailwind from '@astrojs/tailwind'
import sitemap from '@astrojs/sitemap'
import { remarkReadingTime } from './src/utils/remarkReadingTime.ts'
import remarkUnwrapImages from 'remark-unwrap-images'
import rehypeExternalLinks from 'rehype-external-links'
import expressiveCode from 'astro-expressive-code'
import { expressiveCodeOptions } from './src/site.config'
import icon from 'astro-icon'
import mermaid from 'astro-mermaid'

// https://astro.build/config
export default defineConfig({
	site: 'https://hdbreaker.github.io',
	// The D-Link post was the only file left in UPPER_SNAKE_CASE, which produced a
	// slug outside the site's convention. Keep the published URL working.
	redirects: {
		'/blog/DLINK_DIR600_Research_Post': '/blog/dlink-dir600-rce-exploit-chain'
	},
	integrations: [
		// Must come BEFORE expressiveCode, which would otherwise claim the
		// ```mermaid fences and render them as plain code blocks.
		mermaid({
			// The site is dark-only, so pin the theme instead of watching for a
			// data-theme attribute that never changes.
			theme: 'dark',
			autoTheme: false,
			enableLog: false,
			mermaidConfig: {
				fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
				sequence: {
					actorFontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
					noteFontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
					messageFontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
				},
				themeVariables: {
					primaryColor: '#1A1A1A',
					primaryTextColor: '#F5F5F5',
					primaryBorderColor: '#57FD6B',
					lineColor: '#57FD6B',
					secondaryColor: '#181B2A',
					tertiaryColor: '#0F111A',
					background: '#0A0A0A',
					mainBkg: '#1A1A1A',
					textColor: '#F5F5F5',
					actorBkg: '#1A1A1A',
					actorBorder: '#57FD6B',
					actorTextColor: '#F5F5F5',
					signalColor: '#A0A0A0',
					signalTextColor: '#F5F5F5',
					labelBoxBkgColor: '#1A1A1A',
					labelBoxBorderColor: '#57FD6B',
					labelTextColor: '#F5F5F5',
					noteBkgColor: '#181B2A',
					noteBorderColor: '#57FD6B',
					noteTextColor: '#F5F5F5'
				}
			}
		}),
		expressiveCode(expressiveCodeOptions),
		tailwind({
			applyBaseStyles: false
		}),
		sitemap(),
		mdx(),
		icon()
	],
	markdown: {
		remarkPlugins: [remarkUnwrapImages, remarkReadingTime],
		rehypePlugins: [
			[
				rehypeExternalLinks,
				{
					target: '_blank',
					rel: ['nofollow, noopener, noreferrer']
				}
			]
		],
		remarkRehype: {
			footnoteLabelProperties: {
				className: ['']
			}
		}
	},
	prefetch: true,
	output: 'static',
	vite: {
		assetsInclude: ['**/*.svg']
	}
})
