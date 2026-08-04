import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SystemPrompt } from '../src/components/ai/system-prompt';
import { renderToMarkdown } from '../src/lib/markdown';
import { formatCurrentDate, resolveTimezone } from '../src/utils/date';

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

describe('formatCurrentDate', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-10T15:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('formats date in UTC and appends (UTC) when no timezone is given', () => {
		const result = formatCurrentDate();
		expect(result).toBe('Tuesday, March 10, 2026 (UTC)');
	});

	it('formats date in the given timezone and appends the timezone name', () => {
		const result = formatCurrentDate('America/New_York');
		expect(result).toBe('Tuesday, March 10, 2026 (America/New_York)');
	});

	it('handles timezone where the date differs from UTC', () => {
		vi.setSystemTime(new Date('2026-03-11T01:00:00Z'));
		expect(formatCurrentDate('America/Los_Angeles')).toBe('Tuesday, March 10, 2026 (America/Los_Angeles)');
		expect(formatCurrentDate('UTC')).toBe('Wednesday, March 11, 2026 (UTC)');
	});

	it('falls back to UTC for invalid timezone', () => {
		const result = formatCurrentDate('Invalid/Zone');
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

	it('describes available custom charts and their web-only scope', () => {
		const markdown = renderToMarkdown(
			SystemPrompt({
				customCharts: [
					{
						type: 'bubble',
						name: 'Bubble chart',
						description: 'Shows three numeric dimensions.',
						version: 'abc123',
					},
				],
			}),
		);

		expect(markdown).toContain('**bubble**: Shows three numeric dimensions.');
		expect(markdown).toContain('interactive web chats only');
	});

	it('bounds the custom chart list and truncates long descriptions', () => {
		const customCharts = Array.from({ length: 60 }, (_, index) => ({
			type: `chart-${index}`,
			name: `Chart ${index}`,
			description: index === 0 ? 'x'.repeat(400) : `Description ${index}`,
			version: `v${index}`,
		}));

		const markdown = renderToMarkdown(SystemPrompt({ customCharts }));

		expect(markdown).toContain('**chart-0**');
		expect(markdown).toContain('**chart-49**');
		expect(markdown).not.toContain('**chart-50**');
		expect(markdown).toContain('And 10 more custom chart types in agent/charts');
		expect(markdown).not.toContain('x'.repeat(400));
		expect(markdown).toContain(`${'x'.repeat(199)}…`);
	});
});

describe('SystemPrompt saved files rules', () => {
	it('tells the agent grep also searches inside saved files on a filesystem backend', () => {
		const markdown = renderToMarkdown(SystemPrompt({ options: { canGrepSavedFiles: true } }));
		expect(markdown).toContain('**grep** also searches inside its files.');
	});

	it('tells the agent to search by name instead when grep cannot read saved files', () => {
		const markdown = renderToMarkdown(SystemPrompt({ options: { canGrepSavedFiles: false } }));
		expect(markdown).toContain('**grep** cannot look inside **/home**');
		expect(markdown).toContain('**search**');
	});

	it('omits the saved files section when the run has no write tool', () => {
		const markdown = renderToMarkdown(SystemPrompt({ toolNames: ['execute_sql'] }));
		expect(markdown).not.toContain('Saved Files');
	});
});

describe('SystemPrompt display_map rules', () => {
	it('includes the display_map rule by default', () => {
		expect(renderToMarkdown(SystemPrompt({}))).toContain('display_map');
	});

	it('omits the display_map rule when the run excludes the tool', () => {
		expect(renderToMarkdown(SystemPrompt({ toolNames: ['execute_sql', 'display_chart'] }))).not.toContain(
			'display_map',
		);
	});
});
