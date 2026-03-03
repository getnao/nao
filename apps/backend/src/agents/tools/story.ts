import { story } from '@nao/shared/tools';

import { renderToModelOutput, StoryOutput } from '../../components/tool-outputs';
import * as storyQueries from '../../queries/story.queries';
import { createTool } from '../../utils/tools';

export default createTool<story.Input, story.Output>({
	description: [
		'Create or modify a nao Story — an interactive document combining markdown text and chart visualizations.',
		'Use "create" to initialize a new story, "update" to search-and-replace within it (producing a new version),',
		'or "replace" to overwrite the entire content (producing a new version).',
		'Charts are embedded via <chart query_id="..." chart_type="..." x_axis_key="..." series=\'[...]\' title="..." />.',
		'SQL result tables are embedded via <table query_id="..." title="..." />.',
		'Use <grid cols="2">...</grid> to display charts side by side in a responsive grid.',
		'A story can also be refered as a "canva", an "artifact" or a "report".',
		'Users may edit stories directly; the tool result always reflects the latest version, including user edits.',
		'Unless explicitly stated, dont use the stories to display a chart, but the display_chart tool.',
	].join(' '),
	inputSchema: story.InputSchema,
	outputSchema: story.OutputSchema,

	execute: async (input, context) => {
		const { chatId } = context;

		const fail = (error: string, existing?: { code: string; version: number; title: string }) =>
			({
				_version: '1' as const,
				success: false,
				id: input.id,
				version: existing?.version ?? 0,
				code: existing?.code ?? '',
				title: existing?.title ?? '',
				error,
			}) satisfies story.Output;

		if (input.action === 'create') {
			if (!input.code || !input.title) {
				return fail('"code" and "title" are required for the "create" action.');
			}
			const existingVersion = await storyQueries.getLatestVersion(chatId, input.id);
			if (existingVersion) {
				return fail(`Story "${input.id}" already exists. Use "update" or "replace" instead.`);
			}

			const version = await storyQueries.createVersion({
				chatId,
				storyId: input.id,
				title: input.title,
				code: input.code,
				action: 'create',
				source: 'assistant',
			});

			return {
				_version: '1',
				success: true,
				id: input.id,
				version: version.version,
				code: version.code,
				title: version.title,
			};
		}

		const existing = await storyQueries.getLatestVersion(chatId, input.id);
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

			const newCode = `${existing.code.slice(0, searchIndex)}${input.replace}${existing.code.slice(
				searchIndex + input.search.length,
			)}`;
			const version = await storyQueries.createVersion({
				chatId,
				storyId: input.id,
				title: existing.title,
				code: newCode,
				action: 'update',
				source: 'assistant',
			});

			return {
				_version: '1',
				success: true,
				id: input.id,
				version: version.version,
				code: version.code,
				title: version.title,
			};
		}

		// action === 'replace'
		if (!input.code) {
			return fail('"code" is required for the "replace" action.', existing);
		}

		const version = await storyQueries.createVersion({
			chatId,
			storyId: input.id,
			title: existing.title,
			code: input.code,
			action: 'replace',
			source: 'assistant',
		});

		return {
			_version: '1',
			success: true,
			id: input.id,
			version: version.version,
			code: version.code,
			title: version.title,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(StoryOutput({ output }), output),
});
