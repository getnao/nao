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
	documentSlots: { head: string; body: string };
}

export interface StoryBuildDiagnostic {
	message: string;
	file?: string;
	line?: number;
	column?: number;
	lineText?: string;
}

export type StoryBuildResponse =
	| { ok: true; bundle: string; pageShell: string | null }
	| { ok: false; diagnostics: StoryBuildDiagnostic[] };

export async function storyBuildWorker(): Promise<void> {
	const NAMESPACE = 'story';
	const SCRIPT_EXTENSIONS = ['jsx', 'tsx', 'js', 'ts'];
	const RESOLVE_EXTENSIONS = [...SCRIPT_EXTENSIONS, 'json', 'css', 'md'];
	const PRODUCTION_DEFINE = { 'process.env.NODE_ENV': '"production"' };
	const JSX_RUNTIME_IMPORTS = ['react/jsx-runtime', 'react/jsx-dev-runtime'];
	const EXECUTABLE_SCRIPT_TYPES = ['', 'module', 'text/javascript', 'application/javascript'];
	const VIRTUAL_PREFIX = '__nao-';
	const HTML_BUILD_ENTRY = `${VIRTUAL_PREFIX}entry.js`;

	const request = JSON.parse(await Bun.stdin.text()) as StoryBuildRequest;
	const files = request.files;
	const allowed = new Set(request.allowedImports);
	const virtualFileNames = new Map<string, string>();

	const respond = (response: StoryBuildResponse): void => {
		process.stdout.write(JSON.stringify(response));
	};

	const extensionOf = (filePath: string): string => filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();

	const isHtmlEntry = /\.html$/i.test(request.entry);

	const displayFileName = (filePath: string | undefined): string | undefined => {
		return filePath === undefined ? undefined : (virtualFileNames.get(filePath) ?? filePath);
	};

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
		const importerName = displayFileName(importer);
		if (!isRelative(specifier)) {
			return `"${importerName}" imports "${specifier}", which is not available to stories. Allowed packages: ${[...allowed].join(', ')}. Relative imports must start with "./" or "../".`;
		}
		if (resolveRelative(importer, specifier) === null) {
			return `"${importerName}" imports "${specifier}", which does not exist in the story. Write the file first, or fix the path.`;
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
				const transpiler = new Bun.Transpiler({
					loader: extension as 'jsx' | 'tsx' | 'js' | 'ts',
					define: PRODUCTION_DEFINE,
				});
				for (const found of transpiler.scanImports(content)) {
					if (JSX_RUNTIME_IMPORTS.includes(found.path)) {
						continue;
					}
					const message = describeImport(filePath, found.path);
					if (message) {
						diagnostics.push({ file: displayFileName(filePath), message });
					}
				}
			} catch {
				// A file the scanner cannot parse is reported by the bundler with a position.
			}
		}
		return diagnostics;
	};

	const isRemoteUrl = (value: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);

	const isLocalPath = (value: string): boolean => !isRemoteUrl(value) && !value.startsWith('/');

	/**
	 * Moves every executable `<script>` of the HTML entry, inline or local, into one virtual module that imports
	 * them in document order: the frame's CSP only runs the host's hashed boot script, which loads the bundle.
	 * The host's own CSP, import map and `<base>` rules must not be overridden, so those tags are dropped too.
	 */
	const prepareHtmlEntry = async (): Promise<{ pageShell: string } | { diagnostics: StoryBuildDiagnostic[] }> => {
		const diagnostics: StoryBuildDiagnostic[] = [];
		const imports: string[] = [];
		const inlineScripts: { path: string; content: string }[] = [];
		let current: { path: string; content: string } | null = null;
		let hasHtml = false;
		let hasHead = false;
		let hasBody = false;
		let contentBeforeHead = false;
		const entryDirectory = request.entry.slice(0, request.entry.lastIndexOf('/') + 1);
		const slots = request.documentSlots;

		const addInlineScript = (): void => {
			const path = `${entryDirectory}${VIRTUAL_PREFIX}inline-${inlineScripts.length}.js`;
			virtualFileNames.set(path, `${request.entry} (inline script #${inlineScripts.length + 1})`);
			current = { path, content: '' };
			inlineScripts.push(current);
			imports.push(path);
		};

		const addScriptSource = (src: string): void => {
			if (!isLocalPath(src)) {
				diagnostics.push({
					file: request.entry,
					message: `<script src="${src}"> is not available to stories: scripts must be files of the story, referenced with a relative path.`,
				});
				return;
			}
			const resolved = resolveRelative(request.entry, src);
			if (resolved === null || !SCRIPT_EXTENSIONS.includes(extensionOf(resolved))) {
				diagnostics.push({
					file: request.entry,
					message: `<script src="${src}"> does not point to a .js, .jsx, .ts or .tsx file of the story. Write the file first, or fix the path.`,
				});
				return;
			}
			imports.push(resolved);
		};

		/** Every stylesheet of the story is inlined by the host, so a local link is only checked, then dropped. */
		const addStylesheetLink = (href: string): void => {
			if (resolveRelative(request.entry, href) === null) {
				diagnostics.push({
					file: request.entry,
					message: `<link href="${href}"> does not exist in the story. Write the file first, or fix the path.`,
				});
			}
		};

		/** The frame only runs listeners attached from scripts, so an inline handler would silently do nothing. */
		const checkInlineHandlers = (element: HTMLRewriterTypes.Element): void => {
			for (const [name] of element.attributes) {
				if (/^on/i.test(name)) {
					diagnostics.push({
						file: request.entry,
						message: `<${element.tagName} ${name}="…"> is blocked by the story's security policy: attach the listener with addEventListener in a script instead.`,
					});
				}
			}
		};

		const transformed = await new HTMLRewriter()
			.onDocument({
				comments(comment) {
					comment.remove();
				},
				text(chunk) {
					if (!hasHead && chunk.text.trim() !== '') {
						contentBeforeHead = true;
					}
				},
			})
			.on('*', {
				element(element) {
					if (!hasHead && element.tagName !== 'html' && element.tagName !== 'head') {
						contentBeforeHead = true;
					}
					checkInlineHandlers(element);
				},
			})
			.on('html', {
				element() {
					hasHtml = true;
				},
			})
			.on('head', {
				element(element) {
					hasHead = true;
					element.prepend(slots.head, { html: true });
				},
			})
			.on('body', {
				element(element) {
					hasBody = true;
					element.append(slots.body, { html: true });
				},
			})
			.on('script', {
				element(element) {
					const type = (element.getAttribute('type') ?? '').trim().toLowerCase();
					if (type === 'importmap') {
						element.remove();
						return;
					}
					if (!EXECUTABLE_SCRIPT_TYPES.includes(type)) {
						current = null;
						return;
					}
					const src = element.getAttribute('src');
					if (src === null) {
						addInlineScript();
					} else {
						current = null;
						addScriptSource(src);
					}
					element.remove();
				},
				text(chunk) {
					if (current) {
						current.content += chunk.text;
					}
				},
			})
			.on('link[rel~="stylesheet"]', {
				element(element) {
					const href = element.getAttribute('href');
					if (href === null || !isLocalPath(href)) {
						return;
					}
					addStylesheetLink(href);
					element.remove();
				},
			})
			.on('meta[http-equiv]', {
				element(element) {
					if ((element.getAttribute('http-equiv') ?? '').trim().toLowerCase() === 'content-security-policy') {
						element.remove();
					}
				},
			})
			.on('base', {
				element(element) {
					element.remove();
				},
			})
			.transform(new Response(files[request.entry]))
			.text();

		if (diagnostics.length > 0) {
			return { diagnostics };
		}
		for (const script of inlineScripts) {
			files[script.path] = script.content;
		}
		files[HTML_BUILD_ENTRY] = imports.map((path) => `import ${JSON.stringify(`./${path}`)};`).join('\n');
		virtualFileNames.set(HTML_BUILD_ENTRY, request.entry);

		const isFragment = !hasHtml && !hasHead && !hasBody;
		if (!isFragment && (!hasHead || !hasBody)) {
			return documentError(`must be a full document with <head> and <body>, or a fragment with neither.`);
		}
		if (!isFragment && contentBeforeHead) {
			return documentError(`must not have content before <head>: start it with <!doctype html><html><head>.`);
		}
		const pageShell = isFragment
			? `<!doctype html>\n<html>\n<head>\n${slots.head}\n</head>\n<body>\n${transformed}\n${slots.body}\n</body>\n</html>`
			: transformed;
		if (pageShell.split(slots.head).length !== 2 || pageShell.split(slots.body).length !== 2) {
			return documentError(`must have exactly one <head> and one <body>.`);
		}
		return { pageShell };
	};

	const documentError = (problem: string): { diagnostics: StoryBuildDiagnostic[] } => {
		return { diagnostics: [{ file: request.entry, message: `"${request.entry}" ${problem}` }] };
	};

	/** The runtime renders the entry's default export, so an entry without one would only fail in the viewer. */
	const scanEntryExport = (): StoryBuildDiagnostic[] => {
		const extension = extensionOf(request.entry);
		if (!SCRIPT_EXTENSIONS.includes(extension)) {
			return [
				{
					file: request.entry,
					message: `The entry "${request.entry}" must be a .jsx, .tsx, .js or .ts file that default-exports the root React component, or an .html document.`,
				},
			];
		}
		try {
			const transpiler = new Bun.Transpiler({ loader: extension as 'jsx' | 'tsx' | 'js' | 'ts' });
			if (transpiler.scan(files[request.entry]).exports.includes('default')) {
				return [];
			}
			return [
				{
					file: request.entry,
					message: `"${request.entry}" must default-export the root React component, e.g. "export default function App() { … }".`,
				},
			];
		} catch {
			return [];
		}
	};

	let pageShell: string | null = null;
	let buildEntry = request.entry;
	if (isHtmlEntry) {
		const prepared = await prepareHtmlEntry();
		if ('diagnostics' in prepared) {
			respond({ ok: false, diagnostics: prepared.diagnostics });
			return;
		}
		pageShell = prepared.pageShell;
		buildEntry = HTML_BUILD_ENTRY;
	}

	const importDiagnostics = [...scanImports(), ...(isHtmlEntry ? [] : scanEntryExport())];
	if (importDiagnostics.length > 0) {
		respond({ ok: false, diagnostics: importDiagnostics });
		return;
	}

	const result = await Bun.build({
		entrypoints: [`${NAMESPACE}:${buildEntry}`],
		target: 'browser',
		format: 'esm',
		minify: false,
		sourcemap: 'none',
		throw: false,
		define: PRODUCTION_DEFINE,
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
				file: displayFileName(log.position?.file?.replace(new RegExp(`^${NAMESPACE}:`), '') || undefined),
				line: log.position?.line || undefined,
				column: log.position?.column || undefined,
				lineText: log.position?.lineText || undefined,
			})),
		});
		return;
	}

	const entryOutput = result.outputs.find((output) => output.kind === 'entry-point') ?? result.outputs[0];
	respond({ ok: true, bundle: await entryOutput.text(), pageShell });
}
