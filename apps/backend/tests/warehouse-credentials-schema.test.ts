import { requestWarehouseCredentials } from '@nao/shared/tools';
import { describe, expect, it } from 'vitest';

import {
	warehouseContextSourcesInputSchema,
	warehouseCredentialsSchema,
	warehouseProvisioningInputSchema,
} from '../src/types/warehouse';

describe('warehouse credentials schema', () => {
	it.each([...requestWarehouseCredentials.PROVIDERS])('accepts the %s credentials envelope', (provider) => {
		expect(
			warehouseCredentialsSchema.parse({
				provider,
				credentials: {},
			}),
		).toEqual({
			provider,
			credentials: {},
		});
	});

	it('requires a supported provider and credentials object', () => {
		expect(
			warehouseCredentialsSchema.safeParse({
				provider: 'unsupported',
				credentials: {},
			}).success,
		).toBe(false);

		expect(
			warehouseCredentialsSchema.safeParse({
				provider: 'postgres',
			}).success,
		).toBe(false);
	});

	it('derives the connection name instead of accepting one from the user', () => {
		expect(
			warehouseProvisioningInputSchema.safeParse({
				provider: 'postgres',
				credentials: {},
				onboardingChatId: '0f8fad5b-d9cb-469f-a165-70867728950e',
			}).success,
		).toBe(true);
	});

	it('accepts selected schemas or tables and rejects an empty selection', () => {
		expect(
			warehouseProvisioningInputSchema.parse({
				provider: 'postgres',
				credentials: {},
				onboardingChatId: '0f8fad5b-d9cb-469f-a165-70867728950e',
				tableSelection: {
					mode: 'selected',
					tables: [{ schema: 'public', table: 'orders' }],
				},
			}).tableSelection,
		).toEqual({
			mode: 'selected',
			tables: [{ schema: 'public', table: 'orders' }],
		});
		expect(
			warehouseProvisioningInputSchema.parse({
				provider: 'postgres',
				credentials: {},
				onboardingChatId: '0f8fad5b-d9cb-469f-a165-70867728950e',
				tableSelection: {
					mode: 'selected',
					schemas: ['analytics'],
					tables: [],
				},
			}).tableSelection,
		).toEqual({
			mode: 'selected',
			schemas: ['analytics'],
			tables: [],
		});

		expect(
			warehouseProvisioningInputSchema.safeParse({
				provider: 'postgres',
				credentials: {},
				onboardingChatId: '0f8fad5b-d9cb-469f-a165-70867728950e',
				tableSelection: { mode: 'selected', schemas: [], tables: [] },
			}).success,
		).toBe(false);
	});

	it('accepts optional documentation context and rejects missing pages', () => {
		expect(
			warehouseContextSourcesInputSchema.parse({
				jobId: '11111111-1111-4111-8111-111111111111',
			}),
		).toEqual({
			jobId: '11111111-1111-4111-8111-111111111111',
			businessContext: {},
			contextSources: {},
		});

		expect(
			warehouseContextSourcesInputSchema.parse({
				jobId: '11111111-1111-4111-8111-111111111111',
				contextSources: {
					notion: {
						apiKey: '  secret  ',
						pages: ['https://notion.so/page'],
					},
					confluence: {
						baseUrl: 'https://acme.atlassian.net/wiki',
						email: 'person@acme.com',
						apiToken: 'secret',
						pages: ['123'],
					},
					github: {
						repoFullName: 'acme/analytics',
						branch: 'main',
					},
				},
			}).contextSources,
		).toEqual({
			notion: {
				apiKey: 'secret',
				pages: ['https://notion.so/page'],
			},
			confluence: {
				baseUrl: 'https://acme.atlassian.net/wiki',
				email: 'person@acme.com',
				apiToken: 'secret',
				pages: ['123'],
			},
			github: {
				repoFullName: 'acme/analytics',
				branch: 'main',
			},
		});

		expect(
			warehouseContextSourcesInputSchema.safeParse({
				jobId: '11111111-1111-4111-8111-111111111111',
				contextSources: {
					notion: {
						apiKey: 'secret',
						pages: [],
					},
				},
			}).success,
		).toBe(false);

		expect(
			warehouseContextSourcesInputSchema.safeParse({
				jobId: '11111111-1111-4111-8111-111111111111',
				contextSources: {
					github: {
						repoFullName: 'https://github.com/acme/analytics',
						branch: 'main',
					},
				},
			}).success,
		).toBe(false);
	});
});
