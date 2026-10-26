import { DEFAULT_TEST_COMPARISON_TOLERANCES, type TestComparisonTolerances, type TestVerdict } from '../types/test-run';

type Cell = number | string | boolean | null;
type ColumnKind = 'integer' | 'float' | 'other';

interface NormalizedTable {
	kinds: ColumnKind[];
	rows: Cell[][];
}

export interface TestDataComparisonInput {
	/** Rows of the agent answer, or null when no answer could be extracted. */
	actual: Record<string, unknown>[] | null;
	expected: Record<string, unknown>[];
	expectedColumns: string[];
	error?: string | null;
}

const MAX_REPORTED_DIFFERENCES = 20;

const CURRENCY_PREFIX = /^[$€£¥₹]/;
const WHITESPACE = /[\s\u00a0\u202f]/g;
const US_NUMBER = /^[\d,]*\d[\d,]*(\.\d+)?$/;
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;
const EU_NUMBER = /^[\d.]+,\d+$/;
const EU_THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

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

	const columns = expectedColumns.length > 0 ? expectedColumns : actualColumns;
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
	const actualTable = normalizeTable(actual, sortedColumns, tolerances.decimals);
	const expectedTable = normalizeTable(expected, sortedColumns, tolerances.decimals);

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

/** Parses locale-formatted number strings (`$1,234.50`, `1.234,5`) so they compare equal to raw numbers. */
export function normalizeFormattedNumber(value: unknown): unknown {
	if (typeof value !== 'string') {
		return value;
	}
	const text = value.trim();
	if (!text) {
		return value;
	}
	const cleaned = text.replace(CURRENCY_PREFIX, '').trim().replace(WHITESPACE, '');
	return parseNumericString(cleaned) ?? value;
}

function parseNumericString(value: string): number | null {
	const negative = value.startsWith('-');
	let unsigned = negative ? value.slice(1) : value;
	if (unsigned.startsWith('+')) {
		unsigned = unsigned.slice(1);
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

function normalizeTable(records: Record<string, unknown>[], columns: string[], decimals: number): NormalizedTable {
	const rawRows = records.map((record) => columns.map((column) => toCell(normalizeFormattedNumber(record[column]))));
	const kinds = columns.map((_, index) => inferColumnKind(rawRows.map((row) => row[index])));
	const roundedRows = rawRows.map((row) =>
		row.map((cell, index) =>
			kinds[index] === 'float' && typeof cell === 'number' ? roundHalfEven(cell, decimals) : cell,
		),
	);
	return { kinds, rows: roundedRows.sort(compareRows) };
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
