import { useMemo } from 'react';
import type { QueryDataMap } from '@/components/story-embeds';
import type { StoryTheme } from '@nao/shared/story-theme';

import { StoryChartEmbed } from '@/components/side-panel/story-chart-embed';
import { StoryTableEmbed } from '@/components/side-panel/story-table-embed';
import { StoryTabbedContent } from '@/components/story-tabbed-content';
import { StoryThemeProvider } from '@/components/story-theme-provider';
import { StoryEmbedDataProvider } from '@/contexts/story-embed-data';

/**
 * A real story, rendered by the real story renderer, in a candidate theme.
 *
 * Earlier versions mounted nao's components but assembled them by hand in this
 * file's own JSX. That is a facsimile: it drifts the moment a story component
 * changes, and it quietly showed things a story would never show. This instead
 * feeds actual story code through StoryTabbedContent - the same parser, the same
 * segment renderer, the same chart and table embeds a published story uses -
 * with a fixed result set standing in for the warehouse.
 *
 * The consequence worth keeping: nothing here describes what a story looks like.
 * It IS one.
 */

const WEEKS = ['May 25', 'Jun 8', 'Jun 22', 'Jul 6', 'Jul 20', 'Aug 3', 'Aug 17'];
const COUNTRIES = ['United States', 'France', 'Spain', 'United Kingdom', 'India', 'Germany'];
const BY_COUNTRY = [
	[820, 910, 1180, 1010, 640, 1240, 890],
	[610, 700, 940, 780, 520, 980, 720],
	[380, 420, 560, 470, 310, 590, 430],
	[240, 280, 350, 300, 200, 380, 275],
	[160, 190, 240, 205, 140, 260, 185],
	[120, 140, 180, 155, 105, 195, 140],
];

/** Stands in for the warehouse, keyed by the query ids the story code references. */
const QUERY_DATA: QueryDataMap = {
	weekly_by_country: {
		columns: ['week', ...COUNTRIES],
		data: WEEKS.map((week, i) => ({
			week,
			...Object.fromEntries(COUNTRIES.map((c, ci) => [c, BY_COUNTRY[ci][i]])),
		})),
	},
	weekly_trend: {
		columns: ['week', 'Deployed', 'Local'],
		data: WEEKS.map((week, i) => ({
			week,
			Deployed: [1155, 1346, 1354, 1114, 1185, 1099, 1275][i],
			Local: [1889, 2169, 1805, 1953, 1320, 773, 836][i],
		})),
	},
	country_totals: {
		columns: ['Country', 'Users', 'Messages', 'Share'],
		data: COUNTRIES.map((country, ci) => {
			const users = BY_COUNTRY[ci].reduce((a, b) => a + b, 0);
			const total = BY_COUNTRY.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0);
			return {
				Country: country,
				Users: users,
				Messages: Math.round(users * 2.4),
				Share: `${((users / total) * 100).toFixed(1)}%`,
			};
		}),
	},
};

const PREVIEW_ID = 'story-theme-preview';

const series = (keys: string[]) => JSON.stringify(keys.map((k) => ({ data_key: k, label: k })));

/** Genuine story markup: the same tags the agent writes when it builds a story. */
const STORY_CODE = [
	'<tab title="Overview">',
	'',
	'# Weekly active users',
	'',
	'This is a real story rendered with your design system: the same filter bar, charts, table and',
	'prose your workspace already produces. Change a filter, switch tabs or hover a series.',
	'',
	`<filter id="country" label="Country" filter_type="select" options='${JSON.stringify(['All countries', ...COUNTRIES])}' />`,
	`<filter id="instance" label="Instance" filter_type="select" options='${JSON.stringify(['All', 'Deployed', 'Local'])}' />`,
	'',
	'<grid cols="3">',
	'',
	'Latest week',
	'',
	'## 4,130',
	'',
	'Weekly average',
	'',
	'## 4,692',
	'',
	'Peak week',
	'',
	'## 6,680',
	'',
	'</grid>',
	'',
	`<chart query_id="weekly_by_country" chart_type="bar" x_axis_key="week" series='${series(COUNTRIES)}' title="Users per week by country" />`,
	'',
	'## Trend',
	'',
	'Deployed instances against local runs, week by week.',
	'',
	`<chart query_id="weekly_trend" chart_type="line" x_axis_key="week" series='${series(['Deployed', 'Local'])}' title="Deployed vs local" />`,
	'',
	'</tab>',
	'<tab title="By country">',
	'',
	'# Users by country',
	'',
	'The same design system applied to a table block.',
	'',
	'<table query_id="country_totals" title="Users by country" />',
	'',
	'</tab>',
].join('\n');

export function StoryThemePreview({ theme }: { theme: StoryTheme }) {
	const renderChart = useMemo(
		() =>
			function renderChartBlock(chart: Parameters<typeof StoryChartEmbed>[0]['chart']) {
				return <StoryChartEmbed chart={chart} />;
			},
		[],
	);
	const renderTable = useMemo(
		() =>
			function renderTableBlock(table: Parameters<typeof StoryTableEmbed>[0]['table']) {
				return <StoryTableEmbed table={table} />;
			},
		[],
	);

	return (
		<StoryThemeProvider override={theme}>
			<StoryEmbedDataProvider value={QUERY_DATA}>
				<div className='overflow-hidden rounded-lg border bg-background text-foreground'>
					<StoryTabbedContent
						code={STORY_CODE}
						// Without an api the renderer disables filters entirely, which is
						// why they vanished when this became a real story. Options are
						// hardcoded in the markup, so nothing is fetched.
						filterApi={{ kind: 'owned', chatId: PREVIEW_ID, storySlug: PREVIEW_ID }}
						renderChart={(chart) => renderChart(chart)}
						renderTable={(table) => renderTable(table)}
						renderMap={() => null}
						contentClassName='p-4 md:p-6 flex flex-col gap-4'
					/>
				</div>
			</StoryEmbedDataProvider>
		</StoryThemeProvider>
	);
}
