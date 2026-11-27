import { describe, expect, it } from 'vitest';

import { createWarehouseLogRedactor } from '../../../src/utils/onboarding/warehouse-setup';

describe('warehouse log redactor', () => {
	const redactor = createWarehouseLogRedactor({
		POSTGRES_PASSWORD: '"super-secret-value"',
		POSTGRES_HOST: 'warehouse.example.com',
	});

	it('masks complete secrets and leaves other connection details readable', () => {
		expect(redactor.redact('Connecting to warehouse.example.com with super-secret-value')).toBe(
			'Connecting to warehouse.example.com with [REDACTED:POSTGRES_PASSWORD]',
		);
	});

	it('masks Snowflake private key passphrases', () => {
		const snowflakeRedactor = createWarehouseLogRedactor({
			NAO_ONBOARDING_SNOWFLAKE_PASSPHRASE: '"key-passphrase"',
		});

		expect(snowflakeRedactor.redact('Decrypting key with key-passphrase')).toBe(
			'Decrypting key with [REDACTED:NAO_ONBOARDING_SNOWFLAKE_PASSPHRASE]',
		);
	});

	it('masks a GitHub token even when a command prints it without the repository URL', () => {
		const githubRedactor = createWarehouseLogRedactor({
			NAO_ONBOARDING_GITHUB_REPOSITORY_URL:
				'"https://x-access-token:github_pat_project-token@github.com/acme/analytics.git"',
		});

		expect(githubRedactor.redact('Using github_pat_project-token')).toBe(
			'Using [REDACTED:NAO_ONBOARDING_GITHUB_REPOSITORY_URL]',
		);
	});

	it('withholds the start of a secret that the next chunk could complete', () => {
		expect(redactor.withholdPartialSecret('Connecting with super-sec')).toBe('Connecting with ');
	});

	it('keeps output that does not end with the start of a secret', () => {
		expect(redactor.withholdPartialSecret('Connecting with [REDACTED:POSTGRES_PASSWORD]')).toBe(
			'Connecting with [REDACTED:POSTGRES_PASSWORD]',
		);
	});
});
