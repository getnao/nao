import { type UnzipFileFilter, unzipSync } from 'fflate';

/**
 * Describes the sheets of an .xlsx without reading a single cell.
 *
 * A workbook is the one attachment whose shape has to be known before it can be queried:
 * `read_xlsx` takes the first sheet unless told otherwise, and DuckDB offers no way to list the
 * others, so a question about the second sheet is unanswerable until someone names it. This is
 * the equivalent of looking at the tabs, and it costs a few lines of context rather than a
 * sheet's worth of rows.
 * @throws Error when the file is not a readable workbook.
 */
export const describeWorkbook = (data: Buffer): string => {
	const sheets = readSheets(data);
	const first = sheets[0];
	if (!first) {
		throw new Error('This workbook declares no sheet, so there is nothing in it to read.');
	}

	return [
		`Excel workbook with ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'}, in tab order. No cells are read here: query a sheet by name with the local database, e.g. SELECT * FROM read_xlsx('<path>', sheet = '${escapeSqlLiteral(first.name)}') LIMIT 20.`,
		...sheets.map(describeSheet),
		'The counts are the used range the file records, so they include any title, blank or totals rows around the table — look at the first rows before deciding where the header is.',
	].join('\n');
};

const escapeSqlLiteral = (value: string): string => value.replaceAll("'", "''");

interface Sheet {
	name: string;
	hidden: boolean;
	/** Cell range the sheet records as used, e.g. `A1:N4312`, or null when it records none. */
	range: string | null;
}

const describeSheet = (sheet: Sheet): string => {
	const shape = sheet.range ? shapeOf(sheet.range) : null;
	const size = shape
		? `${shape.rows} ${shape.rows === 1 ? 'row' : 'rows'} × ${shape.columns} ${shape.columns === 1 ? 'column' : 'columns'} (${sheet.range})`
		: 'size not recorded in the file';

	return `- '${sheet.name}'${sheet.hidden ? ' (hidden)' : ''} — ${size}`;
};

interface Shape {
	rows: number;
	columns: number;
}

const shapeOf = (range: string): Shape | null => {
	const [from, to = from] = range.split(':');
	const first = parseCellReference(from ?? '');
	const last = parseCellReference(to ?? '');
	if (!first || !last) {
		return null;
	}

	return { rows: last.row - first.row + 1, columns: last.column - first.column + 1 };
};

const parseCellReference = (reference: string): { row: number; column: number } | null => {
	const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(reference.trim().toUpperCase());
	if (!match) {
		return null;
	}

	const column = [...match[1]!].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0);
	return { row: Number(match[2]), column };
};

const WORKBOOK_PATH = 'xl/workbook.xml';
const WORKBOOK_RELS_PATH = 'xl/_rels/workbook.xml.rels';

/** Guards against a small archive that unpacks into gigabytes of sheet XML. */
const MAX_SHEET_XML_BYTES = 128 * 1024 * 1024;

/**
 * The tab list lives in `xl/workbook.xml`, and each tab's used range at the top of its own
 * part, which the relationships file maps it to. Only those parts are inflated: the shared
 * strings and the cell values are the bulk of a workbook and none of it is needed here.
 */
const readSheets = (data: Buffer): Sheet[] => {
	const bytes = new Uint8Array(data);
	const workbook = inflate(bytes, ({ name }) => name === WORKBOOK_PATH || name === WORKBOOK_RELS_PATH);

	const workbookXml = workbook.get(WORKBOOK_PATH);
	if (!workbookXml) {
		throw new Error('This file is a zip archive but not a workbook: it has no xl/workbook.xml part.');
	}

	const partsByRelationship = readRelationships(workbook.get(WORKBOOK_RELS_PATH) ?? '');
	const tabs = readTabs(workbookXml);
	const parts = inflateSheetParts(bytes, tabs, partsByRelationship);

	return tabs.map(({ name, hidden, relationship }) => {
		const part = partsByRelationship.get(relationship) ?? '';
		return { name, hidden, range: rangeOf(parts.get(part) ?? '') };
	});
};

interface Tab {
	name: string;
	hidden: boolean;
	relationship: string;
}

const readTabs = (workbookXml: string): Tab[] => {
	return matchTags(workbookXml, 'sheet').map((tag) => ({
		name: decodeXml(attribute(tag, 'name') ?? ''),
		hidden: (attribute(tag, 'state') ?? 'visible') !== 'visible',
		relationship: attribute(tag, 'r:id') ?? '',
	}));
};

const readRelationships = (relsXml: string): Map<string, string> => {
	const entries = matchTags(relsXml, 'Relationship').map((tag): [string, string] => {
		return [attribute(tag, 'Id') ?? '', partPath(decodeXml(attribute(tag, 'Target') ?? ''))];
	});

	return new Map(entries);
};

/** A relationship target is either absolute in the archive or relative to the `xl` folder. */
const partPath = (target: string): string => {
	return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
};

const inflateSheetParts = (
	bytes: Uint8Array,
	tabs: Tab[],
	partsByRelationship: Map<string, string>,
): Map<string, string> => {
	const wanted = new Set(tabs.flatMap((tab) => partsByRelationship.get(tab.relationship) ?? []));
	let budget = MAX_SHEET_XML_BYTES;

	return inflate(bytes, ({ name, originalSize }) => {
		if (!wanted.has(name) || originalSize > budget) {
			return false;
		}
		budget -= originalSize;
		return true;
	});
};

const rangeOf = (sheetXml: string): string | null => {
	return /<dimension[^>]*\bref="([^"]+)"/.exec(sheetXml)?.[1] ?? null;
};

const inflate = (bytes: Uint8Array, filter: UnzipFileFilter): Map<string, string> => {
	const decoder = new TextDecoder();

	try {
		const parts = unzipSync(bytes, { filter });
		return new Map(Object.entries(parts).map(([name, content]) => [name, decoder.decode(content)]));
	} catch (error) {
		throw new Error(
			`This workbook could not be opened, so it may be corrupt or password-protected — an .xlsx is a zip archive, and this one did not unpack: ${reason(error)}`,
		);
	}
};

const matchTags = (xml: string, tagName: string): string[] => {
	return xml.match(new RegExp(`<${tagName}\\b[^>]*>`, 'g')) ?? [];
};

const attribute = (tag: string, name: string): string | undefined => {
	return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
};

const XML_ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&apos;': "'",
};

const decodeXml = (value: string): string => {
	return value.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);
};

const reason = (error: unknown): string => {
	return error instanceof Error ? error.message : String(error);
};
