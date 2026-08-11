export type SiteConfig = {
	author: string
	title: string
	/** Short brand appended to every page <title>, to stay inside SERP limits. */
	shortTitle: string
	description: string
	lang: string
	ogLocale: string
	date: {
		locale: string | string[] | undefined
		options: Intl.DateTimeFormatOptions
	}
}

export type PaginationLink = {
	url: string
	text?: string
	srLabel?: string
}

export type SiteMeta = {
	title: string
	description?: string
	ogImage?: string | undefined
	articleDate?: string | undefined
	/** ISO dates, used for JSON-LD structured data on posts. */
	publishDate?: string | undefined
	updatedDate?: string | undefined
	/** Tags of the post, emitted as JSON-LD keywords. */
	keywords?: string[] | undefined
	/** Content language of this page. Defaults to the site language. */
	lang?: 'en' | 'es'
	/** Slug of the translated version, used to emit reciprocal hreflang links. */
	altSlug?: string | undefined
}
