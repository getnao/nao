import { describe, expect, it } from 'vitest';

import {
	findUnknownSqlQueryTagVariables,
	formatSqlQueryTagComment,
	renderSqlQueryTag,
	type SqlQueryTagVariables,
} from '../src/sql-query-tag';

const VARIABLES: SqlQueryTagVariables = {
	user_id: 'user-1',
	user_email: 'ada@example.com',
	user_groups: 'finance,sales',
	project_id: 'project-1',
	chat_id: 'chat-1',
	source: 'slack',
	database_id: 'warehouse',
};

describe('renderSqlQueryTag', () => {
	it('replaces every variable, however its placeholder is spaced', () => {
		const template =
			'{{user_id}} {{ user_email }} {{  user_groups  }} {{ project_id }} {{ chat_id }} {{ source }} {{ database_id }}';

		expect(renderSqlQueryTag(template, VARIABLES)).toBe(
			'user-1 ada@example.com finance,sales project-1 chat-1 slack warehouse',
		);
	});

	it('keeps the lines of the template and the placeholders it does not know', () => {
		expect(renderSqlQueryTag('app=nao\nteam={{ team }}\n', VARIABLES)).toBe('app=nao\nteam={{ team }}');
	});

	it.each([
		{
			threat: 'closes the comment',
			value: 'finance */ DROP TABLE orders; /*',
			expected: 'finance * / DROP TABLE orders; / *',
		},
		{ threat: 'overlaps both delimiters', value: '*/*/', expected: '* / * /' },
		{ threat: 'spans several lines', value: 'finance\r\nDROP TABLE orders', expected: 'finance DROP TABLE orders' },
	])('neutralizes a value that $threat', ({ value, expected }) => {
		expect(renderSqlQueryTag('{{ user_groups }}', { ...VARIABLES, user_groups: value })).toBe(expected);
	});

	it('neutralizes the comment delimiters written in the template itself', () => {
		expect(renderSqlQueryTag('nao */ SELECT 1 /* {{ source }}', VARIABLES)).toBe('nao * / SELECT 1 / * slack');
	});
});

describe('formatSqlQueryTagComment', () => {
	it('separates the text from the delimiters so it never reads as a hint or as executable code', () => {
		expect(formatSqlQueryTagComment('!50000 DROP TABLE orders')).toBe('/* !50000 DROP TABLE orders */');
	});
});

describe('findUnknownSqlQueryTagVariables', () => {
	it('lists once each placeholder that is not a variable', () => {
		expect(findUnknownSqlQueryTagVariables('{{ user_id }} {{ team }} {{team}} {{ model }}')).toEqual([
			'team',
			'model',
		]);
	});
});
