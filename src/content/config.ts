import { defineCollection, z } from 'astro:content'

function removeDupsAndLowerCase(array: string[]) {
	if (!array.length) return array
	const lowercaseItems = array.map((str) => str.toLowerCase())
	const distinctItems = new Set(lowercaseItems)
	return Array.from(distinctItems)
}

const post = defineCollection({
	type: 'content',
	schema: ({ image }) =>
		z.object({
			title: z.string().max(80),
			description: z.string().min(50).max(160),
			publishDate: z
				.string()
				.or(z.date())
				.transform((val) => new Date(val)),
			updatedDate: z
				.string()
				.optional()
				.transform((str) => (str ? new Date(str) : undefined)),
			coverImage: z
				.object({
					src: image(),
					alt: z.string()
				})
				.optional(),
			draft: z.boolean().default(false),
			tags: z.array(z.string()).default([]).transform(removeDupsAndLowerCase),
			ogImage: z.string().optional(),
			// --- Multi-part series + i18n support ---
			// When false, the post still gets its own /blog/<slug> route but is
			// hidden from the blog listing, RSS and tag pages. Used so only the
			// series entry point surfaces, while inner chapters live behind it.
			listed: z.boolean().default(true),
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
