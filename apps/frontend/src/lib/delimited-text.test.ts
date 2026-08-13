import { describe, expect, it } from 'vitest';

import { parseDelimitedText } from './delimited-text';

describe('parseDelimitedText', () => {
	it('splits plain comma-separated rows', () => {
		expect(parseDelimitedText('name,amount\nAlpha,12\nBeta,7')).toEqual([
			['name', 'amount'],
			['Alpha', '12'],
			['Beta', '7'],
		]);
	});

	it('keeps delimiters, line breaks and doubled quotes inside a quoted field', () => {
		expect(parseDelimitedText('name,note\n"Alpha, Ltd","said ""hi""\nthen left"')).toEqual([
			['name', 'note'],
			['Alpha, Ltd', 'said "hi"\nthen left'],
		]);
	});

	it('handles CRLF, a lone carriage return and a trailing newline', () => {
		expect(parseDelimitedText('a,b\r\n1,2\r3,4\n')).toEqual([
			['a', 'b'],
			['1', '2'],
			['3', '4'],
		]);
	});

	it('detects the delimiter a European export uses', () => {
		expect(parseDelimitedText('name;amount\nAlpha;12')).toEqual([
			['name', 'amount'],
			['Alpha', '12'],
		]);
	});

	it('ignores candidate delimiters inside a quoted first record', () => {
		expect(parseDelimitedText('"description, with comma";amount\nAlpha;12')).toEqual([
			['description, with comma', 'amount'],
			['Alpha', '12'],
		]);
	});

	it('detects from the first logical record when its quoted field spans lines', () => {
		expect(parseDelimitedText('"description\nwith, comma";amount\nAlpha;12')).toEqual([
			['description\nwith, comma', 'amount'],
			['Alpha', '12'],
		]);
	});

	it('uses the given delimiter rather than detecting one', () => {
		expect(parseDelimitedText('name\tnote\nAlpha\ta, b', '\t')).toEqual([
			['name', 'note'],
			['Alpha', 'a, b'],
		]);
	});

	it('keeps empty fields', () => {
		expect(parseDelimitedText('a,b,c\n1,,3')).toEqual([
			['a', 'b', 'c'],
			['1', '', '3'],
		]);
	});

	it('keeps a final empty quoted field', () => {
		expect(parseDelimitedText('""')).toEqual([['']]);
		expect(parseDelimitedText('a,""')).toEqual([['a', '']]);
	});

	it('can stop parsing after a bounded number of rows', () => {
		expect(parseDelimitedText('a\n1\n2\n3', ',', 2)).toEqual([['a'], ['1']]);
	});

	it('returns no rows for a non-positive row limit', () => {
		expect(parseDelimitedText('a\n1', ',', 0)).toEqual([]);
		expect(parseDelimitedText('a\n1', ',', -1)).toEqual([]);
	});

	it('drops the byte order mark a spreadsheet writes', () => {
		expect(parseDelimitedText('\ufeffname\nAlpha')).toEqual([['name'], ['Alpha']]);
	});
});
