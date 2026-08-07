const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * Splits a CSV-family file into rows, following RFC 4180: a quoted field may hold the delimiter,
 * line breaks and doubled quotes. The delimiter is detected from the first line when not given,
 * because a spreadsheet exports one of four depending on where it was saved.
 */
export function parseDelimitedText(text: string, delimiter: string = detectDelimiter(text)): string[][] {
	const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;

	const endField = () => {
		row.push(field);
		field = '';
	};
	const endRow = () => {
		endField();
		rows.push(row);
		row = [];
	};

	for (let index = 0; index < content.length; index++) {
		const character = content[index]!;

		if (quoted) {
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
				quoted = true;
				break;
			case delimiter:
				endField();
				break;
			case '\n':
				endRow();
				break;
			// A CRLF ends the row on its newline; a lone carriage return ends it on its own.
			case '\r':
				if (content[index + 1] !== '\n') {
					endRow();
				}
				break;
			default:
				field += character;
		}
	}

	if (field !== '' || row.length > 0) {
		endRow();
	}

	return rows;
}

function detectDelimiter(text: string): string {
	const [header = ''] = text.split(/\r\n|\r|\n/, 1);

	return CANDIDATE_DELIMITERS.reduce((best, candidate) => {
		return occurrences(header, candidate) > occurrences(header, best) ? candidate : best;
	}, CANDIDATE_DELIMITERS[0] as string);
}

function occurrences(text: string, character: string): number {
	return text.split(character).length - 1;
}
