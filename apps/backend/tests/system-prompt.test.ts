import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
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
		expect(markdown).not.toContain('lookup');
	});

	it('omits the saved files section when the run has no write tool', () => {
		const markdown = renderToMarkdown(SystemPrompt({ toolNames: ['execute_sql'] }));
		expect(markdown).not.toContain('Saved Files');
	});

	it('does not recommend save_to when execute_sql is unavailable', () => {
		const markdown = renderToMarkdown(SystemPrompt({ toolNames: ['write'] }));
		expect(markdown).not.toContain('**save_to**');
	});

	it('explains that an attachment arrives as a path, not as content', () => {
		const markdown = renderToMarkdown(SystemPrompt({}));
		expect(markdown).toContain('**/home/uploads**');
		expect(markdown).toContain('Only their path reaches you, never their contents');
	});

	it('says a pdf comes back as text and a workbook as its sheet list', () => {
		const markdown = renderToMarkdown(SystemPrompt({ toolNames: ['write'] }));
		expect(markdown).toContain('**read** extracts the text of a PDF');
		expect(markdown).toContain("workbook's outline instead of its cells");
		expect(markdown).toContain('ask the user for a text export such as CSV');
	});

	it('points at the sandbox for the formats read cannot handle, when there is one', () => {
		const markdown = renderToMarkdown(SystemPrompt({ toolNames: ['write', 'execute_sandboxed_code'] }));
		expect(markdown).toContain('**storage_files**');
		expect(markdown).not.toContain('ask the user for a text export such as CSV');
	});

	it('says how to keep a binary file only when a sandbox can produce one', () => {
		expect(renderToMarkdown(SystemPrompt({ toolNames: ['write', 'execute_sandboxed_code'] }))).toContain(
			'**save_files**',
		);
		expect(renderToMarkdown(SystemPrompt({ toolNames: ['write'] }))).not.toContain('**save_files**');
	});
});

describe('SystemPrompt configured database ids', () => {
	it('renders every configured database when several are configured', () => {
		const markdown = renderToMarkdown(
			SystemPrompt({
				configuredDatabases: [
					{
						id: 'duckdb-jaffle-shop',
						type: 'duckdb',
						database: 'jaffle_shop',
					},
					{
						id: 'bigquery-prod',
						type: 'bigquery',
						project_id: 'nao-corp',
						dataset_id: 'nao-corp.movies_silver',
					},
				],
			}),
		);

		expect(markdown).toContain(
			[
				'## Databases',
				'',
				"execute_sql's **database_id** must be one of:",
				'',
				'- **duckdb-jaffle-shop** — type=duckdb, database=jaffle_shop',
				'- **bigquery-prod** — type=bigquery, project_id=nao-corp, dataset_id=nao-corp.movies_silver',
			].join('\n'),
		);
	});

	it('renders no configured database block for zero or one database', () => {
		const withoutDatabases = renderToMarkdown(SystemPrompt({ configuredDatabases: [] }));
		const withOneDatabase = renderToMarkdown(
			SystemPrompt({
				configuredDatabases: [{ id: 'duckdb-jaffle-shop', type: 'duckdb', database: 'jaffle_shop' }],
			}),
		);

		expect(withoutDatabases).not.toContain('## Databases');
		expect(withOneDatabase).not.toContain('## Databases');
		expect(withOneDatabase).not.toContain('duckdb-jaffle-shop');
	});
});

describe('SystemPrompt local database rules', () => {
	it('names the reserved database id and what it is for', () => {
		const markdown = renderToMarkdown(SystemPrompt({}));

		expect(markdown).toContain('The local database');
		expect(markdown).toContain(`**${LOCAL_DATABASE_ID}**`);
		expect(markdown).toContain('read_xlsx');
		expect(markdown).toContain('SELECT * FROM query_ab12cd34');
	});

	it('offers save_to only when there is somewhere to save to', () => {
		const withStorage = renderToMarkdown(SystemPrompt({ toolNames: ['execute_sql', 'write'] }));
		const withoutStorage = renderToMarkdown(SystemPrompt({ toolNames: ['execute_sql'] }));

		expect(withStorage).toContain('**save_to**');
		expect(withStorage).toContain('format: "parquet"');
		expect(withStorage).toContain('**saved-file** chip');
		expect(withoutStorage).not.toContain('**save_to**');
	});

	it('still tells the model the query itself cannot write a file', () => {
		expect(renderToMarkdown(SystemPrompt({}))).toContain('**COPY … TO**');
	});

	it('says a workbook needs its sheet named, and where to get the name', () => {
		const markdown = renderToMarkdown(SystemPrompt({}));

		expect(markdown).toContain("**sheet = 'Name'**");
		expect(markdown).toContain('**read** on the file lists the names to pass');
	});

	it('omits it when the run cannot run SQL at all', () => {
		const markdown = renderToMarkdown(SystemPrompt({ toolNames: ['write'] }));

		expect(markdown).not.toContain('The local database');
	});
});

describe('SystemPrompt built-in skills', () => {
	const internalSkills = [
		{ name: 'pdf-handling', description: 'How to get data out of a PDF.', body: () => 'body' },
		{ name: 'other-thing', description: 'Something else entirely.', body: () => 'body' },
	];

	it('lists each built-in skill by name and description', () => {
		const markdown = renderToMarkdown(SystemPrompt({ internalSkills }));

		expect(markdown).toContain('Built-in Skills');
		expect(markdown).toContain('**pdf-handling** — How to get data out of a PDF.');
		expect(markdown).toContain('**other-thing** — Something else entirely.');
	});

	it('never carries a skill body, which is the point of loading them on demand', () => {
		const body = 'the full text of the skill';
		const markdown = renderToMarkdown(
			SystemPrompt({ internalSkills: [{ name: 'a-skill', description: 'A skill.', body: () => body }] }),
		);

		expect(markdown).not.toContain(body);
		expect(markdown).toContain('**load_skill**');
	});

	it('tells the agent to keep them to itself', () => {
		const markdown = renderToMarkdown(SystemPrompt({ internalSkills }));
		expect(markdown).toContain('never mention a skill');
	});

	it('omits the section when the run has no load_skill tool', () => {
		const markdown = renderToMarkdown(SystemPrompt({ internalSkills, toolNames: ['read'] }));
		expect(markdown).not.toContain('Built-in Skills');
	});

	it('omits the section when nao ships no built-in skills', () => {
		const markdown = renderToMarkdown(SystemPrompt({ internalSkills: [] }));
		expect(markdown).not.toContain('Built-in Skills');
	});

	it('lists the real skills by default, so a new one needs no wiring', () => {
		const markdown = renderToMarkdown(SystemPrompt({}));
		expect(markdown).toContain('**pdf-handling**');
	});
});

describe('SystemPrompt SQL query rules', () => {
	it('forbids citing table documentation statistics as answers to data questions', () => {
		const markdown = renderToMarkdown(SystemPrompt({}));

		expect(markdown).toContain('never present them as the answer to a data question');
		expect(markdown).toContain(
			'must come from a query executed in this conversation, or be computed from such results',
		);
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
