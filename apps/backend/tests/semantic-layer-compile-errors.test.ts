import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileSemanticQuery, SemanticQueryCompileError } from '../src/services/semantic-layer.service';
import type { ToolContext } from '../src/types/tools';

const context = { projectFolder: '/project', envVars: {} } as unknown as ToolContext;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('compileSemanticQuery errors', () => {
	it('raises a SemanticQueryCompileError when the layer rejects the query', async () => {
		stubCompileResponse(422, { detail: 'Got error(s) during query resolution. no_such_metric' });

		const error = await compileSemanticQuery({ metrics: ['no_such_metric'] }, context).catch((caught) => caught);

		expect(error).toBeInstanceOf(SemanticQueryCompileError);
		expect(error.message).toBe(
			'Error compiling semantic query: Got error(s) during query resolution. no_such_metric',
		);
	});

	it.each([400, 500, 503])('raises a plain error for status %s', async (status) => {
		stubCompileResponse(status, { detail: 'Semantic layer unavailable' });

		const error = await compileSemanticQuery({ metrics: ['revenue'] }, context).catch((caught) => caught);

		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(SemanticQueryCompileError);
	});
});

function stubCompileResponse(status: number, body: unknown): void {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, statusText: 'error' })),
	);
}
