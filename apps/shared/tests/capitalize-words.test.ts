import { describe, expect, it } from 'vitest';

import { labelize } from '../src/chart-builder';
import { capitalizeWords } from '../src/utils';

describe('capitalizeWords', () => {
	it('keeps accented words intact', () => {
		expect(capitalizeWords('La Réunion')).toBe('La Réunion');
	});

	it('keeps words intact when accents are separate combining marks', () => {
		expect(capitalizeWords('La Réunion')).toBe('La Réunion');
		expect(capitalizeWords('saint-étienne')).toBe('Saint-Étienne');
	});

	it('capitalizes a leading accented letter', () => {
		expect(capitalizeWords('île de france')).toBe('Île De France');
	});

	it('treats hyphens as word separators', () => {
		expect(capitalizeWords('Saint-Étienne')).toBe('Saint-Étienne');
		expect(capitalizeWords('saint-étienne')).toBe('Saint-Étienne');
	});

	it('never lowercases the rest of a word', () => {
		expect(capitalizeWords('SNCF')).toBe('SNCF');
	});
});

describe('labelize with accented labels', () => {
	it('keeps accented words intact', () => {
		expect(labelize('La Réunion')).toBe('La Réunion');
		expect(labelize('Saint-Étienne')).toBe('Saint-Étienne');
	});

	it('turns underscores into spaces and capitalizes each word', () => {
		expect(labelize('île_de_france')).toBe('Île De France');
		expect(labelize('total_trips')).toBe('Total Trips');
	});

	it('keeps acronyms uppercase', () => {
		expect(labelize('SNCF')).toBe('SNCF');
	});
});
