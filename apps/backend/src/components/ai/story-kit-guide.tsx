import {
	MAX_STORY_STATE_KEYS,
	MAX_STORY_STATE_VALUE_BYTES,
	STORY_APP_ALLOWED_IMPORTS,
	STORY_APP_MANIFEST_PATH,
	STORY_HTML_API_GLOBAL,
} from '@nao/shared/story-app';
import type { ReactElement } from 'react';

import { Bold, List, ListItem, renderToMarkdown } from '../../lib/markdown';

export function renderStoryKitGuide(): string {
	return renderToMarkdown(<List>{storyKitGuideItems()}</List>);
}

/** How to write a custom story with @nao/story-kit, shared by the agent prompt and the MCP authoring tools. */
export function storyKitGuideItems(): ReactElement[] {
	return [
		<ListItem key='imports'>
			Imports are limited to {STORY_APP_ALLOWED_IMPORTS.join(', ')} and relative paths.
		</ListItem>,
		<ListItem key='layout'>
			Keep <Bold>app.tsx</Bold> small: it composes the story from imported pieces. Put each new component in its
			own file, and group related files in folders (e.g. <Bold>components/</Bold>, <Bold>slides/</Bold>,{' '}
			<Bold>sections/</Bold>) via relative imports, so the app stays readable and maintainable as it grows.
		</ListItem>,
		<ListItem key='blocks'>
			Build with <Bold>@nao/story-kit</Bold> blocks — <Bold>KpiCard</Bold>, <Bold>BarChart</Bold>,{' '}
			<Bold>LineChart</Bold>, <Bold>{'<Chart type="...">'}</Bold> for every other display_chart type (mixed, pie,
			donut, scatter, radar) and the project's custom chart types, <Bold>DataTable</Bold>, <Bold>PointMap</Bold> —
			which match display_chart and display_map and handle loading and errors themselves. Blocks draw their own
			card, so place them directly in the layout rather than inside a panel of your own. Every block takes{' '}
			<Bold>queryId</Bold> (or <Bold>data</Bold>) and <Bold>title</Bold>; KpiCard and charts also take{' '}
			<Bold>format</Bold> ("number" | "compact" | "percent" with fractions | "currency"), <Bold>currency</Bold>,{' '}
			<Bold>decimals</Bold>. Charts: <Bold>xKey</Bold>, <Bold>series</Bold> (names or{' '}
			{'{ key, label?, type?, axis? }'}), <Bold>height</Bold>, <Bold>stacked</Bold>, <Bold>percent</Bold>,{' '}
			<Bold>horizontal</Bold> (bar), <Bold>area</Bold> (line), <Bold>showDataLabels</Bold>,{' '}
			<Bold>showLegend</Bold> (defaults to shown for pies and multi-series charts). KpiCard: <Bold>valueKey</Bold>
			, <Bold>comparison</Bold> against the previous row. DataTable: <Bold>columns</Bold>, <Bold>maxRows</Bold>{' '}
			(caps the rows shown; tables already paginate, starting at 10 rows per page and showing more when their grid
			row leaves room, with a rows-per-page picker), <Bold>conditionalFormats</Bold> (column → the same rule
			display_chart's conditional_formats takes) to colour cells.
		</ListItem>,
		<ListItem key='title'>
			Title a story with your own <Bold>{'<h1>'}</Bold> and, if useful, a short lead <Bold>{'<p>'}</Bold>: they
			already take the brand's title and body voice.
		</ListItem>,
		<ListItem key='brand'>
			When the story should carry the brand identity, such as an app or a dashboard, put{' '}
			<Bold>{'<BrandHeader />'}</Bold> at the top, above your title: it shows the logo or wordmark in the theme's
			header style (bare, above a rule, or in a coloured band) and renders nothing when the theme has no brand.
			Its children sit on the logo row: a period, a status or filter chips. Never put it in a deck.
		</ListItem>,
		<ListItem key='controls'>
			Style filters and toggles as <Bold>{'className="nao-chip"'}</Bold> with <Bold>aria-pressed</Bold> on the
			active one (group them in <Bold>nao-chips</Bold>) and actions as <Bold>nao-button</Bold> (or{' '}
			<Bold>nao-button nao-button--outline</Bold>): they take the brand's button shape and colours. Give small
			labels <Bold>nao-label</Bold> to follow the brand's casing.
		</ListItem>,
		<ListItem key='slides'>
			For slides, a deck or a presentation, wrap the content in <Bold>{'<Slides>'}</Bold> with one{' '}
			<Bold>{'<Slide>'}</Bold> per slide (16:9): it provides the navigation and prints one slide per PDF page.
			Both take <Bold>eyebrow</Bold> and <Bold>title</Bold> props; a Slide is already padded, and the deck shows
			the brand logo in its top bar.
		</ListItem>,
		<ListItem key='canvas'>
			Only when the user asks for a fixed size or fixed proportions (given dimensions, a poster, a wall display),
			wrap the story in <Bold>{'<Canvas width={1440} height={900}>'}</Bold> (the default size) and lay it out for
			that size only: it is scaled as a whole to fit the window. Inside a Canvas or a Slide, width and height
			media queries and vw/vh in the story's CSS files measure the frame, not the window; inline styles do not, so
			size them in px or %.
		</ListItem>,
		<ListItem key='responsive'>
			Any other story opens in a side panel from about 600px wide up to full screen: never give it a fixed page
			width. An app that must not scroll as a page (a kanban, a list with a detail panel) fills the window with{' '}
			<Bold>height: 100vh</Bold> and scrolls inside its own panels.
		</ListItem>,
		<ListItem key='tabs'>
			For tabs, put the tab buttons in a <Bold>{'<nav role="tablist">'}</Bold> and give each{' '}
			<Bold>role="tab"</Bold> with <Bold>aria-selected</Bold> on the active one: they take the brand's tab look
			with no CSS of your own, and PDF downloads open each tab in turn and print them one after the other.
		</ListItem>,
		<ListItem key='block-editing'>
			Users edit KpiCard, chart and DataTable blocks through a pencil that rewrites their props in your source:
			pass literal props and give each block a distinct title.
		</ListItem>,
		<ListItem key='selectable'>
			<Bold>Make every element of your own markup selectable</Bold>, small or large (a card, a pile, a button, a
			cell, a label, a section): spread <Bold>{'{...selectable({ name: "Discard pile" })}'}</Bold> from
			@nao/story-kit on it. Users click it in selection mode to ask about or edit that element alone, and its name
			is how they and you refer to it: keep each name short and distinct, and in lists pass a <Bold>detail</Bold>{' '}
			telling the items apart ({'{...selectable({ name: "Card", detail: "7 of hearts" })}'}). Kit blocks are
			already selectable. Give it to every element of a story you write; when you edit a story, give it only to
			the elements the request changes and leave the others untouched. In an HTML story, write{' '}
			<Bold>{'data-nao-part="element" data-nao-part-label="<name>" data-nao-part-value="<detail>"'}</Bold> on the
			element instead, replacing the placeholders with its own name and optional detail.
		</ListItem>,
		<ListItem key='narrative'>
			Wrap prose that states numbers or trends in <Bold>{'<Narrative id="...">text</Narrative>'}</Bold> inside
			your own element (e.g. {'<p>'}): when the story is live, each refresh rewrites that text from the new data.
			Use a distinct literal id and plain literal text; text built from query rows in code is already live and
			needs no Narrative.
		</ListItem>,
		<ListItem key='state'>
			<Bold>Save what a viewer would otherwise redo on every visit</Bold> with a hook used like useState: chosen
			filters, metric or date range, what-if inputs, the slide or tab they were on. Pick its scope by asking
			whether other viewers should see the change.
		</ListItem>,
		<ListItem key='state-scope'>
			<Bold>Personal, by default:</Bold> <Bold>{'useStoryState("key", initial)'}</Bold>. Each viewer, owner
			included, keeps their own value: one person's exploration of the data, such as filters, drill-downs or
			scenario inputs. <Bold>Shared:</Bold> <Bold>{'useSharedStoryState("key", initial)'}</Bold>. One value every
			viewer reads and writes, for what the team builds together: agreed targets or thresholds, annotations on a
			chart, a review status, a vote, an action-item checklist. The last change wins and others see it on their
			next visit.
		</ListItem>,
		<ListItem key='state-rules'>
			Saved state works like localStorage: every change is saved as it happens, so when viewers should explore
			before keeping something, hold the draft in useState and save it on their own action. Keep transient UI
			(hover, an open menu) and growing logs such as undo history in useState and never save query rows or
			secrets. Use stable literal keys and small JSON values (up to {MAX_STORY_STATE_VALUE_BYTES / 1024} KB;{' '}
			{MAX_STORY_STATE_KEYS} personal keys per viewer and {MAX_STORY_STATE_KEYS} shared keys); a saved value may
			predate your latest version, so check its shape and fall back to the initial value. In an HTML story, use{' '}
			<Bold>{`${STORY_HTML_API_GLOBAL}.state.get(key)`}</Bold> and{' '}
			<Bold>{`${STORY_HTML_API_GLOBAL}.state.set(key, value)`}</Bold> for personal state, and the same methods on{' '}
			<Bold>{`${STORY_HTML_API_GLOBAL}.sharedState`}</Bold> for shared state.
		</ListItem>,
		<ListItem key='bespoke-visuals'>
			For bespoke visuals the kit has no block for, wrap Recharts or your own markup in{' '}
			<Bold>{'<Block kind="..." queryId="...">'}</Bold> (the queryId it reads, so users can view its SQL) with{' '}
			<Bold>{'<div className="nao-chart">'}</Bold>, <Bold>seriesColor(i)</Bold> and a plain Recharts{' '}
			<Bold>{'<Tooltip />'}</Bold> (already themed; format values with{' '}
			<Bold>{'formatter={(value) => formatNumber(value, { format })}'}</Bold>). <Bold>useQueryData(queryId)</Bold>{' '}
			returns <Bold>data: null</Bold> until <Bold>status</Bold> is "success", then the array of rows — guard
			before reading it.
		</ListItem>,
		<ListItem key='filters'>
			<Bold>Filters: pick where they apply.</Bold> Filter rows already loaded in the browser (useMemo over{' '}
			<Bold>data</Bold>) when the query returns every row the filter can narrow down and the result stays small.
			Re-run the query on the server when filtering must happen before aggregation or a LIMIT, or the unfiltered
			result is too large: write{' '}
			<Bold>{'{% filter <id> %} AND col = {{ filters.<id>.sql }} {% endfilter %}'}</Bold> blocks in the
			execute_sql query (the chat runs it with the blocks left out) and pass the chosen values with{' '}
			<Bold>{'useQueryData(queryId, { filters: { <id>: value } })'}</Bold>, or the same <Bold>filters</Bold> prop
			on any block (give a block its <Bold>queryId</Bold> and <Bold>filters</Bold> rather than rows loaded
			elsewhere, so it shows its own loading and errors). The value's shape picks how it renders: a string is a
			quoted exact value (=), a number a numeric literal, a string array a quoted list (IN (…)),{' '}
			<Bold>{'{ from, to }'}</Bold> a date range (BETWEEN) and <Bold>{'{ contains }'}</Bold> a '%value%' pattern
			(LIKE/ILIKE); null, '' or [] leaves the block out. Values are quoted for you: never build them into SQL
			yourself. On a semantic-layer query, a filter whose id is a dimension (e.g. customer__region, metric_time
			for a date range) filters by that dimension. Both kinds can live in one story; while new rows load, blocks
			keep showing the previous ones.
		</ListItem>,
		<ListItem key='params'>
			<Bold>Parameters</Bold> switch a semantic-layer query's metric or grain: run execute_semantic_query with{' '}
			<Bold>{'{{ params.<id> }}'}</Bold> placeholders and defaults in <Bold>params</Bold>, then pass{' '}
			<Bold>{'useQueryData(queryId, { params: { <id>: "value" } })'}</Bold> (or the <Bold>params</Bold> prop of a
			block). Values are plain tokens (letters, digits, _ . : -). Result columns are named after the selected
			values, so read keys from the same state.
		</ListItem>,
		<ListItem key='sql'>
			<Bold>{'useSql(sql, { databaseId, filters })'}</Bold> (or the <Bold>sql</Bold>, <Bold>databaseId</Bold> and{' '}
			<Bold>filters</Bold> props of a block) runs SQL the story writes itself, for drill-downs or lookups no saved
			query covers. Write the viewer's choices as the same <Bold>{'{% filter <id> %}'}</Bold> blocks and pass them
			in <Bold>filters</Bold> so they are quoted on the server. It returns the same state as useQueryData and runs
			as the person viewing the story, with their own nao permissions: read-only SELECT on the warehouse only
			(databaseId as in execute_sql), and it fails for viewers who cannot read those tables. Prefer saved queries
			with filters for what every viewer needs to see, and never put secrets in it.
		</ListItem>,
		<ListItem key='maps'>
			Maps: <Bold>{'<PointMap queryId="..." />'}</Bold> plots rows with latitude and longitude columns
			(auto-detected; optional <Bold>latitudeKey</Bold>, <Bold>longitudeKey</Bold>, <Bold>sizeKey</Bold> for
			bubbles, <Bold>labelKey</Bold>, <Bold>tooltipKeys</Bold>, <Bold>height</Bold>). For any other map, use{' '}
			<Bold>react-leaflet</Bold> inside <Bold>{'<div className="nao-map">'}</Bold> (sized by your CSS; a
			full-screen map sits in your layout, not in a Block) with <Bold>{'<MapTiles />'}</Bold> as the first child
			of MapContainer: the only tiles the story can reach, themed, kept to a single world and following the
			container's size. Leaflet's CSS is already loaded; import nothing else for it.
		</ListItem>,
		<ListItem key='theme'>
			<Bold>Never hardcode data, colours or fonts.</Bold> Read rows with <Bold>useQueryData</Bold>; style with{' '}
			<Bold>var(--background)</Bold>, <Bold>var(--card)</Bold>, <Bold>var(--foreground)</Bold>,{' '}
			<Bold>var(--muted-foreground)</Bold>, <Bold>var(--primary)</Bold>, <Bold>var(--border)</Bold>,{' '}
			<Bold>var(--radius)</Bold>, <Bold>var(--font-sans)</Bold>, <Bold>var(--font-heading)</Bold>,{' '}
			<Bold>var(--chart-1…11)</Bold>, <Bold>var(--story-control-radius)</Bold>. Use var(--primary) for fills (with
			var(--primary-foreground) on them) and <Bold>var(--story-accent-text)</Bold> when the accent is the text
			colour itself: a bright brand accent can be unreadable as text. Headings, paragraphs, kit blocks, nao-chip,
			nao-button and nao-label already speak in the brand's type voice; for your own text elements, take a role's{' '}
			<Bold>var(--story-type-ROLE-font)</Bold>, <Bold>-weight</Bold>, <Bold>-case</Bold>, <Bold>-style</Bold> and{' '}
			<Bold>-tracking</Bold> (ROLE: display, heading, subheading, body, label, button, figure) instead of setting
			fonts or casing yourself. They follow theme changes live, so a re-theme needs no republish.
		</ListItem>,
		<ListItem key='html-entry'>
			<Bold>HTML stories are the exception:</Bold> use one only when the user hands you an HTML page to host as-is
			or explicitly asks for plain HTML; otherwise, and whenever they may want to edit blocks later, build React.
			Set <Bold>{'{ "entry": "index.html" }'}</Bold> in <Bold>{STORY_APP_MANIFEST_PATH}</Bold> and write a full
			document.
		</ListItem>,
		<ListItem key='html-scripts'>
			In an HTML story, theme variables, kit styles and the story's .css files are injected for you. Scripts must
			be story files (inline or <Bold>src="./file.js"</Bold>, never a CDN) and run as ES modules after the page is
			parsed: share code with imports (story files or the allowed packages), not globals; never wait for
			DOMContentLoaded; attach listeners with addEventListener, never <Bold>onclick=""</Bold>. Read data with{' '}
			<Bold>{`await ${STORY_HTML_API_GLOBAL}.query("query_id")`}</Bold> → {'{ columns, data }'} (pass{' '}
			<Bold>{'{ filters, params }'}</Bold> as a second argument to re-run it, and{' '}
			<Bold>{`${STORY_HTML_API_GLOBAL}.sql(sql, { databaseId })`}</Bold> for SQL of your own) and redraw on theme
			change with <Bold>{`${STORY_HTML_API_GLOBAL}.onTheme(fn)`}</Bold>.
		</ListItem>,
	];
}
