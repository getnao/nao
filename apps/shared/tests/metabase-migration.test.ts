import { describe, expect, it } from 'vitest';

import {
	METABASE_MIGRATION_SCHEMA_VERSION,
	MetabaseDashboardSchema,
	MetabaseExecutableQuerySchema,
	MigrationReportSchema,
} from '../src/metabase-migration';

const report = {
	schemaVersion: METABASE_MIGRATION_SCHEMA_VERSION,
	status: 'partial' as const,
	sourceDashboard: {
		id: 2,
		name: 'Native SQL Basics',
		collectionId: 1,
	},
	target: {
		storyId: 'native-sql-basics',
		storyTitle: 'Native SQL Basics',
		folderId: null,
		url: null,
	},
	importedItems: [],
	reusableObjectMappings: [],
	skippedItems: [],
	approximations: [],
	verificationResults: [],
	warnings: [],
};

describe('Metabase migration contracts', () => {
	it('keeps dashboard filter definitions and per-card mappings structured', () => {
		const result = MetabaseDashboardSchema.safeParse({
			id: 2,
			name: 'Native SQL Basics',
			description: null,
			collectionId: 1,
			tabs: [],
			parameters: [
				{
					id: 'category',
					name: 'Category',
					type: 'string/=',
					defaultValue: ['Electronics'],
					required: false,
				},
			],
			cards: [
				{
					id: 11,
					cardId: 7,
					tabId: null,
					title: 'Revenue',
					description: null,
					row: 0,
					column: 0,
					width: 6,
					height: 4,
					parameterMappings: [
						{
							dashboardParameterId: 'category',
							targetCardId: 7,
							target: ['variable', ['template-tag', 'category']],
							parameterType: 'string/=',
							defaultValue: ['Electronics'],
							required: false,
						},
					],
					visualizationSettings: {},
					card: null,
				},
			],
		});

		expect(result.success).toBe(true);
	});

	it('requires executable SQL for both native and compiled MBQL queries', () => {
		expect(
			MetabaseExecutableQuerySchema.safeParse({
				sourceType: 'native',
				databaseId: 2,
				templateParameters: {},
				resultMetadata: [],
			}).success,
		).toBe(false);
		expect(
			MetabaseExecutableQuerySchema.safeParse({
				sourceType: 'mbql',
				databaseId: 2,
				compiledSql: 'SELECT status, COUNT(*) FROM orders GROUP BY status',
				templateParameters: {},
				resultMetadata: [],
			}).success,
		).toBe(false);
		expect(
			MetabaseExecutableQuerySchema.safeParse({
				sourceType: 'mbql',
				databaseId: 2,
				compiledSql: 'SELECT status, COUNT(*) FROM orders GROUP BY status',
				originalMbql: {
					'source-table': 3,
					aggregation: [['count']],
				},
				templateParameters: {},
				resultMetadata: [],
			}).success,
		).toBe(true);
	});

	it('keeps complete, partial, and failed report states consistent with their contents', () => {
		expect(MigrationReportSchema.safeParse(report).success).toBe(true);
		expect(
			MigrationReportSchema.safeParse({
				...report,
				importedItems: [
					{
						sourceCardId: 8,
						sourceCardName: 'Orders by status',
						targetQueryId: 'query_orders',
						targetVisualizationType: 'bar',
						originalMbql: {
							'source-table': 3,
							aggregation: [['count']],
						},
					},
				],
			}).success,
		).toBe(true);
		expect(
			MigrationReportSchema.safeParse({
				...report,
				reusableObjectMappings: [
					{
						sourceType: 'metric',
						sourceId: 51,
						sourceName: 'Completed order count metric',
						mode: 'review_required',
						targetName: null,
						sourceDefinition: { aggregation: [['count']] },
						reason: 'No exact nao semantic metric exists.',
					},
				],
			}).success,
		).toBe(true);
		expect(
			MigrationReportSchema.safeParse({
				...report,
				reusableObjectMappings: [
					{
						sourceType: 'metric',
						sourceId: 51,
						sourceName: 'Completed order count metric',
						mode: 'reused',
						targetName: 'completed_order_count',
						reason: null,
					},
				],
			}).success,
		).toBe(false);
		expect(
			MigrationReportSchema.safeParse({
				...report,
				status: 'complete',
				skippedItems: [{ sourceId: 7, sourceType: 'card', name: 'Funnel', reason: 'Unsupported' }],
			}).success,
		).toBe(false);
		expect(
			MigrationReportSchema.safeParse({
				...report,
				status: 'failed',
			}).success,
		).toBe(false);
	});
});
