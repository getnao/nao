import { Block, Br, Code, List, ListItem, Title } from '../../lib/markdown';
import type { ContextPresence } from '../../utils/nao-config';

/** Explains how the nao project context is laid out on disk. Shared by every system prompt. */
export function NaoContextStructure({
	templates,
	repoNames = [],
	contextPresence,
}: {
	templates?: string[];
	repoNames?: string[];
	contextPresence?: ContextPresence;
}) {
	const visibleTemplates =
		templates && templates.length > 0
			? TEMPLATE_DESCRIPTIONS.filter(({ name }) => templates.includes(name))
			: TEMPLATE_DESCRIPTIONS;
	const visibleTemplateNames = new Set(visibleTemplates.map(({ name }) => name));
	const repoPaths = repoNames.map((name) => `repos/${name}/`).join(', ');
	const isPresent = (context: keyof ContextPresence) => contextPresence?.[context] !== false;

	return (
		<Block>
			<Title level={2}>How nao Works</Title>
			<List>
				{[
					isPresent('rules') && (
						<ListItem key='rules'>
							<Code>RULES.md</Code> — project-wide rules; read it for project conventions.
						</ListItem>
					),
					isPresent('semantics') && (
						<ListItem key='semantics'>
							<Code>semantics/</Code> — metric and business definitions; read them before calculating or
							interpreting a named metric.
						</ListItem>
					),
					isPresent('docs') && (
						<ListItem key='docs'>
							<Code>docs/</Code> — business documentation; read the relevant files before answering domain
							questions.
							{isPresent('notionDocs') && (
								<>
									{' '}
									<Code>docs/notion/</Code> contains Notion content.
								</>
							)}
						</ListItem>
					),
					repoNames.length > 0 && (
						<ListItem key='repos'>
							<Code>{repoPaths}</Code> — source repositories; read relevant dbt, SQL, application, or
							documentation files to understand how data is produced.
						</ListItem>
					),
					isPresent('databases') && (
						<ListItem key='databases'>
							<Code>databases/</Code> — warehouse context under{' '}
							<Code>
								type={'<database_type>'}/database={'<database_name>'}/schema={'<schema_name>'}/table=
								{'<table_name>'}/
							</Code>
							. Inside each table folder:
							<Br />
							<List indent={1}>
								{[
									<ListItem key='annotations'>
										<Code>annotations.md</Code> — human-written notes about this table; often empty,
										but when it has content it is authoritative — prefer it over the generated files
										if they disagree.
									</ListItem>,
									...visibleTemplates.map(({ name, description }) => (
										<ListItem key={name}>
											<Code>{name}.md</Code> —{' '}
											{typeof description === 'function'
												? description(visibleTemplateNames)
												: description}
										</ListItem>
									)),
								]}
							</List>
						</ListItem>
					),
				]}
			</List>
		</Block>
	);
}

function AiSummaryDescription({ visibleTemplateNames }: { visibleTemplateNames: ReadonlySet<string> }) {
	const referencedTemplates = AI_SUMMARY_REFERENCE_TEMPLATES.filter((name) => visibleTemplateNames.has(name));

	return (
		<>
			an LLM-written overview of the table, data-quality caveats, and suggested uses; use for orientation, but do
			not treat it as ground truth
			{referencedTemplates.length > 0 && (
				<>
					{' '}
					— verify specifics against{' '}
					{referencedTemplates.map((name, index) => (
						<>
							{index > 0 && ' and '}
							<Code>{name}.md</Code>
						</>
					))}
				</>
			)}
			.
		</>
	);
}

const AI_SUMMARY_REFERENCE_TEMPLATES = ['columns', 'profiling'] as const;

const TEMPLATE_DESCRIPTIONS = [
	{
		name: 'columns',
		description:
			'table description, row count, columns with types and descriptions, plus available partitioning, clustering, or index details; read before writing SQL and never guess column names.',
	},
	{
		name: 'preview',
		description:
			'a handful of sample rows showing value formats; this is a tiny, non-representative sample, so never infer null rates, volumes, or value distributions from it.',
	},
	{
		name: 'profiling',
		description:
			'per-column statistics as JSONL, including null and distinct counts, min/max, and top values; read before filtering on a column value or making a data-quality claim.',
	},
	{
		name: 'query_history',
		description:
			'real table usage: query count, common joins, and top queries as SQL; read to find established join keys and query patterns.',
	},
	{
		name: 'ai_summary',
		description: (visibleTemplateNames: ReadonlySet<string>) => (
			<AiSummaryDescription visibleTemplateNames={visibleTemplateNames} />
		),
	},
] as const;
