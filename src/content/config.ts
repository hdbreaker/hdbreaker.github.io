import { defineCollection, z } from 'astro:content'

function removeDupsAndLowerCase(array: string[]) {
	if (!array.length) return array
	const lowercaseItems = array.map((str) => str.toLowerCase())
	const distinctItems = new Set(lowercaseItems)
	return Array.from(distinctItems)
}

const post = defineCollection({
	type: 'content',
	schema: () =>
		z.object({
			title: z.string().max(90),
			description: z.string().min(50).max(160),
			publishDate: z
				.string()
				.or(z.date())
				.transform((val) => new Date(val)),
			updatedDate: z
				.string()
				.optional()
				.transform((str) => (str ? new Date(str) : undefined)),
			// A plain path rather than image(): the post images live in public/, which
			// the bundler cannot import. Consistent with how the bodies reference them.
			coverImage: z
				.object({
					src: z.string(),
					alt: z.string()
				})
				.optional(),
			draft: z.boolean().default(false),
			// Controlled vocabulary: technique and vulnerability class only. Product
			// names and CVE IDs belong in `target` / `cve`, not here — using them as
			// tags produced ~95 tags for 33 posts, most of them one-offs.
			tags: z.array(z.string()).default([]).transform(removeDupsAndLowerCase),
			/** CVE identifiers. Rendered as badges; these do not generate tag pages. */
			cve: z.array(z.string()).default([]),
			/** What was attacked. Replaces product-name tags. */
			target: z
				.object({
					vendor: z.string(),
					product: z.string().optional()
				})
				.optional(),
			platform: z.enum(['web', 'mobile', 'embedded', 'desktop', 'browser', 'game', 'ai']).optional(),
			ogImage: z.string().optional(),
			// --- Multi-part series + i18n support ---
			// When false, the post still gets its own /blog/<slug> route but is
			// hidden from the blog listing, RSS and tag pages. Used so only the
			// series entry point surfaces, while inner chapters live behind it.
			listed: z.boolean().default(true),
			// Stronger than `listed: false`. A hidden post keeps its route but is
			// kept out of the listing, RSS, tag pages, the sitemap, the search index
			// and search engines. `listed: false` alone leaves a post discoverable
			// through all four of those, which is right for series chapters and
			// translations but not for something meant to be found by hand.
			hidden: z.boolean().default(false),
			// Id of the encrypted blob under public/vault/ holding this post's real
			// body and images. Set by scripts/seal-post.mjs. A sealed post keeps its
			// frontmatter and route — only the content is behind the key, which is
			// what lets the path stay as public as the rest of a public repo.
			sealed: z.string().optional(),
			// Language of this post. The EN/ES tab pairs posts via `altSlug`.
			lang: z.enum(['en', 'es']).default('en'),
			altSlug: z.string().optional(),
			// Series grouping. `series` is a shared id, `seriesOrder` the chapter
			// number, `seriesLabel` the short label shown in the chapter nav.
			series: z.string().optional(),
			seriesOrder: z.number().optional(),
			seriesLabel: z.string().optional()
		})
})

export const collections = { post }
