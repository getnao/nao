import { readFile } from '@nao/shared/tools';

import { Block } from '../../lib/markdown';
import { formatSize } from '../../utils/utils';

const MAX_CHARS = readFile.MODEL_OUTPUT_MAX_CHARS;
const ANNOTATIONS_MAX_CHARS = readFile.ANNOTATIONS_MAX_CHARS;

export function ReadOutput({ output, maxChars = MAX_CHARS }: { output: readFile.Output; maxChars?: number }) {
	if (output.numberOfTotalLines === 0 || output.content === '') {
		return <Block>File is empty.</Block>;
	}

	const isTruncated = output.content.length > maxChars;
	const visibleContent = isTruncated ? output.content.slice(0, maxChars) : output.content;
	const lines = visibleContent.split('\n');
	const withLineNumbers = addLineNumbers(lines);
	const bytesLeft = output.content.length - visibleContent.length;

	return (
		<Block>
			{withLineNumbers + (isTruncated ? `...(${formatSize(bytesLeft)} left)` : '')}
			{output.annotations && <AnnotationsOutput annotations={output.annotations} />}
		</Block>
	);
}

function AnnotationsOutput({ annotations }: { annotations: NonNullable<readFile.Output['annotations']> }) {
	const isTruncated = annotations.content.length > ANNOTATIONS_MAX_CHARS;
	const visibleContent = isTruncated ? annotations.content.slice(0, ANNOTATIONS_MAX_CHARS) : annotations.content;
	const bytesLeft = annotations.content.length - visibleContent.length;
	const truncationNotice = `...(${formatSize(bytesLeft)} left, read ${annotations.path} for the rest)`;

	return (
		<Block>
			{`Human annotations from ${annotations.path} (authoritative, prefer them over generated files if they disagree):`}
			{visibleContent + (isTruncated ? truncationNotice : '')}
		</Block>
	);
}

const addLineNumbers = (lines: string[]) => {
	return lines.map((line, i) => `${i + 1}:${line}`).join('\n');
};
