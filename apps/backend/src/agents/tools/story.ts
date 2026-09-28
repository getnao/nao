import { injectTableFormatting } from '@nao/shared/story-segments';
import { story } from '@nao/shared/tools';

import { renderToModelOutput, StoryOutput } from '../../components/tool-outputs';
import type { DBStory } from '../../db/abstractSchema';
import { db } from '../../db/db';
import { env } from '../../env';
import { getDisplayChartTableFormatsForChat } from '../../queries/chart-image';
import * as storyQueries from '../../queries/story.queries';
import * as storyFileQueries from '../../queries/story-file.queries';
import * as storyFolderQueries from '../../queries/story-folder.queries';
import { buildStoryApp } from '../../services/story-app-build';
import { isCustomStoriesEnabled } from '../../services/story-mount';
import { scaffoldCustomStoryFiles } from '../../services/story-scaffold';
import { getStoryTemplateWarnings } from '../../services/story-template-validation';
import type { ToolContext } from '../../types/tools';
import { normalizeStoryFilePath } from '../../utils/story-file-path';
import { STORIES_MOUNT } from '../../utils/story-mount';
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

const CUSTOM_STORY_DESCRIPTION = [
	`format="custom" creates a React app instead: "create" seeds a @nao/story-kit starter under /${STORIES_MOUNT}/<id>/ (or takes "files"), edit it with the write tool, then "publish" builds and snapshots it.`,
	'See the Custom Stories instructions for when to pick it.',
].join(' ');

export function buildStoryToolDescription({
	mapsEnabled = false,
	customStories = isCustomStoriesEnabled(),
}: { mapsEnabled?: boolean; customStories?: boolean } = {}) {
	return [
		'Create or modify a nao Story — an interactive document combining markdown text and chart visualizations.',
		'Use "create" to initialize a new story, "update" to search-and-replace within it (producing a new version),',
		'or "replace" to overwrite the entire content (producing a new version).',
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
		'A story can also be refered as a "canva", an "artifact" or a "report".',
		'Users may edit stories directly; the tool result always reflects the latest version, including user edits.',
		'Unless explicitly stated, dont use the stories to display a chart, but the display_chart tool.',
		...(customStories ? [CUSTOM_STORY_DESCRIPTION] : []),
	].join(' ');
}

type ExistingStory = { code: string; version: number; title: string };

export default createTool<story.Input, story.Output>({
	description: buildStoryToolDescription(),
	inputSchema: story.InputSchema,
	outputSchema: story.OutputSchema,

	execute: async (input, context) => {
		if (input.action === 'create') {
			return input.format === 'custom' ? createCustomStory(input, context) : createClassicStory(input, context);
		}

		const existingStory = await storyQueries.getStoryByChatAndSlug(context.chatId, input.id);
		if (!existingStory) {
			return fail(input.id, `Story "${input.id}" does not exist. Use "create" first.`);
		}
		if (existingStory.format === 'custom') {
			return runCustomStoryAction(input, existingStory, context);
		}
		if (input.action === 'publish' || input.action === 'delete_files' || input.action === 'revert') {
			return fail(
				input.id,
				`"${input.action}" only applies to custom stories; "${input.id}" is a classic story.`,
			);
		}

		const existing = await storyQueries.getLatestVersionByChatAndSlug(context.chatId, input.id);
		if (!existing) {
			return fail(input.id, `Story "${input.id}" does not exist. Use "create" first.`);
		}
		return input.action === 'update'
			? updateClassicStory(input, existing, context)
			: replaceClassicStory(input, existing, context);
	},

	toModelOutput: ({ output }) => renderToModelOutput(StoryOutput({ output }), output),
});

function fail(id: string, error: string, existing?: ExistingStory): story.Output {
	return {
		_version: '1',
		success: false,
		id,
		version: existing?.version ?? 0,
		code: existing?.code ?? '',
		title: existing?.title ?? '',
		error,
	};
}

async function createClassicStory(input: story.Input, context: ToolContext): Promise<story.Output> {
	const { chatId, userId, projectId } = context;
	if (!context.userGroupFeatures.includes('storyCreation')) {
		return fail(input.id, 'Story creation is unavailable for this user in this project.');
	}
	if (!input.code || !input.title) {
		return fail(input.id, '"code" and "title" are required for the "create" action.');
	}
	const { title } = input;
	const existingStory = await storyQueries.getStoryByChatAndSlug(chatId, input.id);
	if (existingStory) {
		return fail(input.id, `Story "${input.id}" already exists. Use "update" or "replace" instead.`);
	}

	const code = await carryOverTableFormatting(input.code, chatId);
	const version = await db.transaction(async (tx) => {
		const created = await storyQueries.createStoryVersion(
			{ chatId, slug: input.id, title, code, action: 'create', source: 'assistant' },
			tx,
		);
		await storyFolderQueries.saveStoryInPrivateRoot(userId, projectId, created.storyId, tx);
		return created;
	});
	return classicResult(input.id, version, context);
}

async function updateClassicStory(
	input: story.Input,
	existing: ExistingStory,
	context: ToolContext,
): Promise<story.Output> {
	if (!input.search || input.replace === undefined) {
		return fail(input.id, '"search" and "replace" are required for the "update" action.', existing);
	}
	const searchIndex = existing.code.indexOf(input.search);
	if (searchIndex === -1) {
		return fail(input.id, `Search string not found in story "${input.id}".`, existing);
	}

	const splicedCode = `${existing.code.slice(0, searchIndex)}${input.replace}${existing.code.slice(
		searchIndex + input.search.length,
	)}`;
	const version = await storyQueries.createStoryVersion({
		chatId: context.chatId,
		slug: input.id,
		title: existing.title,
		code: await carryOverTableFormatting(splicedCode, context.chatId),
		action: 'update',
		source: 'assistant',
	});
	return classicResult(input.id, version, context);
}

async function replaceClassicStory(
	input: story.Input,
	existing: ExistingStory,
	context: ToolContext,
): Promise<story.Output> {
	if (!input.code) {
		return fail(input.id, '"code" is required for the "replace" action.', existing);
	}

	const version = await storyQueries.createStoryVersion({
		chatId: context.chatId,
		slug: input.id,
		title: existing.title,
		code: await carryOverTableFormatting(input.code, context.chatId),
		action: 'replace',
		source: 'assistant',
	});
	return classicResult(input.id, version, context);
}

async function classicResult(
	id: string,
	version: { version: number; code: string; title: string },
	context: ToolContext,
): Promise<story.Output> {
	rememberStoryArtifact(context, id, version.title);
	return {
		_version: '1',
		success: true,
		id,
		version: version.version,
		code: version.code,
		title: version.title,
		...(await storyTemplateWarnings(context.chatId, version.code)),
	};
}

/** A custom story starts as a draft under /stories/<id>/; it has no version until it is published. */
async function createCustomStory(input: story.Input, context: ToolContext): Promise<story.Output> {
	const { chatId, userId, projectId } = context;
	if (!isCustomStoriesEnabled()) {
		return fail(input.id, 'Custom stories are disabled on this instance. Create a classic story instead.');
	}
	if (!context.userGroupFeatures.includes('customStoryCreation')) {
		return fail(
			input.id,
			'Custom story creation is unavailable for this user in this project. Create a classic story instead.',
		);
	}
	if (!input.title) {
		return fail(input.id, '"title" is required for the "create" action.');
	}
	const { title } = input;
	const existingStory = await storyQueries.getStoryByChatAndSlug(chatId, input.id);
	if (existingStory) {
		return fail(input.id, `Story "${input.id}" already exists.`);
	}

	try {
		const files = await db.transaction(async (tx) => {
			const created = await storyQueries.createCustomStory({ chatId, slug: input.id, title }, tx);
			await storyFolderQueries.saveStoryInPrivateRoot(userId, projectId, created.id, tx);
			return storyFileQueries.seedDraftFiles(created.id, scaffoldCustomStoryFiles(title, input.files ?? []), tx);
		});
		rememberStoryArtifact(context, input.id, title);
		return customResult(
			input.id,
			{ title, version: 0 },
			files.map((file) => file.path),
		);
	} catch (error) {
		return fail(input.id, `Could not create story "${input.id}": ${(error as Error).message}`);
	}
}

/** The draft is built before any version is cut, so a published version always carries a working bundle. */
function runCustomStoryAction(input: story.Input, existingStory: DBStory, context: ToolContext): Promise<story.Output> {
	switch (input.action) {
		case 'publish':
			return publishCustomStory(existingStory, context);
		case 'delete_files':
			return deleteCustomStoryFiles(existingStory, input.paths ?? []);
		case 'revert':
			return revertCustomStoryDraft(existingStory, input.version);
		default:
			return Promise.resolve(
				fail(
					input.id,
					`Story "${input.id}" is a custom story: edit its files under /${STORIES_MOUNT}/${input.id}/ with the write tool, then use "publish".`,
				),
			);
	}
}

async function deleteCustomStoryFiles(existingStory: DBStory, paths: string[]): Promise<story.Output> {
	const { slug } = existingStory;
	const published = await publishedState(existingStory);
	if (paths.length === 0) {
		return fail(slug, '"paths" is required for "delete_files".', published);
	}
	let targets: string[];
	try {
		targets = paths.map((path) => normalizeStoryFilePath(toStoryFilePath(slug, path)));
	} catch (error) {
		return fail(slug, (error as Error).message, published);
	}
	const draft = new Set((await storyFileQueries.listDraftFiles(existingStory.id)).map((file) => file.path));
	const missing = targets.filter((path) => !draft.has(path));
	if (missing.length > 0) {
		return fail(slug, `Not in the draft of "${slug}": ${missing.join(', ')}. Nothing was deleted.`, published);
	}

	await db.transaction(async (tx) => {
		for (const path of targets) {
			await storyFileQueries.deleteDraftFile(existingStory.id, path, tx);
		}
	});
	const files = await storyFileQueries.listDraftFiles(existingStory.id);
	return {
		...customResult(
			slug,
			published,
			files.map((file) => file.path),
		),
		message: `Deleted ${targets.join(', ')} from the draft. Publish to make the change live.`,
	};
}

async function revertCustomStoryDraft(
	existingStory: DBStory,
	versionNumber: number | undefined,
): Promise<story.Output> {
	const { slug, chatId } = existingStory;
	const published = await publishedState(existingStory);
	const target =
		versionNumber === undefined
			? await storyQueries.getLatestVersionByChatAndSlug(chatId!, slug)
			: await storyQueries.getVersionByNumber(chatId!, slug, versionNumber);
	if (!target) {
		return fail(
			slug,
			versionNumber === undefined
				? `Story "${slug}" has no published version to revert to.`
				: `Story "${slug}" has no version ${versionNumber}.`,
			published,
		);
	}

	const files = await storyFileQueries.restoreDraftFromVersion(existingStory.id, target.id);
	const isLatest = target.version === published.version;
	return {
		...customResult(
			slug,
			published,
			files.map((file) => file.path),
		),
		message: isLatest
			? `The draft is back to the published v${target.version}; there is nothing to publish.`
			: `The draft now holds the files of v${target.version}. Publish to make them live as a new version.`,
	};
}

async function publishedState(existingStory: DBStory): Promise<ExistingStory> {
	const latest = await storyQueries.getLatestVersionByChatAndSlug(existingStory.chatId!, existingStory.slug);
	return { code: '', version: latest?.version ?? 0, title: existingStory.title };
}

/** Accepts a path relative to the story root or the full `/stories/<id>/…` path the file tools use. */
function toStoryFilePath(slug: string, path: string): string {
	const prefix = `/${STORIES_MOUNT}/${slug}/`;
	const trimmed = path.trim();
	return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed.replace(/^\.?\//, '');
}

async function publishCustomStory(existingStory: DBStory, context: ToolContext): Promise<story.Output> {
	const unpublished = { code: '', version: 0, title: existingStory.title };
	try {
		const draft = await storyFileQueries.listDraftFiles(existingStory.id);
		if (draft.length === 0) {
			return fail(
				existingStory.slug,
				`Story "${existingStory.slug}" has no files yet. Write them under /${STORIES_MOUNT}/${existingStory.slug}/ first.`,
				unpublished,
			);
		}

		const build = await buildStoryApp(draft.map((file) => ({ path: file.path, content: file.content })));
		if (!build.ok) {
			return {
				...fail(
					existingStory.slug,
					`Story "${existingStory.slug}" does not build. Fix the files below and publish again.`,
					unpublished,
				),
				format: 'custom',
				files: draft.map((file) => file.path),
				build_errors: build.errors,
			};
		}

		const { version, files } = await storyFileQueries.cutVersionFromDraft({
			storyId: existingStory.id,
			action: 'publish',
			source: 'assistant',
		});
		await storyFileQueries.setVersionBundle(version.id, { bundle: build.bundle, bundleError: null });
		rememberStoryArtifact(context, existingStory.slug, existingStory.title);
		return customResult(
			existingStory.slug,
			{ title: existingStory.title, version: version.version },
			files.map((file) => file.path),
		);
	} catch (error) {
		return fail(
			existingStory.slug,
			`Could not publish story "${existingStory.slug}": ${(error as Error).message}`,
			unpublished,
		);
	}
}

function customResult(id: string, story: { title: string; version: number }, files: string[]): story.Output {
	return {
		_version: '1',
		success: true,
		id,
		version: story.version,
		code: '',
		title: story.title,
		format: 'custom',
		files,
	};
}

async function carryOverTableFormatting(code: string, chatId: string): Promise<string> {
	const formatsByQueryId = await getDisplayChartTableFormatsForChat(chatId);
	return injectTableFormatting(code, formatsByQueryId);
}

/** The story version is already committed at this point, so a warning failure must not fail the tool. */
async function storyTemplateWarnings(chatId: string, code: string): Promise<{ template_warnings?: string[] }> {
	try {
		const warnings = await getStoryTemplateWarnings(chatId, code);
		return warnings.length > 0 ? { template_warnings: warnings } : {};
	} catch (error) {
		console.error('Failed to compute story template warnings', error);
		return {};
	}
}

function rememberStoryArtifact(context: ToolContext, id: string, title: string): void {
	const existing = context.generatedArtifacts.stories.find((story) => story.id === id);
	if (existing) {
		existing.title = title;
		return;
	}
	context.generatedArtifacts.stories.push({ id, title });
}
