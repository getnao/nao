import { beforeEach, describe, expect, it, vi } from 'vitest';

const ffiControls = vi.hoisted(() => ({
	dlopen: vi.fn(),
}));

vi.mock('bun:ffi', () => ({ dlopen: ffiControls.dlopen }));

import {
	normalizeWindowsDescriptorPath,
	resolveWindowsDescriptorPath,
} from '../src/agents/tools/windows-descriptor-path';

const OPENED_FILE_HANDLE = 42n;
const OPENED_FILE_FINAL_PATH = '\\\\?\\C:\\project\\notes.md';

let getOsfHandle: ReturnType<typeof vi.fn>;

beforeEach(() => {
	ffiControls.dlopen.mockReset();
	getOsfHandle = vi.fn().mockReturnValue(OPENED_FILE_HANDLE);
	ffiControls.dlopen.mockImplementation((library: string) => {
		if (library === process.execPath) {
			return { symbols: { uv_get_osfhandle: getOsfHandle }, close: vi.fn() };
		}
		if (library === 'kernel32.dll') {
			return { symbols: { GetFinalPathNameByHandleW: writeOpenedFileFinalPath }, close: vi.fn() };
		}
		throw new Error(`Unexpected library '${library}'`);
	});
});

describe('Windows descriptor path resolution', () => {
	it("maps descriptors through the running Bun executable's descriptor table", async () => {
		await expect(resolveWindowsDescriptorPath(3)).resolves.toBe('C:\\project\\notes.md');

		expect(getOsfHandle).toHaveBeenCalledWith(3);
	});

	it('fails closed when the descriptor has no Windows handle', async () => {
		getOsfHandle.mockReturnValue(-1n);

		await expect(resolveWindowsDescriptorPath(999)).rejects.toThrow('Invalid Windows file handle');
	});
});

describe('Windows descriptor path normalization', () => {
	it('normalizes extended drive paths', () => {
		expect(normalizeWindowsDescriptorPath('\\\\?\\C:\\project\\notes.md')).toBe('C:\\project\\notes.md');
	});

	it('normalizes extended UNC paths', () => {
		expect(normalizeWindowsDescriptorPath('\\\\?\\UNC\\server\\share\\notes.md')).toBe(
			'\\\\server\\share\\notes.md',
		);
	});
});

function writeOpenedFileFinalPath(handle: bigint, buffer: Uint16Array): number {
	if (handle !== OPENED_FILE_HANDLE) {
		return 0;
	}
	for (let index = 0; index < OPENED_FILE_FINAL_PATH.length; index++) {
		buffer[index] = OPENED_FILE_FINAL_PATH.charCodeAt(index);
	}
	return OPENED_FILE_FINAL_PATH.length;
}
