import { describe, expect, it } from 'vitest';

import { getTestScheduleCronError, sanitizeCron } from '../../src/utils/cron';

describe('sanitizeCron', () => {
	it.each([
		['keeps a bare expression as it is', '0 8 * * *', '0 8 * * *'],
		['drops the backticks around an inline expression', '`0 8 * * *`', '0 8 * * *'],
		['drops a fenced block', '```\n0 8 * * *\n```', '0 8 * * *'],
		['drops the language tag of a fenced block', '```cron\n0 8 * * *\n```', '0 8 * * *'],
		['drops the whitespace surrounding a fenced block', '  ```bash\n*/15 9-17 * * 1-5\n```  ', '*/15 9-17 * * 1-5'],
		['returns nothing for an empty answer', '```\n\n```', ''],
	])('%s', (_name, answer, expected) => {
		expect(sanitizeCron(answer)).toBe(expected);
	});
});

describe('getTestScheduleCronError', () => {
	it.each([
		{ cron: '0 6 * * *', error: null },
		{ cron: '0 * * * *', error: null },
		{ cron: '30 8 * * 1-5', error: null },
		{ cron: 'every morning', error: 'Invalid cron expression: every morning' },
		{ cron: '*/30 * * * *', error: 'Schedule the tests at most once an hour.' },
		{ cron: '0,1 6 * * *', error: 'Schedule the tests at most once an hour.' },
	])('judges $cron: $error', ({ cron, error }) => {
		expect(getTestScheduleCronError(cron)).toBe(error);
	});
});
