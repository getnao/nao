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
			donut, scatter, radar), <Bold>DataTable</Bold>, <Bold>PointMap</Bold> — which match display_chart and
			display_map and handle loading and errors themselves. Blocks draw their own card, so place them directly in
			the layout rather than inside a panel of your own. Every block takes <Bold>queryId</Bold> (or{' '}
			<Bold>data</Bold>) and <Bold>title</Bold>; KpiCard and charts also take <Bold>format</Bold> ("number" |
			"compact" | "percent" with fractions | "currency"), <Bold>currency</Bold>, <Bold>decimals</Bold>. Charts:{' '}
			<Bold>xKey</Bold>, <Bold>series</Bold> (names or {'{ key, label?, type?, axis? }'}), <Bold>height</Bold>,{' '}
			<Bold>stacked</Bold>, <Bold>percent</Bold>, <Bold>horizontal</Bold> (bar), <Bold>area</Bold> (line),{' '}
			<Bold>showDataLabels</Bold>. KpiCard: <Bold>valueKey</Bold>, <Bold>comparison</Bold> against the previous
			row. DataTable: <Bold>columns</Bold>, <Bold>maxRows</Bold>, <Bold>conditionalFormats</Bold> (column → the
			same rule display_chart's conditional_formats takes) to colour cells.
		</ListItem>,
		<ListItem key='slides'>
			For slides, a deck or a presentation, wrap the content in <Bold>{'<Slides>'}</Bold> with one{' '}
			<Bold>{'<Slide>'}</Bold> per slide (16:9): it provides the navigation and prints one slide per PDF page.
			Both take <Bold>eyebrow</Bold> and <Bold>title</Bold> props; a Slide is already padded.
		</ListItem>,
		<ListItem key='tabs'>
			For tabs, put the tab buttons in a <Bold>{'<nav>'}</Bold> (or give them <Bold>role="tab"</Bold>): PDF
			downloads open each tab in turn and print them one after the other.
		</ListItem>,
		<ListItem key='block-editing'>
			Users edit KpiCard, chart and DataTable blocks through a pencil that rewrites their props in your source:
			pass literal props and give each block a distinct title.
		</ListItem>,
		<ListItem key='narrative'>
			Wrap prose that states numbers or trends in <Bold>{'<Narrative id="...">text</Narrative>'}</Bold> inside
			your own element (e.g. {'<p>'}): when the story is live, each refresh rewrites that text from the new data.
			Use a distinct literal id and plain literal text; text built from query rows in code is already live and
			needs no Narrative.
		</ListItem>,
		<ListItem key='state'>
			<Bold>Persist what a viewer would otherwise redo on every visit</Bold> with{' '}
			<Bold>{'const [value, setValue] = useStoryState("key", initial)'}</Bold>, used like useState: gauge or
			slider positions, the slide or tab they were on, chosen filters, a simulator's scenario, a game's history
			(cards drawn, score). It works like localStorage: every change is saved as it happens, so to let viewers
			explore before keeping something, hold the draft in useState and set it on their own action. The owner's
			values are what everyone starts from; every other viewer keeps their own on top of them. Keep transient UI
			(hover, an open menu) in useState, and never store query rows or secrets. Use stable literal keys and small
			JSON values (up to {MAX_STORY_STATE_VALUE_BYTES / 1024} KB, {MAX_STORY_STATE_KEYS} keys); a stored value may
			predate your latest version, so check its shape and fall back to the initial value. In an HTML story use{' '}
			<Bold>{`${STORY_HTML_API_GLOBAL}.state.get(key)`}</Bold> and{' '}
			<Bold>{`${STORY_HTML_API_GLOBAL}.state.set(key, value)`}</Bold>.
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
			<Bold>var(--chart-1…11)</Bold>. They follow theme changes live, so a re-theme needs no republish.
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
			<Bold>{`await ${STORY_HTML_API_GLOBAL}.query("query_id")`}</Bold> → {'{ columns, data }'} and redraw on
			theme change with <Bold>{`${STORY_HTML_API_GLOBAL}.onTheme(fn)`}</Bold>.
		</ListItem>,
	];
}
