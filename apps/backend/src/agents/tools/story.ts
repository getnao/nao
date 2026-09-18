import {
	DEFAULT_STORY_STYLE,
	defaultStoryFormatForStyle,
	formatDbtChartsDiagnostic,
	type StoryFormat,
	type StoryStyle,
	storyStyleAllowsFormat,
} from '@nao/shared/dbt-charts';
import { injectTableFormatting } from '@nao/shared/story-segments';
import { story } from '@nao/shared/tools';

import { renderToModelOutput, StoryOutput } from '../../components/tool-outputs';
import { db } from '../../db/db';
import { env } from '../../env';
import { getDisplayChartTableFormatsForChat } from '../../queries/chart-image';
import * as storyQueries from '../../queries/story.queries';
import * as storyFolderQueries from '../../queries/story-folder.queries';
import * as dbtChartsService from '../../services/dbt-charts.service';
import { resolveStoryStyle } from '../../services/story-style';
import { getStoryTemplateWarnings } from '../../services/story-template-validation';
import type { ToolContext } from '../../types/tools';
import { createTool } from '../../utils/tools';

const STORY_FILTER_DESCRIPTION = [
	'Story-level filters are declared via <filter id="..." label="..." type="select|multi_select|search|date_range" ... />.',
	'For select/multi_select, provide either table+column (options from SELECT DISTINCT) or options=\'["a","b"]\' (hardcoded values).',
	'When using table+column and multiple databases are configured, set database_id on the filter so option loading targets the correct database.',
	'Matching SQL must use template blocks that reference the same filter id, e.g. WHERE 1 = 1 {% filter country %} AND country IN ({{ filters.country.sql }}) {% endfilter %}.',
	"For date_range, {{ filters.<id>.sql }} already expands to 'start' AND 'end' — write {% filter period %} AND order_date BETWEEN {{ filters.period.sql }} {% endfilter %}. Never use .start/.end/.value.",
	'Chat and live refresh strip unset filter blocks so the query still runs; active story filter selections re-render and re-execute SQL.',
	'Invalid filter templates are reported as template_warnings in the tool result — fix them before finishing.',
	'When adding filters to existing charts, prefer execute_sql with query_id set to the existing query so chart/table tags keep the same query_id.',
].join(' ');

const DBT_CHARTS_SYNTAX_DESCRIPTION = [
	'Its code is a dbt Charts YAML board (https://github.com/dbt-labs/dbt-charts) rendered server-side to SVG, with every query executed through the nao connection.',
	'Load the built-in skill "dbt-charts" before writing or editing a board: it documents the YAML syntax the compiler accepts.',
	'For format="dbt_charts", "update" and "replace" operate on the YAML text; compile diagnostics are returned in template_warnings — fix errors before finishing.',
].join(' ');

const STORY_STYLE_DESCRIPTIONS: Record<StoryStyle, string> = {
	markdown:
		'New stories are nao markdown documents (format="markdown"); dbt Charts boards are disabled in this project.',
	dbt_charts: `New stories are dbt Charts boards: format defaults to "dbt_charts" and markdown stories cannot be created. ${DBT_CHARTS_SYNTAX_DESCRIPTION}`,
	both: `A story can alternatively use format="dbt_charts" (only when the user asks for a dbt Charts board or dashboard, or when editing an existing one). ${DBT_CHARTS_SYNTAX_DESCRIPTION}`,
};

export function buildStoryToolDescription({
	mapsEnabled = false,
	storyStyle = DEFAULT_STORY_STYLE,
}: { mapsEnabled?: boolean; storyStyle?: StoryStyle } = {}) {
	return [
		'Create or modify a nao Story — an interactive document combining markdown text and chart visualizations.',
		'Use "create" to initialize a new story, "update" to search-and-replace within it (producing a new version),',
		'or "replace" to overwrite the entire content (producing a new version).',
		'Existing stories keep their format: "update" edits them as they are.',
		...(storyStyle !== 'dbt_charts' ? markdownSyntaxDescription(mapsEnabled) : []),
		'A story can also be refered as a "canva", an "artifact" or a "report".',
		'Users may edit stories directly; the tool result always reflects the latest version, including user edits.',
		'Unless explicitly stated, dont use the stories to display a chart, but the display_chart tool.',
		STORY_STYLE_DESCRIPTIONS[storyStyle],
	].join(' ');
}

function markdownSyntaxDescription(mapsEnabled: boolean): string[] {
	return [
		'Charts are embedded via <chart query_id="..." chart_type="..." x_axis_key="..." series=\'[...]\' title="..." />.',
		'For kpi_card charts you may add comparison_mode="percentage|variation|absolute" to show a period-over-period change pill; this requires the query to return at least two time-ordered rows (one per period) for the metric, and kpi_card does not need x_axis_key.',
		'SQL result tables are embedded via <table query_id="..." title="..." />.',
		...(mapsEnabled
			? ['Maps are embedded via <map query_id="..." map_type="points|scatter_bubble|choropleth" title="..." />.']
			: []),
		...(env.BETA_STORY_FILTERS_ENABLED ? [STORY_FILTER_DESCRIPTION] : []),
		`Use <grid>...</grid> to place 2–4 charts/tables${mapsEnabled ? '/maps' : ''} side by side; its direct <chart>/<table>${mapsEnabled ? '/<map>' : ''} blocks are the columns.`,
		'For unequal columns add widths="w1,w2,..." to the <grid> — one positive integer per column giving its relative width (e.g. widths="2,1" makes the first column twice as wide as the second). The number of values must equal the number of columns; omit widths for equal columns. Choose widths that fit the content, e.g. a wide time-series next to a narrow KPI or pie.',
		'Use consecutive <tab title="...">...</tab> blocks to organize a story into top-level tabs.',
		'Default to a single flowing story. Use tabs only when the user asks for tabs, or when the content splits into clearly distinct sections that are better separated than stacked (e.g. overview vs. detail, one topic/department/metric per tab). Avoid tabs for a short or single-topic story. Always follow the user\'s explicit request (e.g. "a tab per chart" means one chart per tab). When using tabs, the entire story must consist of <tab title="...">...</tab> blocks — no content outside a tab.',
	];
}

export default createTool<story.Input, story.Output>({
	description: buildStoryToolDescription(),
	inputSchema: story.InputSchema,
	outputSchema: story.OutputSchema,

	execute: async (input, context) => {
		const { chatId, userId, projectId } = context;

		const fail = (
			error: string,
			existing?: { code: string; version: number; title: string; format: StoryFormat },
		) =>
			({
				_version: '1' as const,
				success: false,
				id: input.id,
				version: existing?.version ?? 0,
				code: existing?.code ?? '',
				title: existing?.title ?? '',
				format: existing?.format,
				error,
			}) satisfies story.Output;

		if (input.format === 'dbt_charts' && !dbtChartsService.isDbtChartsAvailable()) {
			return fail((await dbtChartsService.getDbtChartsStatus()).install_hint ?? 'dbt Charts is not available.');
		}

		const storyStyle = resolveStoryStyle(context.agentSettings);

		if (input.action === 'create') {
			if (!input.code || !input.title) {
				return fail('"code" and "title" are required for the "create" action.');
			}
			const { title } = input;
			const existingStory = await storyQueries.getStoryByChatAndSlug(chatId, input.id);
			if (existingStory) {
				return fail(`Story "${input.id}" already exists. Use "update" or "replace" instead.`);
			}

			const format = input.format ?? defaultStoryFormatForStyle(storyStyle);
			if (!storyStyleAllowsFormat(storyStyle, format)) {
				return fail(disabledFormatError(format, storyStyle));
			}
			const code = await prepareCode(input.code, format, chatId);
			const version = await db.transaction(async (tx) => {
				const created = await storyQueries.createStoryVersion(
					{
						chatId,
						slug: input.id,
						title,
						code,
						action: 'create',
						source: 'assistant',
						format,
					},
					tx,
				);
				await storyFolderQueries.saveStoryInPrivateRoot(userId, projectId, created.storyId, tx);
				return created;
			});
			rememberStoryArtifact(context, input.id, version.title);

			return {
				_version: '1',
				success: true,
				id: input.id,
				version: version.version,
				code: version.code,
				title: version.title,
				format: version.format,
				...(await storyWarnings(context, version.format, version.code)),
			};
		}

		const existing = await storyQueries.getLatestVersionByChatAndSlug(chatId, input.id);
		if (!existing) {
			return fail(`Story "${input.id}" does not exist. Use "create" first.`);
		}

		if (input.action === 'update') {
			if (!input.search || input.replace === undefined) {
				return fail('"search" and "replace" are required for the "update" action.', existing);
			}
			const searchIndex = existing.code.indexOf(input.search);
			if (searchIndex === -1) {
				return fail(`Search string not found in story "${input.id}".`, existing);
			}

			const splicedCode = `${existing.code.slice(0, searchIndex)}${input.replace}${existing.code.slice(
				searchIndex + input.search.length,
			)}`;
			const newCode = await prepareCode(splicedCode, existing.format, chatId);
			const version = await storyQueries.createStoryVersion({
				chatId,
				slug: input.id,
				title: existing.title,
				code: newCode,
				action: 'update',
				source: 'assistant',
			});
			rememberStoryArtifact(context, input.id, version.title);

			return {
				_version: '1',
				success: true,
				id: input.id,
				version: version.version,
				code: version.code,
				title: version.title,
				format: version.format,
				...(await storyWarnings(context, version.format, version.code)),
			};
		}

		// action === 'replace'
		if (!input.code) {
			return fail('"code" is required for the "replace" action.', existing);
		}

		const format = input.format ?? existing.format;
		if (format !== existing.format && !storyStyleAllowsFormat(storyStyle, format)) {
			return fail(disabledFormatError(format, storyStyle), existing);
		}
		const replacedCode = await prepareCode(input.code, format, chatId);
		const version = await storyQueries.createStoryVersion({
			chatId,
			slug: input.id,
			title: existing.title,
			code: replacedCode,
			action: 'replace',
			source: 'assistant',
			format,
		});
		rememberStoryArtifact(context, input.id, version.title);

		return {
			_version: '1',
			success: true,
			id: input.id,
			version: version.version,
			code: version.code,
			title: version.title,
			format: version.format,
			...(await storyWarnings(context, version.format, version.code)),
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(StoryOutput({ output }), output),
});

function disabledFormatError(format: StoryFormat, storyStyle: StoryStyle): string {
	const allowed = defaultStoryFormatForStyle(storyStyle);
	return `Stories with format "${format}" are disabled in this project (Settings > Agent > Capabilities > Stories). Use format "${allowed}" instead.`;
}

async function prepareCode(code: string, format: StoryFormat, chatId: string): Promise<string> {
	if (format === 'dbt_charts') {
		return code;
	}
	const formatsByQueryId = await getDisplayChartTableFormatsForChat(chatId);
	return injectTableFormatting(code, formatsByQueryId);
}

/** The story version is already committed at this point, so a warning failure must not fail the tool. */
async function storyWarnings(
	context: ToolContext,
	format: StoryFormat,
	code: string,
): Promise<{ template_warnings?: string[] }> {
	try {
		const warnings =
			format === 'dbt_charts'
				? await dbtChartsBoardWarnings(context.projectId, code)
				: await getStoryTemplateWarnings(context.chatId, code);
		return warnings.length > 0 ? { template_warnings: warnings } : {};
	} catch (error) {
		console.error('Failed to compute story warnings', error);
		return {};
	}
}

async function dbtChartsBoardWarnings(projectId: string, boardYaml: string): Promise<string[]> {
	const validation = await dbtChartsService.validateBoard(projectId, boardYaml);
	return [
		...validation.errors.map((diagnostic) => `Error: ${formatDbtChartsDiagnostic(diagnostic)}`),
		...validation.warnings.map((diagnostic) => `Warning: ${formatDbtChartsDiagnostic(diagnostic)}`),
	];
}

function rememberStoryArtifact(context: ToolContext, id: string, title: string): void {
	const existing = context.generatedArtifacts.stories.find((story) => story.id === id);
	if (existing) {
		existing.title = title;
		return;
	}
	context.generatedArtifacts.stories.push({ id, title });
}
