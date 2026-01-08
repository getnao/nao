import { z } from 'zod';

// Input Schemas

const ReadFileInputSchema = z.object({
	file_path: z.string(),
});

const SearchFilesInputSchema = z.object({
	file_pattern: z.string(),
});

const PathInputSchema = z.object({
	path: z.string(),
});

const GrepCodebaseInputSchema = z.object({
	pattern: z.string(),
	include: z.array(z.string()),
	exclude: z.array(z.string()),
	case_sensitive: z.boolean(),
});

const ExecuteSqlInputSchema = z.object({
	sql_query: z.string(),
	connection_type: z
		.enum(['bigquery', 'snowflake', 'postgres', 'redshift', 'databricks', 'duckdb', 'athena', 'clickhouse'])
		.optional(),
});

// Output Schemas

const ReadFileOutputSchema = z.object({
	content: z.string(),
	numberOfTotalLines: z.number(),
});

const SearchFilesOutputSchema = z.array(
	z.object({
		absoluteFilePath: z.string(),
		relativeFilePath: z.string(),
		relativeDirPath: z.string(),
		size: z.string().optional(),
	}),
);

const ListDirectoryOutputSchema = z.array(
	z.object({
		path: z.string(),
		name: z.string(),
		type: z.enum(['file', 'directory', 'symbolic_link']).or(z.undefined()),
		size: z.string().or(z.undefined()),
	}),
);

const GrepCodebaseOutputSchema = z.array(
	z.object({
		line: z.number(),
		text: z.string(),
		matchCount: z.number(),
		absolutePath: z.string(),
		relativePath: z.string(),
	}),
);

const ExecuteSqlOutputSchema = z.object({
	columns: z.array(z.string()),
	rows: z.array(z.any()).optional(),
});

/**
 * Defines the built-in tools that are available to the agent.
 */
export type ToolTypes = {
	read_file: {
		in: z.infer<typeof ReadFileInputSchema>;
		out: z.infer<typeof ReadFileOutputSchema>;
	};

	search_files: {
		in: z.infer<typeof SearchFilesInputSchema>;
		out: z.infer<typeof SearchFilesOutputSchema>;
	};

	list_directory: {
		in: z.infer<typeof PathInputSchema>;
		out: z.infer<typeof ListDirectoryOutputSchema>;
	};

	grep_codebase: {
		in: z.infer<typeof GrepCodebaseInputSchema>;
		out: z.infer<typeof GrepCodebaseOutputSchema>;
	};

	execute_sql: {
		in: z.infer<typeof ExecuteSqlInputSchema>;
		out: z.infer<typeof ExecuteSqlOutputSchema>;
	};
};

export type ToolName = keyof ToolTypes;

export const ToolZodSchemas: {
	[key in ToolName]: {
		in: z.ZodSchema<ToolTypes[key]['in']>;
		out: z.ZodSchema<ToolTypes[key]['out']>;
	};
} = {
	read_file: { in: ReadFileInputSchema, out: ReadFileOutputSchema },
	search_files: { in: SearchFilesInputSchema, out: SearchFilesOutputSchema },
	list_directory: { in: PathInputSchema, out: ListDirectoryOutputSchema },
	grep_codebase: { in: GrepCodebaseInputSchema, out: GrepCodebaseOutputSchema },
	execute_sql: { in: ExecuteSqlInputSchema, out: ExecuteSqlOutputSchema },
};
