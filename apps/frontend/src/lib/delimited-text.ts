const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * Splits a CSV-family file into rows, following RFC 4180: a quoted field may hold the delimiter,
 * line breaks and doubled quotes. The delimiter is detected from the first record when not given,
 * because a spreadsheet exports one of four depending on where it was saved.
 */
export function parseDelimitedText(
	text: string,
	delimiter: string = detectDelimiter(text),
	maxRows = Number.POSITIVE_INFINITY,
): string[][] {
	if (maxRows <= 0) {
		return [];
	}

	const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let fieldPresent = false;
	let quoted = false;

	const endField = () => {
		row.push(field);
		field = '';
		fieldPresent = false;
	};
	const endRow = () => {
		endField();
		rows.push(row);
		row = [];
	};

	for (let index = 0; index < content.length; index++) {
		const character = content[index]!;

		if (quoted) {
			fieldPresent = true;
			if (character !== '"') {
				field += character;
			} else if (content[index + 1] === '"') {
				field += '"';
				index++;
			} else {
				quoted = false;
			}
			continue;
		}

		switch (character) {
			case '"':
				fieldPresent = true;
				quoted = true;
				break;
			case delimiter:
				endField();
				break;
			case '\n':
				endRow();
				if (rows.length >= maxRows) {
					return rows;
				}
				break;
			// A CRLF ends the row on its newline; a lone carriage return ends it on its own.
			case '\r':
				if (content[index + 1] !== '\n') {
					endRow();
					if (rows.length >= maxRows) {
						return rows;
					}
				}
				break;
			default:
				fieldPresent = true;
				field += character;
		}
	}

	if (fieldPresent || row.length > 0) {
		endRow();
	}

	return rows;
}

function detectDelimiter(text: string): string {
	const counts = new Map<string, number>(CANDIDATE_DELIMITERS.map((candidate) => [candidate, 0]));
	let quoted = false;

	for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index++) {
		const character = text[index]!;
		if (character === '"') {
			if (quoted && text[index + 1] === '"') {
				index++;
			} else {
				quoted = !quoted;
			}
			continue;
		}
		if (!quoted && (character === '\r' || character === '\n')) {
			break;
		}
		if (!quoted && counts.has(character)) {
			counts.set(character, counts.get(character)! + 1);
		}
	}

	return CANDIDATE_DELIMITERS.reduce((best, candidate) => {
		return counts.get(candidate)! > counts.get(best)! ? candidate : best;
	}, CANDIDATE_DELIMITERS[0] as string);
}
