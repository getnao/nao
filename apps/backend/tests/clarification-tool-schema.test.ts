import { clarification } from '@nao/shared/tools';
import { asSchema } from 'ai';
import { describe, expect, it } from 'vitest';

describe('clarification tool schema', () => {
	it('has the top-level object type required by Anthropic', async () => {
		const schema = await asSchema(clarification.InputSchema).jsonSchema;

		expect(schema.type).toBe('object');
		expect(schema.properties?.options).toMatchObject({
			anyOf: [
				{ type: 'array', minItems: 2, maxItems: 5 },
				{
					type: 'array',
					minItems: clarification.DATABASE_WAREHOUSE_OPTIONS.length,
					maxItems: clarification.DATABASE_WAREHOUSE_OPTIONS.length,
					items: { enum: clarification.DATABASE_WAREHOUSE_OPTIONS },
				},
			],
		});
	});
});
