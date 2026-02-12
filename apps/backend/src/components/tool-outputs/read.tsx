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
	const withLineNumbers = addLineNumbers(lines);
	const bytesLeft = output.content.length - visibleContent.length;

	return <Block>{withLineNumbers + (isTruncated ? `...(${formatSize(bytesLeft)} left)` : '')}</Block>;
}

const addLineNumbers = (lines: string[]) => {
	return lines.map((line, i) => `${i + 1}:${line}`).join('\n');
};
