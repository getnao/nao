import { describe, expect, it } from 'vitest';

import { findUnfinishedCitationMarker, normalizeCitationMarkers } from '../src/citation';

const citation = (value: string) => `<citation-number id="query_ce907dd3" column="stars">${value}</citation-number>`;

describe('normalizeCitationMarkers', () => {
	it('restores the opening bracket an OpenAI citation marker replaced', () => {
		const text = `Up 822.7%. \uE200${citation('822.7').slice(1)} \uE200${citation('22').slice(1)}`;
		expect(normalizeCitationMarkers(text)).toBe(`Up 822.7%. ${citation('822.7')} ${citation('22')}`);
	});

	it('restores a marker that replaced the bracket of a closing tag', () => {
		const text = '<citation-number id="query_a" column="total">99\uE200/citation-number>';
		expect(normalizeCitationMarkers(text)).toBe(
			'<citation-number id="query_a" column="total">99</citation-number>',
		);
	});

	it('drops ChatGPT citations, which point to sources nao does not have', () => {
		const text =
			'Revenue was **622**. \uE200cite\uE202turn_e2bf7643\uE201 It grew 49,9 %. \uE200cite\uE202turn0\uE201';
		expect(normalizeCitationMarkers(text)).toBe('Revenue was **622**. It grew 49,9 %.');
	});

	it('drops stray markers left around a citation', () => {
		expect(normalizeCitationMarkers(`Total: ${citation('99')}\uE201`)).toBe(`Total: ${citation('99')}`);
	});

	it('leaves text without markers alone', () => {
		const text = `Omsætningen steg med ${citation('49,9')} % — fra januar til marts.`;
		expect(normalizeCitationMarkers(text)).toBe(text);
	});
});

describe('findUnfinishedCitationMarker', () => {
	it('finds a marker that may still become a citation tag, with the spaces before it', () => {
		expect(findUnfinishedCitationMarker('Total: \uE200')).toBe(6);
		expect(findUnfinishedCitationMarker('Total:\uE200citation-num')).toBe(6);
	});

	it('finds a ChatGPT citation that has not been closed yet', () => {
		expect(findUnfinishedCitationMarker('Total. \t\uE200cite\uE202turn0')).toBe(6);
	});

	it('ignores markers the text already settles', () => {
		expect(findUnfinishedCitationMarker('Total: \uE200citation-number id="query_a"')).toBe(-1);
		expect(findUnfinishedCitationMarker('Total. \uE200cite\uE202turn0\uE201 Next')).toBe(-1);
		expect(findUnfinishedCitationMarker('Total. \uE200cite\nNext')).toBe(-1);
		expect(findUnfinishedCitationMarker('Total: 99')).toBe(-1);
	});

	it('stops waiting for a ChatGPT citation that never closes', () => {
		expect(findUnfinishedCitationMarker(`Total. \uE200cite${'x'.repeat(250)}`)).toBe(-1);
	});
});
