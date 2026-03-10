import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDate, resolveTimezone, SystemPrompt } from '../src/components/ai/system-prompt';
import { renderToMarkdown } from '../src/lib/markdown';

describe('resolveTimezone', () => {
	it('returns UTC when no timezone is provided', () => {
		expect(resolveTimezone()).toBe('UTC');
		expect(resolveTimezone(undefined)).toBe('UTC');
	});

	it('returns the timezone when it is a valid IANA timezone', () => {
		expect(resolveTimezone('America/New_York')).toBe('America/New_York');
		expect(resolveTimezone('Europe/Paris')).toBe('Europe/Paris');
		expect(resolveTimezone('Asia/Tokyo')).toBe('Asia/Tokyo');
		expect(resolveTimezone('UTC')).toBe('UTC');
	});

	it('returns UTC for invalid timezone strings', () => {
		expect(resolveTimezone('Invalid/Zone')).toBe('UTC');
		expect(resolveTimezone('NotATimezone')).toBe('UTC');
		expect(resolveTimezone('')).toBe('UTC');
	});
});

describe('formatDate', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-10T15:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('formats date in UTC and appends (UTC) when no timezone is given', () => {
		const result = formatDate();
		expect(result).toBe('Tuesday, March 10, 2026 (UTC)');
	});

	it('formats date in the given timezone and appends the timezone name', () => {
		const result = formatDate('America/New_York');
		expect(result).toBe('Tuesday, March 10, 2026 (America/New_York)');
	});

	it('handles timezone where the date differs from UTC', () => {
		vi.setSystemTime(new Date('2026-03-11T01:00:00Z'));
		expect(formatDate('America/Los_Angeles')).toBe('Tuesday, March 10, 2026 (America/Los_Angeles)');
		expect(formatDate('UTC')).toBe('Wednesday, March 11, 2026 (UTC)');
	});

	it('falls back to UTC for invalid timezone', () => {
		const result = formatDate('Invalid/Zone');
		expect(result).toBe('Tuesday, March 10, 2026 (UTC)');
	});
});

describe('SystemPrompt timezone rendering', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-10T15:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('includes the timezone in the rendered prompt', () => {
		const markdown = renderToMarkdown(SystemPrompt({ timezone: 'Europe/Paris' }));
		expect(markdown).toContain('Tuesday, March 10, 2026 (Europe/Paris)');
	});

	it('defaults to UTC when no timezone is passed', () => {
		const markdown = renderToMarkdown(SystemPrompt({}));
		expect(markdown).toContain('Tuesday, March 10, 2026 (UTC)');
	});
});
