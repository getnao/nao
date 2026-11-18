import type { Options, Plugin } from 'prettier';
import * as babelPlugin from 'prettier/plugins/babel';
import * as estreePlugin from 'prettier/plugins/estree';
import * as htmlPlugin from 'prettier/plugins/html';
import * as postcssPlugin from 'prettier/plugins/postcss';
import { format } from 'prettier/standalone';

import type { StoryFileInput } from '../queries/story-file.queries';

const PARSER_BY_EXTENSION: Record<string, string> = {
	js: 'babel',
	jsx: 'babel',
	ts: 'babel-ts',
	tsx: 'babel-ts',
	html: 'html',
	css: 'css',
	json: 'json',
};

const PLUGINS: Plugin[] = [babelPlugin, estreePlugin, htmlPlugin, postcssPlugin];

const OPTIONS: Options = {
	plugins: PLUGINS,
	printWidth: 100,
	tabWidth: 2,
	useTabs: false,
	semi: true,
	singleQuote: false,
	trailingComma: 'all',
};

export function formatStoryFiles(files: StoryFileInput[]): Promise<StoryFileInput[]> {
	return Promise.all(
		files.map(async (file) => ({ path: file.path, content: await formatStoryFile(file.path, file.content) })),
	);
}

export async function formatStoryFile(path: string, content: string): Promise<string> {
	const parser = PARSER_BY_EXTENSION[extensionOf(path)];
	if (!parser) {
		return content;
	}
	try {
		return await format(content, { ...OPTIONS, parser });
	} catch {
		return content;
	}
}

function extensionOf(path: string): string {
	return path.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
}
