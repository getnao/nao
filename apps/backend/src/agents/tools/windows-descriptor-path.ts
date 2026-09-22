const INITIAL_PATH_BUFFER_LENGTH = 512;
const MAX_PATH_BUFFER_LENGTH = 32_768;
const EXTENDED_PATH_PREFIX = '\\\\?\\';
const EXTENDED_UNC_PATH_PREFIX = '\\\\?\\UNC\\';

export async function resolveWindowsDescriptorPath(descriptor: number): Promise<string> {
	const bunFfiModule: string = 'bun:ffi';
	const { dlopen } = (await import(bunFfiModule)) as typeof import('bun:ffi');
	const cRuntime = dlopen('msvcrt.dll', {
		_get_osfhandle: {
			args: ['i32'],
			returns: 'i64',
		},
	} as const);

	try {
		const windows = dlopen('kernel32.dll', {
			GetFinalPathNameByHandleW: {
				args: ['u64', 'ptr', 'u32', 'u32'],
				returns: 'u32',
			},
		} as const);

		try {
			const handle = cRuntime.symbols._get_osfhandle(descriptor);
			if (handle < 0n) {
				throw new Error('Invalid Windows file handle');
			}

			const descriptorPath = readFinalPath(windows.symbols.GetFinalPathNameByHandleW, handle);
			return normalizeWindowsDescriptorPath(descriptorPath);
		} finally {
			windows.close();
		}
	} finally {
		cRuntime.close();
	}
}

export function normalizeWindowsDescriptorPath(descriptorPath: string): string {
	const upperPath = descriptorPath.toUpperCase();
	if (upperPath.startsWith(EXTENDED_UNC_PATH_PREFIX)) {
		return `\\\\${descriptorPath.slice(EXTENDED_UNC_PATH_PREFIX.length)}`;
	}
	if (upperPath.startsWith(EXTENDED_PATH_PREFIX)) {
		return descriptorPath.slice(EXTENDED_PATH_PREFIX.length);
	}
	return descriptorPath;
}

type GetFinalPathNameByHandle = (
	handle: number | bigint,
	buffer: Uint16Array,
	bufferLength: number,
	flags: number,
) => number;

function readFinalPath(getFinalPathName: GetFinalPathNameByHandle, handle: bigint): string {
	let buffer = new Uint16Array(INITIAL_PATH_BUFFER_LENGTH);
	let pathLength = getFinalPathName(handle, buffer, buffer.length, 0);

	if (pathLength >= buffer.length) {
		if (!Number.isSafeInteger(pathLength) || pathLength > MAX_PATH_BUFFER_LENGTH) {
			throw new Error('Invalid Windows descriptor path length');
		}
		buffer = new Uint16Array(pathLength);
		pathLength = getFinalPathName(handle, buffer, buffer.length, 0);
	}

	if (pathLength === 0 || pathLength >= buffer.length) {
		throw new Error('Unable to resolve Windows descriptor path');
	}

	return new TextDecoder('utf-16le').decode(buffer.subarray(0, pathLength));
}
