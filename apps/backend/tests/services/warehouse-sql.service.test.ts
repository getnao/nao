import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../../src/env';
import { executeWarehouseSql } from '../../src/services/warehouse-sql.service';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';

const MEGABYTE = 1024 * 1024;
const RESULT_OPTIONS = {
	projectFolder: '/tmp/project',
	enforceExcludedColumns: false,
	tableAccess: { enforced: false },
	rowSecurity: { enforced: false },
} as const;

restoreProcessEnvAfterEach({ afterRestore: __reloadEnvForTesting });

beforeEach(() => {
	process.env.NAO_QUERY_RESULT_MAX_SIZE_MB = '1';
	__reloadEnvForTesting();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('executeWarehouseSql result size limit', () => {
	it('returns a result under the limit', async () => {
		const result = { data: [{ n: 1 }], row_count: 1, columns: ['n'] };
		stubWarehouseResponse(new Response(streamOf(JSON.stringify(result))));

		await expect(executeWarehouseSql('SELECT 1', RESULT_OPTIONS)).resolves.toEqual(result);
	});

	it.each([
		{
			name: 'a declared size',
			response: () => new Response('{}', { headers: { 'content-length': String(2 * MEGABYTE) } }),
			message: 'Query result is 2 MB, above the 1 MB limit.',
		},
		{
			name: 'a streamed body without a declared size',
			response: () => new Response(streamOf(`"${'x'.repeat(MEGABYTE)}"`)),
			message: 'Query result is larger, above the 1 MB limit.',
		},
	])('rejects a result over the limit from $name', async ({ response, message }) => {
		stubWarehouseResponse(response());

		await expect(executeWarehouseSql('SELECT *', RESULT_OPTIONS)).rejects.toMatchObject({
			name: 'WarehouseSqlError',
			status: 413,
			message: expect.stringContaining(message),
		});
	});
});

function stubWarehouseResponse(response: Response) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => response),
	);
}

function streamOf(text: string): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(text);
	const chunkSize = 64 * 1024;
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.byteLength) {
				controller.close();
				return;
			}
			controller.enqueue(bytes.subarray(offset, offset + chunkSize));
			offset += chunkSize;
		},
	});
}
