import { describe, expect, it } from 'vitest';

import { sanitizeCron } from '../src/utils/cron';

describe('sanitizeCron', () => {
	it('keeps a bare expression as it is', () => {
		expect(sanitizeCron('0 8 * * *')).toBe('0 8 * * *');
	});

	it('drops the backticks around an inline expression', () => {
		expect(sanitizeCron('`0 8 * * *`')).toBe('0 8 * * *');
	});

	it('drops a fenced block', () => {
		expect(sanitizeCron('```\n0 8 * * *\n```')).toBe('0 8 * * *');
	});

	it('drops the language tag of a fenced block', () => {
		expect(sanitizeCron('```cron\n0 8 * * *\n```')).toBe('0 8 * * *');
	});

	it('drops the whitespace surrounding a fenced block', () => {
		expect(sanitizeCron('  ```bash\n*/15 9-17 * * 1-5\n```  ')).toBe('*/15 9-17 * * 1-5');
	});

	it('returns nothing for an empty answer', () => {
		expect(sanitizeCron('```\n\n```')).toBe('');
	});
});
