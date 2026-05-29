const CHART_NOT_FOUND_MESSAGE = 'Could not locate the chart in the current story version.';

export function replaceUniqueChartTag(storyCode: string, rawTag: string, nextTag: string): string {
	if (!rawTag) {
		throw new Error(CHART_NOT_FOUND_MESSAGE);
	}

	const startIndex = storyCode.indexOf(rawTag);
	if (startIndex === -1) {
		throw new Error(CHART_NOT_FOUND_MESSAGE);
	}

	const nextIndex = storyCode.indexOf(rawTag, startIndex + rawTag.length);
	if (nextIndex !== -1) {
		throw new Error('Could not uniquely identify the chart because the same chart tag appears more than once.');
	}

	return `${storyCode.slice(0, startIndex)}${nextTag}${storyCode.slice(startIndex + rawTag.length)}`;
}
