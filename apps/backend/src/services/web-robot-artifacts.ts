import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WebRobotRecipe, WebRobotRunStats } from '@nao/shared/web-robot';

import { env } from '../env';
import { toDatasetVirtualPath } from '../utils/tools';
import { writeJsonLinesAsParquet } from './duckdb.service';
import { projectDatasetRelativePathFromKey } from './storage/keys';
import {
	deleteProjectDataset,
	findProjectDatasetFiles,
	listProjectDatasetDirectory,
	readProjectDatasetBytes,
	statProjectDataset,
	writeProjectDataset,
} from './storage/project-datasets';
import { assertPublishAllowed, diffProducts, type ProductDiff } from './web-scraper/diff';
import type { NormalizedProducts } from './web-scraper/records';
import type { WebRobotRunEvent } from './web-scraper/types';

export type PublishWebRobotRunArtifactsInput = {
	projectId: string;
	robotName: string;
	robotSlug: string;
	runId: string;
	recipe: WebRobotRecipe;
	definitionHash: string;
	normalized: NormalizedProducts;
	events: WebRobotRunEvent[];
	stats: WebRobotRunStats;
	startedAt?: Date | null;
	completedAt: Date;
};

export type WebRobotArtifactResult = {
	artifactPrefix: string;
	latestPrefix: string;
	diff: ProductDiff;
	published: boolean;
	publishError?: string;
};

const PRODUCT_COLUMNS = [
	'product_key',
	'source_url',
	'canonical_url',
	'name',
	'sku',
	'brand',
	'description',
	'price',
	'currency',
	'categories_json',
	'image_urls_json',
	'attributes_json',
	'raw_json',
	'content_hash',
	'run_id',
	'scraped_at',
];

const ATTRIBUTE_COLUMNS = ['product_key', 'name', 'value', 'unit', 'source_url', 'run_id'];
const DOCUMENT_COLUMNS = ['product_key', 'title', 'url', 'document_type', 'run_id'];
const CHANGE_COLUMNS = ['change_type', 'product_key', 'field', 'old_value', 'new_value', 'run_id'];

export const publishWebRobotRunArtifacts = async (
	input: PublishWebRobotRunArtifactsInput,
): Promise<WebRobotArtifactResult> => {
	const runPrefix = `${input.robotSlug}/versions/${input.runId}`;
	const latestPrefix = `${input.robotSlug}/latest`;
	const previousProducts = await readJsonLines(`${latestPrefix}/products.jsonl`, input.projectId);
	const diff = diffProducts(previousProducts, input.normalized.products, input.recipe);

	input.stats.productsAdded = diff.added.length;
	input.stats.productsChanged = diff.changed.length;
	input.stats.productsRemoved = diff.removed.length;
	input.stats.productsUnchanged = diff.unchanged.length;

	let published = false;
	let publishError: string | undefined;
	try {
		assertPublishAllowed(diff, input.normalized.products, input.recipe);
		published = true;
	} catch (error) {
		publishError = error instanceof Error ? error.message : String(error);
		input.stats.errors.push(publishError);
	}

	const files = await buildArtifactFiles(input, diff, published, publishError);
	await writeFiles(input.projectId, runPrefix, files);
	if (published) {
		await writeFiles(input.projectId, latestPrefix, files);
	}
	await cleanupArtifactVersions(input.projectId, input.robotSlug).catch((error) => {
		input.stats.errors.push(`Artifact cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
	});

	return {
		artifactPrefix: toDatasetVirtualPath(runPrefix),
		latestPrefix: toDatasetVirtualPath(latestPrefix),
		diff,
		published,
		publishError,
	};
};

const buildArtifactFiles = async (
	input: PublishWebRobotRunArtifactsInput,
	diff: ProductDiff,
	published: boolean,
	publishError?: string,
): Promise<Map<string, Buffer>> => {
	const files = new Map<string, Buffer>();
	const changes = diff.changes.map((change) => ({ ...change, run_id: input.runId }));
	const tables = [
		{ name: 'products', rows: input.normalized.products, columns: PRODUCT_COLUMNS },
		{ name: 'product_attributes', rows: input.normalized.attributes, columns: ATTRIBUTE_COLUMNS },
		{ name: 'product_documents', rows: input.normalized.documents, columns: DOCUMENT_COLUMNS },
		{ name: 'changes', rows: changes, columns: CHANGE_COLUMNS },
	];

	for (const table of tables) {
		files.set(`${table.name}.jsonl`, Buffer.from(toJsonLines(table.rows), 'utf-8'));
		files.set(`${table.name}.parquet`, await materializeParquet(table.rows, table.columns));
	}

	files.set('events.jsonl', Buffer.from(toJsonLines(input.events), 'utf-8'));
	files.set('pages.jsonl', Buffer.from(toJsonLines(input.events.filter((event) => event.type === 'page')), 'utf-8'));
	files.set(
		'errors.jsonl',
		Buffer.from(toJsonLines(input.events.filter((event) => event.type === 'error')), 'utf-8'),
	);
	files.set('schema.json', Buffer.from(JSON.stringify(datasetSchema(input), null, 2), 'utf-8'));
	files.set('README.md', Buffer.from(datasetReadme(input, diff, published, publishError), 'utf-8'));
	files.set(
		'manifest.json',
		Buffer.from(
			JSON.stringify(
				{
					runId: input.runId,
					robotSlug: input.robotSlug,
					definitionHash: input.definitionHash,
					published,
					publishError,
					startedAt: input.startedAt?.toISOString() ?? null,
					completedAt: input.completedAt.toISOString(),
					counts: {
						products: input.normalized.products.length,
						attributes: input.normalized.attributes.length,
						documents: input.normalized.documents.length,
						changes: changes.length,
					},
					stats: input.stats,
					paths: datasetPaths(input.robotSlug),
				},
				null,
				2,
			),
			'utf-8',
		),
	);

	return files;
};

const writeFiles = async (projectId: string, prefix: string, files: Map<string, Buffer>): Promise<void> => {
	for (const [name, data] of files) {
		await writeProjectDataset(projectId, `${prefix}/${name}`, data);
	}
};

const cleanupArtifactVersions = async (projectId: string, robotSlug: string): Promise<void> => {
	const versionsPrefix = `${robotSlug}/versions`;
	const entries = await listProjectDatasetDirectory(projectId, versionsPrefix);
	const directories = entries.filter((entry) => entry.type === 'directory');
	if (directories.length <= env.WEB_ROBOT_ARTIFACT_RETENTION_RUNS) {
		return;
	}

	const versions = await Promise.all(
		directories.map(async (entry) => ({
			path: entry.relativePath,
			completedAt: await artifactCompletedAt(projectId, `${entry.relativePath}/manifest.json`),
		})),
	);
	const stale = versions
		.sort((left, right) => right.completedAt.localeCompare(left.completedAt))
		.slice(env.WEB_ROBOT_ARTIFACT_RETENTION_RUNS)
		.map((entry) => entry.path);
	if (stale.length === 0) {
		return;
	}

	const files = await findProjectDatasetFiles(projectId, (relativePath) =>
		stale.some((directory) => relativePath.startsWith(`${directory}/`)),
	);
	for (const file of files) {
		await deleteProjectDataset(projectId, projectDatasetRelativePathFromKey(projectId, file.key));
	}
};

const artifactCompletedAt = async (projectId: string, manifestPath: string): Promise<string> => {
	try {
		const manifest = JSON.parse((await readProjectDatasetBytes(projectId, manifestPath)).toString('utf-8')) as {
			completedAt?: string;
		};
		return manifest.completedAt ?? '';
	} catch {
		return '';
	}
};

const materializeParquet = async (rows: Record<string, unknown>[], columns: string[]): Promise<Buffer> => {
	const directory = await mkdtemp(join(tmpdir(), 'nao-web-robot-'));
	const jsonlPath = join(directory, 'rows.jsonl');
	const parquetPath = join(directory, 'rows.parquet');

	try {
		await writeFile(jsonlPath, toJsonLines(rows), 'utf-8');
		await writeJsonLinesAsParquet({
			inputPath: jsonlPath,
			outputPath: parquetPath,
			columns,
			hasRows: rows.length > 0,
			allowedDirectory: directory,
		});
		return await readFile(parquetPath);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};

const readJsonLines = async (relativePath: string, projectId: string): Promise<Record<string, unknown>[]> => {
	if (!(await statProjectDataset(projectId, relativePath))) {
		return [];
	}
	const content = (await readProjectDatasetBytes(projectId, relativePath)).toString('utf-8');
	return content
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
};

const toJsonLines = (rows: unknown[]): string => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;

const datasetPaths = (slug: string) => ({
	readme: toDatasetVirtualPath(`${slug}/latest/README.md`),
	manifest: toDatasetVirtualPath(`${slug}/latest/manifest.json`),
	products: toDatasetVirtualPath(`${slug}/latest/products.parquet`),
	productAttributes: toDatasetVirtualPath(`${slug}/latest/product_attributes.parquet`),
	productDocuments: toDatasetVirtualPath(`${slug}/latest/product_documents.parquet`),
	changes: toDatasetVirtualPath(`${slug}/latest/changes.parquet`),
});

const datasetSchema = (input: PublishWebRobotRunArtifactsInput) => ({
	name: input.robotName,
	slug: input.robotSlug,
	tables: {
		products: PRODUCT_COLUMNS,
		product_attributes: ATTRIBUTE_COLUMNS,
		product_documents: DOCUMENT_COLUMNS,
		changes: CHANGE_COLUMNS,
	},
});

const datasetReadme = (
	input: PublishWebRobotRunArtifactsInput,
	diff: ProductDiff,
	published: boolean,
	publishError?: string,
): string => {
	const paths = datasetPaths(input.robotSlug);
	return `# ${input.robotName}

Generated web catalogue dataset.

- Slug: \`${input.robotSlug}\`
- Last run: \`${input.runId}\`
- Published: ${published ? 'yes' : 'no'}${publishError ? ` (${publishError})` : ''}
- Products: ${input.normalized.products.length}
- Added: ${diff.added.length}
- Changed: ${diff.changed.length}
- Removed: ${diff.removed.length}
- Completed: ${input.completedAt.toISOString()}

## Files

- \`${paths.products}\` — one row per product
- \`${paths.productAttributes}\` — normalized product attribute rows
- \`${paths.productDocuments}\` — linked product documents
- \`${paths.changes}\` — product changes detected by this run
- \`${paths.manifest}\` — run metadata and counts

## Example

\`\`\`sql
SELECT product_key, name, sku, canonical_url
FROM read_parquet('${paths.products}')
LIMIT 20;
\`\`\`
`;
};
