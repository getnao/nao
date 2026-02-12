import type { readFile } from '@nao/shared/tools';

import { Block } from '../../lib/markdown';
import { formatSize } from '../../utils/utils';

const MAX_CHARS = 32_000;

export function ReadOutput({ output, maxChars = MAX_CHARS }: { output: readFile.Output; maxChars?: number }) {
	if (output.numberOfTotalLines === 0 || output.content === '') {
		return <Block>File is empty.</Block>;
	}

	const isTruncated = output.content.length > maxChars;
	const visibleContent = isTruncated ? output.content.slice(0, maxChars) : output.content;
	const lines = visibleContent.split('\n');
	const startLine = output._version === '2' ? output.startLine : 1;
	const withLineNumbers = addLineNumbers(lines, startLine);
	const bytesLeft = output.content.length - visibleContent.length;

	return <Block>{withLineNumbers + (isTruncated ? `...(${formatSize(bytesLeft)} left)` : '')}</Block>;
}

const addLineNumbers = (lines: string[], startLine = 1) => {
	return lines.map((line, i) => `${startLine + i}:${line}`).join('\n');
};
