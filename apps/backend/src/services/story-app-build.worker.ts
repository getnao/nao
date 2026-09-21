/**
 * Runs in a child `bun` process: reads a build request from stdin, bundles the
 * story with `Bun.build` from in-memory sources and writes the response to stdout.
 *
 * `storyBuildWorker` is shipped to the child as `Function.prototype.toString()`
 * (see `story-app-build.ts`), so it must stay self-contained: no imports, no
 * references to anything outside its own body except globals. Everything it
 * needs to know travels in the request.
 */

export interface StoryBuildRequest {
	entry: string;
	files: Record<string, string>;
	allowedImports: string[];
}

export interface StoryBuildDiagnostic {
	message: string;
	file?: string;
	line?: number;
	column?: number;
	lineText?: string;
}

export type StoryBuildResponse = { ok: true; bundle: string } | { ok: false; diagnostics: StoryBuildDiagnostic[] };

export async function storyBuildWorker(): Promise<void> {
	const NAMESPACE = 'story';
	const SCRIPT_EXTENSIONS = ['jsx', 'tsx', 'js', 'ts'];
	const RESOLVE_EXTENSIONS = [...SCRIPT_EXTENSIONS, 'json', 'css', 'md'];

	const request = JSON.parse(await Bun.stdin.text()) as StoryBuildRequest;
	const files = request.files;
	const allowed = new Set(request.allowedImports);

	const respond = (response: StoryBuildResponse): void => {
		process.stdout.write(JSON.stringify(response));
	};

	const extensionOf = (filePath: string): string => filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();

	const normalize = (filePath: string): string => {
		const segments: string[] = [];
		for (const segment of filePath.split('/')) {
			if (segment === '..') {
				segments.pop();
			} else if (segment !== '.' && segment !== '') {
				segments.push(segment);
			}
		}
		return segments.join('/');
	};

	const resolveRelative = (importer: string, specifier: string): string | null => {
		const directory = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
		const base = normalize(directory ? `${directory}/${specifier}` : specifier);
		const candidates = [
			base,
			...RESOLVE_EXTENSIONS.map((extension) => `${base}.${extension}`),
			...SCRIPT_EXTENSIONS.map((extension) => `${base}/index.${extension}`),
		];
		return candidates.find((candidate) => candidate in files) ?? null;
	};

	const isRelative = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../');

	const describeImport = (importer: string, specifier: string): string | null => {
		if (allowed.has(specifier)) {
			return null;
		}
		if (!isRelative(specifier)) {
			return `"${importer}" imports "${specifier}", which is not available to stories. Allowed packages: ${[...allowed].join(', ')}. Relative imports must start with "./" or "../".`;
		}
		if (resolveRelative(importer, specifier) === null) {
			return `"${importer}" imports "${specifier}", which does not exist in the story. Write the file first, or fix the path.`;
		}
		return null;
	};

	/** Reports every bad import across the story at once, before the bundler stops at the first one. */
	const scanImports = (): StoryBuildDiagnostic[] => {
		const diagnostics: StoryBuildDiagnostic[] = [];
		for (const [filePath, content] of Object.entries(files)) {
			const extension = extensionOf(filePath);
			if (!SCRIPT_EXTENSIONS.includes(extension)) {
				continue;
			}
			try {
				const transpiler = new Bun.Transpiler({ loader: extension as 'jsx' | 'tsx' | 'js' | 'ts' });
				for (const found of transpiler.scanImports(content)) {
					const message = describeImport(filePath, found.path);
					if (message) {
						diagnostics.push({ file: filePath, message });
					}
				}
			} catch {
				// A file the scanner cannot parse is reported by the bundler with a position.
			}
		}
		return diagnostics;
	};

	const importDiagnostics = scanImports();
	if (importDiagnostics.length > 0) {
		respond({ ok: false, diagnostics: importDiagnostics });
		return;
	}

	const result = await Bun.build({
		entrypoints: [`${NAMESPACE}:${request.entry}`],
		target: 'browser',
		format: 'esm',
		minify: false,
		sourcemap: 'none',
		throw: false,
		define: { 'process.env.NODE_ENV': '"production"' },
		plugins: [
			{
				name: 'story-files',
				setup(build) {
					build.onResolve({ filter: /.*/ }, (args) => {
						const specifier = args.path.startsWith(`${NAMESPACE}:`)
							? args.path.slice(NAMESPACE.length + 1)
							: args.path;
						if (args.importer === '') {
							return { path: normalize(specifier), namespace: NAMESPACE };
						}
						if (allowed.has(specifier)) {
							return { path: specifier, external: true };
						}
						const importer = args.importer.startsWith(`${NAMESPACE}:`)
							? args.importer.slice(NAMESPACE.length + 1)
							: args.importer;
						const message = describeImport(importer, specifier);
						if (message) {
							throw new Error(message);
						}
						return { path: resolveRelative(importer, specifier)!, namespace: NAMESPACE };
					});
					build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
						const extension = extensionOf(args.path);
						if (extension === 'css') {
							return { contents: '', loader: 'js' };
						}
						if (extension === 'md') {
							return { contents: files[args.path], loader: 'text' };
						}
						return {
							contents: files[args.path],
							loader: extension as 'jsx' | 'tsx' | 'js' | 'ts' | 'json',
						};
					});
				},
			},
		],
	});

	if (!result.success) {
		respond({
			ok: false,
			diagnostics: result.logs.map((log) => ({
				message: log.message,
				file: log.position?.file?.replace(new RegExp(`^${NAMESPACE}:`), '') || undefined,
				line: log.position?.line || undefined,
				column: log.position?.column || undefined,
				lineText: log.position?.lineText || undefined,
			})),
		});
		return;
	}

	const entryOutput = result.outputs.find((output) => output.kind === 'entry-point') ?? result.outputs[0];
	respond({ ok: true, bundle: await entryOutput.text() });
}
