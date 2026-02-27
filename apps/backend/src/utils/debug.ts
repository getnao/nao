import { inspect } from 'util';

export const debugMemory = (message: string, data: unknown) => {
	if (process.env.DEBUG_MEMORY === 'true') {
		log(message, data);
	}
};

export const debugCompaction = (message: string, data: unknown) => {
	if (process.env.DEBUG_COMPACTION === 'true') {
		log(message, data);
	}
};

const log = (message: string, data: unknown) => {
	console.log(
		`<--- ${message} --->\n`,
		inspect(data, { showHidden: false, depth: null, colors: true }),
		`\n>--- ${message} ---<`,
	);
};
