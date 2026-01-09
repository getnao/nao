import fs from 'fs/promises';
import { glob } from 'glob';
import path from 'path';

interface GrepCodebaseConfig {
	pattern: string;
	include: string[];
	exclude: string[];
	case_sensitive: boolean;
}

export const grep_codebase = async (config: GrepCodebaseConfig) => {
	const { pattern, include, exclude, case_sensitive } = config;
	const flags = case_sensitive ? 'g' : 'gi';
	const regex = new RegExp(pattern, flags);

	// Get all files matching include patterns and not matching exclude patterns
	const includeFiles = await Promise.all(include.map((p) => glob(p, { absolute: true })));
	const allIncludeFiles = includeFiles.flat();

	const excludeFiles = exclude.length > 0 ? await Promise.all(exclude.map((p) => glob(p, { absolute: true }))) : [];
	const allExcludeFiles = new Set(excludeFiles.flat());

	const filesToSearch = allIncludeFiles.filter((file) => !allExcludeFiles.has(file));

	const results: Array<{
		line: number;
		text: string;
		matchCount: number;
		absolutePath: string;
		relativePath: string;
	}> = [];

	for (const absolutePath of filesToSearch) {
		try {
			const content = await fs.readFile(absolutePath, 'utf-8');
			const lines = content.split('\n');
			const relativePath = path.relative(process.cwd(), absolutePath);

			lines.forEach((lineText, index) => {
				const matches = lineText.match(regex);
				if (matches) {
					results.push({
						line: index + 1,
						text: lineText,
						matchCount: matches.length,
						absolutePath,
						relativePath,
					});
				}
			});
		} catch {
			continue;
		}
	}

	return results;
};
