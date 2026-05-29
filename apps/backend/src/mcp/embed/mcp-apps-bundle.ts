import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const MCP_APPS_SCRIPT_PATH = '/mcp-apps.js';

let cachedBundle: string | null = null;

export function mcpAppsScriptUrl(apiBaseUrl: string): string {
	const base = apiBaseUrl.replace(/\/+$/, '');
	return `${base}/mcp${MCP_APPS_SCRIPT_PATH}`;
}

/** Browser bundle from `@modelcontextprotocol/ext-apps` (`app-with-deps.js`), adapted for `<script src>`. */
export function getMcpAppsBundle(): string {
	if (cachedBundle) {
		return cachedBundle;
	}

	const requireFromHere = createRequire(import.meta.url);
	const pkgJsonPath = requireFromHere.resolve('@modelcontextprotocol/ext-apps/package.json');
	const bundlePath = join(dirname(pkgJsonPath), 'dist/src/app-with-deps.js');
	const raw = readFileSync(bundlePath, 'utf8');

	const transformed = raw.replace(/export\s*\{([\s\S]*?)\}\s*;?\s*$/, (_match, body: string) => {
		const assigns = body
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => {
				const m = s.match(/^(\S+)\s+as\s+(\S+)$/);
				return m ? `${m[2]}:${m[1]}` : `${s}:${s}`;
			})
			.join(',');
		return `Object.assign(globalThis,{${assigns}});`;
	});

	cachedBundle = transformed;
	return transformed;
}
