// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DatabaseIcon } from './database-icon';

const providers = [
	'athena',
	'bigquery',
	'clickhouse',
	'databricks',
	'fabric',
	'motherduck',
	'mssql',
	'mysql',
	'postgres',
	'redshift',
	'snowflake',
	'starrocks',
	'trino',
];

describe('DatabaseIcon', () => {
	it('has a warehouse icon for every credentials provider', () => {
		const { container } = render(
			<>
				{providers.map((provider) => (
					<DatabaseIcon key={provider} dialect={provider} />
				))}
			</>,
		);

		expect(container.querySelector('.lucide-database')).toBeNull();
	});
});
