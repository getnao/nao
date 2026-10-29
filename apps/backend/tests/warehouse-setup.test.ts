import { describe, expect, it } from 'vitest';

import { createWarehouseLogRedactor } from '../src/utils/warehouse-setup';

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

	it('withholds the start of a secret that the next chunk could complete', () => {
		expect(redactor.withholdPartialSecret('Connecting with super-sec')).toBe('Connecting with ');
	});

	it('keeps output that does not end with the start of a secret', () => {
		expect(redactor.withholdPartialSecret('Connecting with [REDACTED:POSTGRES_PASSWORD]')).toBe(
			'Connecting with [REDACTED:POSTGRES_PASSWORD]',
		);
	});
});
