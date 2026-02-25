export type SummarySegment =
	| { type: 'text'; content: string }
	| { type: 'chart'; chartType: string; title: string }
	| { type: 'table'; title: string }
	| { type: 'grid'; cols: number; children: SummarySegment[] };

export type StorySummary = {
	segments: SummarySegment[];
};

export function extractStorySummary(code: string): StorySummary {
	return { segments: extractSegments(code) };
}

function extractSegments(code: string): SummarySegment[] {
	const segments: SummarySegment[] = [];
	const blockRegex = /<grid\s+([^>]*)>([\s\S]*?)<\/grid>|<chart\s+([^/>]*)\/?>|<table\s+([^/>]*)\/?>/g;
	let match;
	let lastIndex = 0;

	while ((match = blockRegex.exec(code)) !== null) {
		if (match.index > lastIndex) {
			const content = truncateText(code.slice(lastIndex, match.index));
			if (content) {
				segments.push({ type: 'text', content });
			}
		}

		if (match[1] !== undefined && match[2] !== undefined) {
			const attrs = parseAttributes(match[1]);
			const cols = parseInt(attrs.cols || '2', 10);
			const children = extractSegments(match[2]);
			segments.push({ type: 'grid', cols, children });
		} else if (match[3] !== undefined) {
			const attrs = parseAttributes(match[3]);
			if (attrs.chart_type) {
				segments.push({
					type: 'chart',
					chartType: attrs.chart_type,
					title: attrs.title || '',
				});
			}
		} else if (match[4] !== undefined) {
			const attrs = parseAttributes(match[4]);
			segments.push({
				type: 'table',
				title: attrs.title || '',
			});
		}

		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < code.length) {
		const content = truncateText(code.slice(lastIndex));
		if (content) {
			segments.push({ type: 'text', content });
		}
	}

	return segments;
}

function truncateText(raw: string): string {
	const lines = raw
		.split('\n')
		.map((l) => l.trimEnd())
		.filter((l) => l.length > 0);

	const truncated = lines.slice(0, 10).map((line) => {
		if (line.length > 80) {
			return line.slice(0, 80);
		}
		return line;
	});

	return truncated.join('\n');
}

function parseAttributes(attrString: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const regex = /(\w+)=(?:"([^"]*)"|'([^']*)')/g;
	let match;
	while ((match = regex.exec(attrString)) !== null) {
		attrs[match[1]] = match[2] ?? match[3];
	}
	return attrs;
}
