import {
	DEFAULT_TEST_COMPARISON_TOLERANCES,
	type TestComparisonTolerances,
	type TestDataCell,
	type TestDataCellStatus,
	type TestDataDiff,
	type TestVerdict,
} from '../types/test-run';

type Cell = TestDataCell;
type ColumnKind = 'integer' | 'float' | 'other';

interface NormalizedTable {
	kinds: ColumnKind[];
	rows: Cell[][];
}

interface TestDataComparisonInput {
	/** Rows of the agent answer, or null when no answer could be extracted. */
	actual: Record<string, unknown>[] | null;
	expected: Record<string, unknown>[];
	expectedColumns: string[];
	error?: string | null;
}

const MAX_REPORTED_DIFFERENCES = 20;

const CURRENCY_PREFIX = /^([+-]?)\s*[$€£¥₹]/;
const WHITESPACE = /[\s\u00a0\u202f]/g;
const US_NUMBER = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;
const EU_NUMBER = /^[\d.]+,\d+$/;
const EU_THOUSANDS = /^\d{1,3}(\.\d{3})+$/;
const LEADING_ZERO = /^0\d/;
const UTC_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(:\d{2})?(\.\d+)?)?\s*(?:Z|UTC|[+-]00:?00)?$/;
const MIDNIGHT = '00:00:00';
const MONTH = /^\d{4}-\d{2}$/;
const MONTH_START = /^\d{4}-\d{2}-01$/;

/**
 * Compares the agent answer to the expected rows the way `nao test` always has: column order,
 * row order and display formatting are ignored, floats are rounded, then numbers are compared
 * within tolerances.
 */
export function compareTestData(
	{ actual, expected, expectedColumns, error }: TestDataComparisonInput,
	tolerances: TestComparisonTolerances = DEFAULT_TEST_COMPARISON_TOLERANCES,
): TestVerdict {
	if (actual === null) {
		return failed(error || 'no data returned');
	}
	const actualColumns = collectColumns(actual);
	const expectedDataColumns = collectColumns(expected);
	const actualIsEmpty = actual.length === 0 || actualColumns.length === 0;
	const expectedIsEmpty = expected.length === 0 || expectedDataColumns.length === 0;
	if (actualIsEmpty && expectedIsEmpty) {
		return passed('both empty');
	}
	if (actualIsEmpty) {
		return failed('actual is empty');
	}
	if (expectedIsEmpty) {
		return failed('expected is empty');
	}

	const columns = comparedColumns(expected, expectedColumns);
	const missingColumns = columns.filter((column) => !actualColumns.includes(column));
	if (missingColumns.length > 0) {
		return failed(`missing columns: ${missingColumns.join(', ')}`);
	}
	const missingExpectedColumns = columns.filter((column) => !expectedDataColumns.includes(column));
	if (missingExpectedColumns.length > 0) {
		return failed(`expected data is missing columns: ${missingExpectedColumns.join(', ')}`);
	}
	if (actual.length !== expected.length) {
		return failed(`row count: ${actual.length} vs ${expected.length}`);
	}

	const sortedColumns = [...columns].sort();
	const { actualTable, expectedTable } = normalizeTables(actual, expected, sortedColumns, tolerances.decimals);

	if (areTablesEqual(actualTable, expectedTable)) {
		return passed('match');
	}
	if (areTablesClose(actualTable, expectedTable, tolerances)) {
		return passed('match (approximate)');
	}
	return {
		passed: false,
		message: 'values differ',
		comparison: describeDifferences(actualTable, expectedTable, sortedColumns),
	};
}

/**
 * Pairs the expected and actual rows cell by cell, normalized and sorted like `compareTestData` does, so
 * what the diff shows is what the verdict compared. When the row counts differ, which fails the verdict
 * before any value is compared, identical rows are lined up instead so the missing and extra ones stand out.
 * Returns null when there is no answer data to show.
 */
export function buildTestDataDiff(
	{ actual, expected, expectedColumns }: Omit<TestDataComparisonInput, 'error'>,
	tolerances: TestComparisonTolerances = DEFAULT_TEST_COMPARISON_TOLERANCES,
	rowCounts: { actual?: number | null; expected?: number | null } = {},
): TestDataDiff | null {
	if (actual === null) {
		return null;
	}
	const actualColumns = collectColumns(actual);
	const declaredColumns = comparedColumns(expected, expectedColumns);
	const columns = declaredColumns.length > 0 ? declaredColumns : actualColumns;
	if (columns.length === 0) {
		return null;
	}

	const sortedColumns = [...columns].sort();
	const displayOrder = columns.map((column) => sortedColumns.indexOf(column));
	const { actualTable, expectedTable } = normalizeTables(actual, expected, sortedColumns, tolerances.decimals);
	const toDisplayOrder = <T>(values: T[]) => displayOrder.map((index) => values[index]);
	const pairs =
		actualTable.rows.length === expectedTable.rows.length
			? actualTable.rows.map((row, index) => ({ actualRow: row, expectedRow: expectedTable.rows[index] }))
			: mergeSortedRows(actualTable.rows, expectedTable.rows);
	const rows = pairs.map(({ actualRow, expectedRow }) => {
		return {
			expected: expectedRow ? toDisplayOrder(expectedRow) : null,
			actual: actualRow ? toDisplayOrder(actualRow) : null,
			statuses:
				actualRow && expectedRow
					? toDisplayOrder(
							sortedColumns.map((_, index) =>
								cellStatus(actualRow[index], expectedRow[index], {
									isNumeric:
										actualTable.kinds[index] !== 'other' && expectedTable.kinds[index] !== 'other',
									tolerances,
								}),
							),
						)
					: null,
		};
	});

	const actualRowCount = rowCounts.actual ?? actual.length;
	const expectedRowCount = rowCounts.expected ?? expected.length;
	return {
		columns,
		missingColumns: declaredColumns.filter((column) => !actualColumns.includes(column)),
		extraColumns: actualColumns.filter((column) => !columns.includes(column)),
		expectedRowCount,
		actualRowCount,
		rows,
		isTruncated: actualRowCount > actual.length || expectedRowCount > expected.length,
	};
}

/** The columns the verdict compares: the declared ones, else every column of the expected rows. */
export function comparedColumns(expected: Record<string, unknown>[], expectedColumns: string[]): string[] {
	return expectedColumns.length > 0 ? expectedColumns : collectColumns(expected);
}

/** Sorts records the way the verdict compares them, so keeping the first ones keeps rows that pair up. */
export function orderRecordsForComparison(
	records: Record<string, unknown>[],
	columns: string[],
	decimals: number = DEFAULT_TEST_COMPARISON_TOLERANCES.decimals,
): Record<string, unknown>[] {
	const sortedColumns = [...(columns.length > 0 ? columns : collectColumns(records))].sort();
	const { rows } = normalizeRows(records, sortedColumns, decimals);
	return rows
		.map((row, index) => ({ row, record: records[index] }))
		.sort((left, right) => compareRows(left.row, right.row))
		.map(({ record }) => record);
}

/**
 * Lines up two sorted tables of different lengths so a missing or extra row does not shift the rows after it:
 * identical rows pair up, the others stand alone on their side.
 */
function mergeSortedRows(actual: Cell[][], expected: Cell[][]): { actualRow?: Cell[]; expectedRow?: Cell[] }[] {
	const pairs: { actualRow?: Cell[]; expectedRow?: Cell[] }[] = [];
	let actualIndex = 0;
	let expectedIndex = 0;
	while (actualIndex < actual.length || expectedIndex < expected.length) {
		const order =
			actualIndex >= actual.length
				? 1
				: expectedIndex >= expected.length
					? -1
					: compareRows(actual[actualIndex], expected[expectedIndex]);
		if (order === 0) {
			pairs.push({ actualRow: actual[actualIndex++], expectedRow: expected[expectedIndex++] });
		} else if (order < 0) {
			pairs.push({ actualRow: actual[actualIndex++] });
		} else {
			pairs.push({ expectedRow: expected[expectedIndex++] });
		}
	}
	return pairs;
}

function cellStatus(
	actual: Cell,
	expected: Cell,
	{ isNumeric, tolerances }: { isNumeric: boolean; tolerances: TestComparisonTolerances },
): TestDataCellStatus {
	if (actual === expected) {
		return 'match';
	}
	return isNumeric && areNumbersClose(actual, expected, tolerances) ? 'close' : 'differ';
}

/**
 * Parses locale-formatted number strings (`$1,234.50`, `1.234,5`) so they compare equal to raw numbers.
 * Text with leading zeros (`00123`) is an identifier, not a number, and stays text.
 */
export function normalizeFormattedNumber(value: unknown): unknown {
	if (typeof value !== 'string') {
		return value;
	}
	const text = value.trim();
	if (!text) {
		return value;
	}
	const cleaned = text.replace(CURRENCY_PREFIX, '$1').trim().replace(WHITESPACE, '');
	return parseNumericString(cleaned) ?? value;
}

function parseNumericString(value: string): number | null {
	const negative = value.startsWith('-');
	let unsigned = negative ? value.slice(1) : value;
	if (unsigned.startsWith('+')) {
		unsigned = unsigned.slice(1);
	}
	if (LEADING_ZERO.test(unsigned)) {
		return null;
	}

	let parsed: number | null = null;
	if (US_NUMBER.test(unsigned)) {
		parsed = Number(unsigned.replaceAll(',', ''));
	} else if (PLAIN_NUMBER.test(unsigned)) {
		parsed = Number(unsigned);
	} else if (EU_NUMBER.test(unsigned)) {
		parsed = Number(unsigned.replaceAll('.', '').replace(',', '.'));
	} else if (EU_THOUSANDS.test(unsigned)) {
		parsed = Number(unsigned.replaceAll('.', ''));
	}

	if (parsed === null || Number.isNaN(parsed)) {
		return null;
	}
	return negative ? -parsed : parsed;
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
	const columns = new Set<string>();
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			columns.add(key);
		}
	}
	return [...columns];
}

function normalizeTables(
	actual: Record<string, unknown>[],
	expected: Record<string, unknown>[],
	columns: string[],
	decimals: number,
): { actualTable: NormalizedTable; expectedTable: NormalizedTable } {
	const actualTable = normalizeRows(actual, columns, decimals);
	const expectedTable = normalizeRows(expected, columns, decimals);
	columns.forEach((_, index) => alignMonthColumn(actualTable.rows, expectedTable.rows, index));
	return { actualTable: sortTable(actualTable), expectedTable: sortTable(expectedTable) };
}

function sortTable({ kinds, rows }: NormalizedTable): NormalizedTable {
	return { kinds, rows: [...rows].sort(compareRows) };
}

function normalizeRows(records: Record<string, unknown>[], columns: string[], decimals: number): NormalizedTable {
	const rawRows = records.map((record) => columns.map((column) => normalizeValue(record[column])));
	const kinds = columns.map((_, index) => inferColumnKind(rawRows.map((row) => row[index])));
	const roundedRows = rawRows.map((row) =>
		row.map((cell, index) =>
			kinds[index] === 'float' && typeof cell === 'number' ? roundHalfEven(cell, decimals) : cell,
		),
	);
	return { kinds, rows: roundedRows };
}

function normalizeValue(value: unknown): Cell {
	const cell = toCell(normalizeFormattedNumber(value));
	return typeof cell === 'string' ? normalizeTimestamp(cell) : cell;
}

/**
 * Writes UTC dates and timestamps one way (`2018-04-01 00:00:00.000Z` → `2018-04-01`), so a date
 * returned as a midnight timestamp equals the same date returned as a plain date.
 */
function normalizeTimestamp(value: string): string {
	const match = UTC_TIMESTAMP.exec(value.trim());
	if (!match) {
		return value;
	}
	const [, date, hoursAndMinutes, seconds = ':00', fraction = ''] = match;
	if (!hoursAndMinutes) {
		return date;
	}
	const time = `${hoursAndMinutes}${seconds}`;
	const significantFraction = fraction.replace(/\.?0+$/, '');
	if (time === MIDNIGHT && !significantFraction) {
		return date;
	}
	return `${date}T${time}${significantFraction}`;
}

/**
 * A month is often returned as its first day (`2018-04-01`) on one side and as `2018-04` on the
 * other: when a column holds only months on one side and only first days of months on the other,
 * the first days are truncated to their month.
 */
function alignMonthColumn(actual: Cell[][], expected: Cell[][], index: number): void {
	if (holdsOnly(actual, index, MONTH) && holdsOnly(expected, index, MONTH_START)) {
		truncateToMonth(expected, index);
	} else if (holdsOnly(expected, index, MONTH) && holdsOnly(actual, index, MONTH_START)) {
		truncateToMonth(actual, index);
	}
}

function holdsOnly(rows: Cell[][], index: number, pattern: RegExp): boolean {
	const present = rows.map((row) => row[index]).filter((cell) => cell !== null);
	return present.length > 0 && present.every((cell) => typeof cell === 'string' && pattern.test(cell));
}

function truncateToMonth(rows: Cell[][], index: number): void {
	for (const row of rows) {
		const cell = row[index];
		if (typeof cell === 'string') {
			row[index] = cell.slice(0, 7);
		}
	}
}

function toCell(value: unknown): Cell {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === 'number') {
		return Number.isNaN(value) ? null : value;
	}
	if (typeof value === 'bigint') {
		return Number(value);
	}
	if (typeof value === 'string' || typeof value === 'boolean') {
		return value;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	return JSON.stringify(value);
}

function inferColumnKind(values: Cell[]): ColumnKind {
	const present = values.filter((value) => value !== null);
	if (present.length === 0 || !present.every((value) => typeof value === 'number')) {
		return 'other';
	}
	const hasMissingValues = present.length !== values.length;
	return !hasMissingValues && present.every((value) => Number.isInteger(value)) ? 'integer' : 'float';
}

/** Rounds half to even, like numpy, so results match what the Python CLI produced. */
function roundHalfEven(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	const scaled = value * factor;
	const floor = Math.floor(scaled);
	const fraction = scaled - floor;
	if (fraction > 0.5) {
		return (floor + 1) / factor;
	}
	if (fraction < 0.5) {
		return floor / factor;
	}
	return (floor % 2 === 0 ? floor : floor + 1) / factor;
}

function compareRows(left: Cell[], right: Cell[]): number {
	for (let index = 0; index < left.length; index++) {
		const order = compareCells(left[index], right[index]);
		if (order !== 0) {
			return order;
		}
	}
	return 0;
}

function compareCells(left: Cell, right: Cell): number {
	if (left === right) {
		return 0;
	}
	if (left === null) {
		return 1;
	}
	if (right === null) {
		return -1;
	}
	if (typeof left !== typeof right) {
		return typeof left < typeof right ? -1 : 1;
	}
	if (typeof left === 'number' && typeof right === 'number') {
		return left - right;
	}
	return String(left) < String(right) ? -1 : 1;
}

function areTablesEqual(actual: NormalizedTable, expected: NormalizedTable): boolean {
	return (
		actual.kinds.every((kind, index) => kind === expected.kinds[index]) &&
		actual.rows.every((row, rowIndex) => row.every((cell, index) => cell === expected.rows[rowIndex][index]))
	);
}

function areTablesClose(
	actual: NormalizedTable,
	expected: NormalizedTable,
	tolerances: TestComparisonTolerances,
): boolean {
	return actual.kinds.every((actualKind, index) => {
		const expectedKind = expected.kinds[index];
		const isNumeric = actualKind !== 'other' && expectedKind !== 'other';
		if (!isNumeric && actualKind !== expectedKind) {
			return false;
		}
		return actual.rows.every((row, rowIndex) => {
			const actualCell = row[index];
			const expectedCell = expected.rows[rowIndex][index];
			return isNumeric ? areNumbersClose(actualCell, expectedCell, tolerances) : actualCell === expectedCell;
		});
	});
}

function areNumbersClose(actual: Cell, expected: Cell, { rtol, atol }: TestComparisonTolerances): boolean {
	if (actual === null || expected === null) {
		return actual === expected;
	}
	const actualNumber = Number(actual);
	const expectedNumber = Number(expected);
	if (actualNumber === expectedNumber) {
		return true;
	}
	return Math.abs(actualNumber - expectedNumber) <= atol + rtol * Math.abs(expectedNumber);
}

function describeDifferences(actual: NormalizedTable, expected: NormalizedTable, columns: string[]): string {
	const differences: string[] = [];
	actual.rows.forEach((row, rowIndex) => {
		row.forEach((cell, index) => {
			const expectedCell = expected.rows[rowIndex][index];
			if (cell !== expectedCell) {
				differences.push(
					`row ${rowIndex}, ${columns[index]}: actual=${formatCell(cell)}, expected=${formatCell(expectedCell)}`,
				);
			}
		});
	});
	const reported = differences.slice(0, MAX_REPORTED_DIFFERENCES);
	const remaining = differences.length - reported.length;
	return remaining > 0 ? [...reported, `... and ${remaining} more`].join('\n') : reported.join('\n');
}

function formatCell(cell: Cell): string {
	return cell === null ? 'null' : JSON.stringify(cell);
}

function passed(message: string): TestVerdict {
	return { passed: true, message, comparison: null };
}

function failed(message: string): TestVerdict {
	return { passed: false, message, comparison: null };
}
