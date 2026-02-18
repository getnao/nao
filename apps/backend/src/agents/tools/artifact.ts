import { artifact } from '@nao/shared/tools';
import { tool } from 'ai';

import { ArtifactOutput, renderToModelOutput } from '../../components/tool-outputs';

const artifactStore = new Map<string, { code: string; version: number; title: string }>();

export default tool<artifact.Input, artifact.Output>({
	description:
		'Create or modify an artifact — an interactive document combining markdown text and chart visualizations. Use "create" to initialize a new artifact, "update" to search-and-replace within it (producing a new version), or "replace" to overwrite the entire content (producing a new version). Charts are embedded via <chart query_id="..." chart_type="..." x_axis_key="..." series=\'[...]\' title="..." />. Use <grid cols="2">...</grid> to display charts side by side in a responsive grid.',
	inputSchema: artifact.InputSchema,
	outputSchema: artifact.OutputSchema,

	execute: async (input) => {
		const fail = (error: string, existing?: { code: string; version: number; title: string }) =>
			({
				_version: '1' as const,
				success: false,
				id: input.id,
				version: existing?.version ?? 0,
				code: existing?.code ?? '',
				title: existing?.title ?? '',
				error,
			}) satisfies artifact.Output;

		if (input.action === 'create') {
			if (!input.code || !input.title) {
				return fail('"code" and "title" are required for the "create" action.');
			}
			if (artifactStore.has(input.id)) {
				return fail(`Artifact "${input.id}" already exists. Use "update" or "replace" instead.`);
			}

			artifactStore.set(input.id, { code: input.code, version: 1, title: input.title });
			return { _version: '1', success: true, id: input.id, version: 1, code: input.code, title: input.title };
		}

		const existing = artifactStore.get(input.id);
		if (!existing) {
			return fail(`Artifact "${input.id}" does not exist. Use "create" first.`);
		}

		if (input.action === 'update') {
			if (!input.search || input.replace === undefined) {
				return fail('"search" and "replace" are required for the "update" action.', existing);
			}
			if (!existing.code.includes(input.search)) {
				return fail(`Search string not found in artifact "${input.id}".`, existing);
			}

			const newCode = existing.code.replace(input.search, input.replace);
			const newVersion = existing.version + 1;
			artifactStore.set(input.id, { code: newCode, version: newVersion, title: existing.title });
			return {
				_version: '1',
				success: true,
				id: input.id,
				version: newVersion,
				code: newCode,
				title: existing.title,
			};
		}

		// action === 'replace'
		if (!input.code) {
			return fail('"code" is required for the "replace" action.', existing);
		}
		const newVersion = existing.version + 1;
		artifactStore.set(input.id, { code: input.code, version: newVersion, title: existing.title });
		return {
			_version: '1',
			success: true,
			id: input.id,
			version: newVersion,
			code: input.code,
			title: existing.title,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(ArtifactOutput({ output }), output),
});
