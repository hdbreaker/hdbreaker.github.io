export type SiteConfig = {
	author: string
	title: string
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
	/** Content language of this page. Defaults to the site language. */
	lang?: 'en' | 'es'
	/** Slug of the translated version, used to emit reciprocal hreflang links. */
	altSlug?: string | undefined
}
