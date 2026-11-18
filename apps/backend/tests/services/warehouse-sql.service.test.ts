import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../../src/env';
import { executeWarehouseSql } from '../../src/services/warehouse-sql.service';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';

const MEGABYTE = 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
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
		stubWarehouseResponse(new Response(trackedStreamOf(JSON.stringify(result)).stream));

		await expect(executeWarehouseSql('SELECT 1', RESULT_OPTIONS)).resolves.toEqual(result);
	});

	it('cancels a result whose declared size is over the limit without reading it', async () => {
		const body = trackedStreamOf(`"${'x'.repeat(2 * MEGABYTE)}"`);
		stubWarehouseResponse(new Response(body.stream, { headers: { 'content-length': String(body.totalBytes) } }));

		await expectResultTooLarge('Query result is 3 MB, above the 1 MB limit.');
		expect(body.pulledBytes()).toBe(0);
		expect(body.wasCanceled()).toBe(true);
	});

	it('stops reading a streamed result as soon as it goes over the limit', async () => {
		const body = trackedStreamOf(`"${'x'.repeat(4 * MEGABYTE)}"`);
		stubWarehouseResponse(new Response(body.stream));

		await expectResultTooLarge('Query result is larger, above the 1 MB limit.');
		expect(body.pulledBytes()).toBeLessThanOrEqual(MEGABYTE + CHUNK_BYTES);
		expect(body.wasCanceled()).toBe(true);
	});
});

async function expectResultTooLarge(message: string) {
	await expect(executeWarehouseSql('SELECT *', RESULT_OPTIONS)).rejects.toMatchObject({
		name: 'WarehouseSqlError',
		status: 413,
		message: expect.stringContaining(message),
	});
}

function stubWarehouseResponse(response: Response) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => response),
	);
}

function trackedStreamOf(text: string) {
	const bytes = new TextEncoder().encode(text);
	let offset = 0;
	let canceled = false;
	const stream = new ReadableStream<Uint8Array>(
		{
			pull(controller) {
				if (offset >= bytes.byteLength) {
					controller.close();
					return;
				}
				controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
				offset += CHUNK_BYTES;
			},
			cancel() {
				canceled = true;
			},
		},
		{ highWaterMark: 0 },
	);
	return {
		stream,
		totalBytes: bytes.byteLength,
		pulledBytes: () => Math.min(offset, bytes.byteLength),
		wasCanceled: () => canceled,
	};
}
