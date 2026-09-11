import { z } from 'zod/v4';

export const METABASE_MIGRATION_SCHEMA_VERSION = 1 as const;

const NullableStringSchema = z.string().nullable();
const MetabaseNumericIdSchema = z.number().int().positive();
const UnknownRecordSchema = z.record(z.string(), z.unknown());

export const MetabaseCollectionSchema = z.object({
	id: MetabaseNumericIdSchema,
	name: z.string().min(1),
	description: NullableStringSchema,
	parentId: MetabaseNumericIdSchema.nullable(),
	archived: z.boolean(),
});

export type MetabaseCollection = z.infer<typeof MetabaseCollectionSchema>;

export const MetabaseDashboardTabSchema = z.object({
	id: MetabaseNumericIdSchema,
	name: z.string().min(1),
	position: z.number().int().nonnegative(),
});

export type MetabaseDashboardTab = z.infer<typeof MetabaseDashboardTabSchema>;

export const MetabaseDashboardSummarySchema = z.object({
	id: MetabaseNumericIdSchema,
	name: z.string().min(1),
	description: NullableStringSchema,
	collectionId: MetabaseNumericIdSchema.nullable(),
	archived: z.boolean(),
});

export type MetabaseDashboardSummary = z.infer<typeof MetabaseDashboardSummarySchema>;

export const MetabaseDashboardParameterSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	type: z.string().min(1),
	defaultValue: z.unknown().optional(),
	required: z.boolean(),
});

export type MetabaseDashboardParameter = z.infer<typeof MetabaseDashboardParameterSchema>;

export const MetabaseParameterMappingSchema = z.object({
	dashboardParameterId: z.string().min(1),
	targetCardId: MetabaseNumericIdSchema,
	target: z.unknown(),
	parameterType: z.string().nullable(),
	defaultValue: z.unknown().optional(),
	required: z.boolean(),
});

export type MetabaseParameterMapping = z.infer<typeof MetabaseParameterMappingSchema>;

export const MetabaseDatasetQuerySchema = z
	.object({
		type: z.enum(['native', 'query']),
		database: MetabaseNumericIdSchema,
		native: z
			.object({
				query: z.string(),
				'template-tags': UnknownRecordSchema.optional(),
			})
			.passthrough()
			.optional(),
		query: z.unknown().optional(),
	})
	.passthrough();

export type MetabaseDatasetQuery = z.infer<typeof MetabaseDatasetQuerySchema>;

export const MetabaseReferencedObjectSchema = z.object({
	type: z.enum(['card', 'metric', 'segment']),
	id: MetabaseNumericIdSchema,
});

export type MetabaseReferencedObject = z.infer<typeof MetabaseReferencedObjectSchema>;

export const MetabaseCardSchema = z.object({
	id: MetabaseNumericIdSchema,
	name: z.string().min(1),
	description: NullableStringSchema,
	databaseId: MetabaseNumericIdSchema,
	type: z.enum(['question', 'model', 'metric']),
	display: z.string().min(1),
	datasetQuery: MetabaseDatasetQuerySchema,
	visualizationSettings: UnknownRecordSchema,
	parameters: z.array(z.unknown()),
	resultMetadata: z.array(z.unknown()),
	referencedObjects: z.array(MetabaseReferencedObjectSchema),
	hasVisualizationAndResultMetadata: z.boolean(),
});

export type MetabaseCard = z.infer<typeof MetabaseCardSchema>;

export const MetabaseDashboardCardSchema = z.object({
	id: MetabaseNumericIdSchema,
	cardId: MetabaseNumericIdSchema.nullable(),
	tabId: MetabaseNumericIdSchema.nullable(),
	title: NullableStringSchema,
	description: NullableStringSchema,
	row: z.number().int().nonnegative(),
	column: z.number().int().nonnegative(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	parameterMappings: z.array(MetabaseParameterMappingSchema),
	visualizationSettings: UnknownRecordSchema,
	card: MetabaseCardSchema.nullable(),
});

export type MetabaseDashboardCard = z.infer<typeof MetabaseDashboardCardSchema>;

export const MetabaseDashboardSchema = z.object({
	id: MetabaseNumericIdSchema,
	name: z.string().min(1),
	description: NullableStringSchema,
	collectionId: MetabaseNumericIdSchema.nullable(),
	tabs: z.array(MetabaseDashboardTabSchema),
	cards: z.array(MetabaseDashboardCardSchema),
	parameters: z.array(MetabaseDashboardParameterSchema),
});

export type MetabaseDashboard = z.infer<typeof MetabaseDashboardSchema>;

export const MetabaseExecutionParametersSchema = z.array(
	z.looseObject({
		id: z.string().min(1),
		type: z.string().nullable().optional(),
		value: z.unknown().optional(),
		target: z.unknown().nullable().optional(),
	}),
);

export type MetabaseExecutionParameters = z.infer<typeof MetabaseExecutionParametersSchema>;

export const MetabaseExecutableQuerySchema = z.discriminatedUnion('sourceType', [
	z.object({
		sourceType: z.literal('native'),
		databaseId: MetabaseNumericIdSchema,
		nativeSql: z.string().min(1),
		boundParameters: z.array(z.unknown()),
		templateParameters: UnknownRecordSchema,
		resultMetadata: z.array(z.unknown()),
	}),
	z.object({
		sourceType: z.literal('mbql'),
		databaseId: MetabaseNumericIdSchema,
		compiledSql: z.string().min(1),
		originalMbql: UnknownRecordSchema,
		templateParameters: UnknownRecordSchema,
		resultMetadata: z.array(z.unknown()),
	}),
]);

export type MetabaseExecutableQuery = z.infer<typeof MetabaseExecutableQuerySchema>;

export const MetabaseCardResultSchema = z.object({
	cardId: MetabaseNumericIdSchema,
	status: z.string().min(1),
	columns: z.array(z.string()),
	rows: z.array(z.array(z.unknown())),
	metadata: z.array(z.unknown()),
});

export type MetabaseCardResult = z.infer<typeof MetabaseCardResultSchema>;

export const DatabaseMappingSchema = z.object({
	metabaseDatabaseId: MetabaseNumericIdSchema,
	metabaseDatabaseName: z.string().min(1),
	naoDatabaseId: z.string().min(1),
});

export type DatabaseMapping = z.infer<typeof DatabaseMappingSchema>;

export const MigrationSkippedItemSchema = z.object({
	sourceId: z.union([MetabaseNumericIdSchema, z.string().min(1)]),
	sourceType: z.string().min(1),
	name: z.string().nullable(),
	reason: z.string().min(1),
});

export type MigrationSkippedItem = z.infer<typeof MigrationSkippedItemSchema>;

export const MigrationPlanSchema = z.object({
	schemaVersion: z.literal(METABASE_MIGRATION_SCHEMA_VERSION),
	sourceDashboard: z.object({
		id: MetabaseNumericIdSchema,
		name: z.string().min(1),
		collectionId: MetabaseNumericIdSchema.nullable(),
	}),
	target: z.object({
		storyId: z.string().min(1).nullable(),
		storyTitle: z.string().min(1),
		folderId: z.string().min(1).nullable(),
	}),
	cards: z.array(
		z.object({
			sourceCardId: MetabaseNumericIdSchema,
			sourceCardName: z.string().min(1),
			mappingDescription: z.string().min(1),
		}),
	),
	skippedItems: z.array(MigrationSkippedItemSchema),
	requiredClarifications: z.array(z.string().min(1)),
});

export type MigrationPlan = z.infer<typeof MigrationPlanSchema>;

export const VerificationResultSchema = z.object({
	sourceCardId: MetabaseNumericIdSchema,
	targetQueryId: z.string().min(1),
	comparedColumns: z.array(z.string()),
	rowCount: z.number().int().nonnegative(),
	comparisonMode: z.enum(['ordered', 'unordered', 'scalar']),
	matched: z.boolean(),
	mismatchSummary: z.string().nullable(),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const ReusableObjectMappingSchema = z
	.object({
		sourceType: z.enum(['model', 'metric', 'segment']),
		sourceId: MetabaseNumericIdSchema,
		sourceName: NullableStringSchema,
		mode: z.enum(['reused', 'inlined', 'review_required', 'unsupported']),
		targetName: NullableStringSchema,
		sourceDefinition: z.unknown().optional(),
		reason: NullableStringSchema,
	})
	.superRefine((mapping, context) => {
		if (mapping.mode === 'reused' && mapping.sourceDefinition === undefined) {
			context.addIssue({
				code: 'custom',
				path: ['sourceDefinition'],
				message: 'A reused object requires its exact source definition.',
			});
		}
		if (mapping.mode !== 'reused' && mapping.reason === null) {
			context.addIssue({
				code: 'custom',
				path: ['reason'],
				message: 'A non-reused object requires a reason.',
			});
		}
	});

export type ReusableObjectMapping = z.infer<typeof ReusableObjectMappingSchema>;

export const MigrationReportSchema = z
	.object({
		schemaVersion: z.literal(METABASE_MIGRATION_SCHEMA_VERSION),
		status: z.enum(['complete', 'partial', 'failed']),
		sourceDashboard: z.object({
			id: MetabaseNumericIdSchema,
			name: z.string().min(1),
			collectionId: MetabaseNumericIdSchema.nullable(),
		}),
		target: z.object({
			storyId: z.string().min(1).nullable(),
			storyTitle: z.string().nullable(),
			folderId: z.string().min(1).nullable(),
			url: z.string().url().nullable(),
		}),
		importedItems: z.array(
			z.object({
				sourceCardId: MetabaseNumericIdSchema,
				sourceCardName: z.string().min(1),
				targetQueryId: z.string().min(1),
				targetVisualizationType: z.string().min(1),
				originalMbql: UnknownRecordSchema.optional(),
			}),
		),
		reusableObjectMappings: z.array(ReusableObjectMappingSchema),
		skippedItems: z.array(MigrationSkippedItemSchema),
		approximations: z.array(z.string().min(1)),
		verificationResults: z.array(VerificationResultSchema),
		warnings: z.array(z.string().min(1)),
	})
	.superRefine((report, context) => {
		const hasValidTarget = report.target.storyId !== null;
		if (report.status === 'failed' && hasValidTarget) {
			context.addIssue({
				code: 'custom',
				path: ['target', 'storyId'],
				message: 'A failed migration cannot have a created target story.',
			});
		}
		if (report.status !== 'failed' && !hasValidTarget) {
			context.addIssue({
				code: 'custom',
				path: ['target', 'storyId'],
				message: 'A complete or partial migration requires a target story.',
			});
		}
		if (
			report.status === 'complete' &&
			(report.skippedItems.length > 0 ||
				report.approximations.length > 0 ||
				report.verificationResults.some((result) => !result.matched) ||
				report.importedItems.some(
					(item) =>
						!report.verificationResults.some(
							(result) =>
								result.sourceCardId === item.sourceCardId &&
								result.targetQueryId === item.targetQueryId &&
								result.matched,
						),
				) ||
				report.reusableObjectMappings.some(
					(mapping) => mapping.mode === 'review_required' || mapping.mode === 'unsupported',
				))
		) {
			context.addIssue({
				code: 'custom',
				path: ['status'],
				message: 'A complete migration requires verified items and cannot contain unresolved mappings.',
			});
		}
	});

export type MigrationReport = z.infer<typeof MigrationReportSchema>;
