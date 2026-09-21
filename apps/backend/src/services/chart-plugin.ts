import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import type { ChartPluginManifestEntry } from '@nao/shared';
import { displayChart } from '@nao/shared/tools';
import { z } from 'zod';

const PLUGIN_FILE_PATTERN = /^([a-z][a-z0-9_-]*)\.(js|mjs)$/;
const MetadataSchema = z.object({
	name: z.string().trim().min(1).max(80).optional(),
	description: z.string().trim().max(500).optional(),
});

interface DiscoveredChartPlugin {
	entry: ChartPluginManifestEntry;
	source: string;
}

export function listChartPlugins(projectFolder: string): ChartPluginManifestEntry[] {
	return discoverChartPlugins(projectFolder).map((plugin) => plugin.entry);
}

export function readChartPlugin(projectFolder: string, type: string): DiscoveredChartPlugin | null {
	return discoverChartPlugins(projectFolder).find((plugin) => plugin.entry.type === type) ?? null;
}

export function hasChartPlugin(projectFolder: string, type: string): boolean {
	return readChartPlugin(projectFolder, type) !== null;
}

function discoverChartPlugins(projectFolder: string): DiscoveredChartPlugin[] {
	const chartsFolder = resolveChartsFolder(projectFolder);
	if (!chartsFolder) {
		return [];
	}

	const filesByType = new Map<string, string>();
	const duplicateTypes = new Set<string>();

	for (const entry of readdirSync(chartsFolder, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		const match = entry.isFile() ? entry.name.match(PLUGIN_FILE_PATTERN) : null;
		const type = match?.[1];
		if (!type || type === 'table' || displayChart.isBuiltinChartType(type)) {
			continue;
		}
		if (filesByType.has(type)) {
			duplicateTypes.add(type);
			continue;
		}
		filesByType.set(type, entry.name);
	}

	return [...filesByType.entries()]
		.filter(([type]) => !duplicateTypes.has(type))
		.flatMap(([type, fileName]) => {
			const source = readContainedFile(chartsFolder, join(chartsFolder, fileName));
			if (source === null) {
				return [];
			}
			const metadataSource = readContainedFile(chartsFolder, join(chartsFolder, `${type}.json`));
			const metadata = parseMetadata(metadataSource);
			const version = createHash('sha256')
				.update(source)
				.update('\0')
				.update(metadataSource ?? '')
				.digest('hex')
				.slice(0, 16);

			return [
				{
					entry: {
						type,
						name: metadata.name ?? titleize(type),
						description: metadata.description ?? '',
						version,
					},
					source,
				},
			];
		});
}

function resolveChartsFolder(projectFolder: string): string | null {
	try {
		const projectRoot = realpathSync(projectFolder);
		const candidate = join(projectRoot, 'agent', 'charts');
		if (!existsSync(candidate)) {
			return null;
		}
		const stats = lstatSync(candidate);
		if (!stats.isDirectory() || stats.isSymbolicLink()) {
			return null;
		}
		const chartsFolder = realpathSync(candidate);
		return isContainedBy(projectRoot, chartsFolder) ? chartsFolder : null;
	} catch {
		return null;
	}
}

function readContainedFile(folder: string, filePath: string): string | null {
	try {
		if (!existsSync(filePath)) {
			return null;
		}
		const stats = lstatSync(filePath);
		if (!stats.isFile() || stats.isSymbolicLink()) {
			return null;
		}
		const canonicalPath = realpathSync(filePath);
		if (!isContainedBy(folder, canonicalPath)) {
			return null;
		}
		return readFileSync(canonicalPath, 'utf8');
	} catch {
		return null;
	}
}

function isContainedBy(folder: string, target: string): boolean {
	const pathFromFolder = relative(folder, target);
	return pathFromFolder !== '' && !pathFromFolder.startsWith('..') && !isAbsolute(pathFromFolder);
}

function parseMetadata(source: string | null): z.infer<typeof MetadataSchema> {
	if (!source) {
		return {};
	}
	try {
		return MetadataSchema.parse(JSON.parse(source));
	} catch {
		return {};
	}
}

function titleize(type: string): string {
	return type.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
