import { describe, expect, it } from 'vitest';

import {
	extractSqlFilterIds,
	findUnreferencedStoryFilters,
	renderFilterSqlValue,
	renderSqlTemplate,
	stripSqlFilterBlocks,
	validateSqlFilterTemplate,
} from '../src/sql-template';

const SAMPLE_SQL = `
SELECT SUM(revenue) AS revenue, country
FROM orders
WHERE 1 = 1
{% filter country %} AND country IN ({{ filters.country.sql }}) {% endfilter %}
{% filter q %} AND customer_name ILIKE {{ filters.q.sql }} {% endfilter %}
{% filter period %} AND order_date BETWEEN {{ filters.period.sql }} {% endfilter %}
GROUP BY country
`.trim();

describe('stripSqlFilterBlocks', () => {
	it('removes all filter blocks so SQL runs without story filters', () => {
		expect(stripSqlFilterBlocks(SAMPLE_SQL)).toBe(
			`
SELECT SUM(revenue) AS revenue, country
FROM orders
WHERE 1 = 1



GROUP BY country
`.trim(),
		);
	});

	it('preserves untouched whitespace and strips malformed blocks safely', () => {
		const sql = "SELECT 'line 1\n\nline 2  '\n{% endfilter %}\n{% filter country %} AND country = 'US'";
		expect(stripSqlFilterBlocks(sql)).toBe("SELECT 'line 1\n\nline 2  '\n\n");
	});
});

describe('extractSqlFilterIds', () => {
	it('returns unique filter ids in order of appearance', () => {
		expect(extractSqlFilterIds(SAMPLE_SQL)).toEqual(['country', 'q', 'period']);
	});
});

describe('renderFilterSqlValue', () => {
	it('renders select / multi_select / search / date_range fragments', () => {
		expect(renderFilterSqlValue('select', 'US')).toBe("'US'");
		expect(renderFilterSqlValue('multi_select', ['US', "O'Reilly"])).toBe("'US', 'O''Reilly'");
		expect(renderFilterSqlValue('search', 'acme%')).toBe("'%acme\\%%'");
		expect(renderFilterSqlValue('date_range', ['2024-01-01', '2024-12-31'])).toBe("'2024-01-01' AND '2024-12-31'");
	});

	it('returns null for inactive selections', () => {
		expect(renderFilterSqlValue('select', '')).toBeNull();
		expect(renderFilterSqlValue('multi_select', [])).toBeNull();
		expect(renderFilterSqlValue('date_range', ['2024-01-01', ''])).toBeNull();
	});

	it('omits whitespace-only multi-select values', () => {
		expect(renderFilterSqlValue('multi_select', ['US', '  '])).toBe("'US'");
	});
});

describe('renderSqlTemplate', () => {
	const types = {
		country: 'multi_select',
		q: 'search',
		period: 'date_range',
	} as const;

	it('keeps only active filter blocks and interpolates .sql placeholders', () => {
		const rendered = renderSqlTemplate(
			SAMPLE_SQL,
			{
				country: ['US', 'FR'],
				q: 'acme',
			},
			types,
		);

		expect(rendered).toContain("AND country IN ('US', 'FR')");
		expect(rendered).toContain("AND customer_name ILIKE '%acme%'");
		expect(rendered).not.toContain('order_date BETWEEN');
		expect(rendered).not.toContain('{% filter');
		expect(rendered).not.toContain('{{ filters');
	});

	it('strips all blocks when no selections are active', () => {
		expect(renderSqlTemplate(SAMPLE_SQL, {}, types)).toBe(stripSqlFilterBlocks(SAMPLE_SQL));
	});

	it('rejects unknown filter ids and misplaced placeholders', () => {
		expect(() => renderSqlTemplate(SAMPLE_SQL, { country: ['US'] }, {})).toThrow(/undeclared filter/);
		expect(() =>
			renderSqlTemplate('SELECT 1 WHERE x = {{ filters.country.sql }}', { country: 'US' }, { country: 'select' }),
		).toThrow(/must appear inside/);
		expect(() =>
			renderSqlTemplate(
				'{% filter country %} AND country = {{ filters.country.sql.extra }} {% endfilter %}',
				{ country: 'US' },
				{ country: 'select' },
			),
		).toThrow(/Only \{\{ filters\.country\.sql \}\} is supported/);
	});
});

describe('validateSqlFilterTemplate', () => {
	it('accepts correct templates', () => {
		expect(validateSqlFilterTemplate(SAMPLE_SQL)).toEqual([]);
		expect(validateSqlFilterTemplate(SAMPLE_SQL, { knownFilterIds: ['country', 'q', 'period'] })).toEqual([]);
	});

	it('flags date_range start/end/value placeholders', () => {
		const sql = `
SELECT 1 FROM orders WHERE 1 = 1
{% filter period %} AND order_date BETWEEN {{ filters.period.start }} AND {{ filters.period.end }} {% endfilter %}
`.trim();
		const issues = validateSqlFilterTemplate(sql);
		expect(issues.some((issue) => /filters\.period\.start/.test(issue))).toBe(true);
		expect(issues.some((issue) => /BETWEEN \{\{ filters\.period\.sql \}\}/.test(issue))).toBe(true);
	});

	it('flags placeholders outside filter blocks', () => {
		const issues = validateSqlFilterTemplate('SELECT 1 WHERE country = {{ filters.country.sql }}');
		expect(issues.some((issue) => /must appear inside/.test(issue))).toBe(true);
	});

	it('flags undeclared filter ids when known filters are provided', () => {
		const sql = '{% filter country %} AND country = {{ filters.country.sql }} {% endfilter %}';
		const issues = validateSqlFilterTemplate(sql, { knownFilterIds: ['period'] });
		expect(issues.some((issue) => /undeclared filter "country"/.test(issue))).toBe(true);
	});

	it('flags filter blocks missing .sql placeholders', () => {
		const sql = "{% filter country %} AND country = 'US' {% endfilter %}";
		const issues = validateSqlFilterTemplate(sql);
		expect(issues.some((issue) => /missing \{\{ filters\.country\.sql \}\}/.test(issue))).toBe(true);
	});

	it('flags malformed placeholders and misordered delimiters', () => {
		const placeholderIssues = validateSqlFilterTemplate('SELECT 1 WHERE country = {{ filters.country.sql.extra }}');
		expect(placeholderIssues.some((issue) => /Only \{\{ filters\.country\.sql \}\} is supported/.test(issue))).toBe(
			true,
		);

		const delimiterIssues = validateSqlFilterTemplate(
			'{% endfilter %} SELECT 1 {% filter country %} AND country = {{ filters.country.sql }}',
		);
		expect(delimiterIssues.some((issue) => /Unexpected "\{% endfilter %\}"/.test(issue))).toBe(true);
	});

	it('flags placeholders with a trailing dot and no property', () => {
		const issues = validateSqlFilterTemplate('SELECT 1 WHERE country = {{ filters.country. }}');
		expect(issues.some((issue) => /property "\.sql" is required/.test(issue))).toBe(true);
	});
});

describe('findUnreferencedStoryFilters', () => {
	it('returns declared filters unused by any SQL template', () => {
		expect(
			findUnreferencedStoryFilters(
				['country', 'period'],
				['{% filter country %} AND country = {{ filters.country.sql }} {% endfilter %}'],
			),
		).toEqual(['period']);
	});
});
