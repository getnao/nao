import React from 'react';

import { ExecuteSqlOutput, GrepOutput, ListOutput, ReadOutput, SearchOutput } from '../src/components/tool-outputs/';
import { renderToMarkdown } from '../src/lib/markdown';

function printSection(title: string, jsx: React.ReactNode) {
	const md = renderToMarkdown(jsx);
	console.log(`\n${'='.repeat(60)}`);
	console.log(`  ${title}`);
	console.log(`${'='.repeat(60)}\n`);
	console.log(md);
}

// ── execute_sql: query with results ──

printSection(
	'execute_sql — rows returned',
	<ExecuteSqlOutput
		output={{
			id: 'query_abc123',
			columns: ['id', 'name', 'email', 'created_at'],
			row_count: 3,
			data: [
				{ id: 1, name: 'Alice', email: 'alice@example.com', created_at: '2025-01-15T10:00:00Z' },
				{ id: 2, name: 'Bob', email: 'bob@example.com', created_at: '2025-02-20T14:30:00Z' },
				{ id: 3, name: 'Charlie', email: 'charlie@example.com', created_at: '2025-03-10T09:15:00Z' },
			],
		}}
	/>,
);

// ── grep: matches found ──

printSection(
	'grep — matches found',
	<GrepOutput
		output={{
			matches: [
				{
					path: 'src/services/auth.ts',
					line_number: 12,
					line_content: 'export async function authenticate(token: string) {',
				},
				{
					path: 'src/services/auth.ts',
					line_number: 45,
					line_content: '  if (!isValid) throw new AuthError("Invalid token");',
				},
				{
					path: 'src/middleware/auth.ts',
					line_number: 8,
					line_content: 'import { authenticate } from "../services/auth";',
				},
				{
					path: 'src/middleware/auth.ts',
					line_number: 22,
					line_content: '  const user = await authenticate(req.headers.authorization);',
				},
				{
					path: 'src/routes/login.ts',
					line_number: 31,
					line_content: '  const session = await authenticate(credentials);',
				},
			],
			total_matches: 5,
			truncated: false,
		}}
	/>,
);

// ── grep: many matches with overflow ──

printSection(
	'grep — 60 matches (overflow into "more matches in")',
	<GrepOutput
		output={{
			matches: [
				...Array.from({ length: 50 }, (_, i) => ({
					path: `src/components/component-${Math.floor(i / 5)}.tsx`,
					line_number: (i % 20) + 1,
					line_content: `  const value${i} = useQuery({ queryKey: ['data-${i}'] });`,
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					path: `src/hooks/use-${['auth', 'theme', 'locale', 'query', 'mutation', 'form', 'modal', 'toast', 'nav', 'scroll'][i]}.ts`,
					line_number: 5 + i,
					line_content: `export function use${['Auth', 'Theme', 'Locale', 'Query', 'Mutation', 'Form', 'Modal', 'Toast', 'Nav', 'Scroll'][i]}() {`,
				})),
			],
			total_matches: 60,
			truncated: true,
		}}
	/>,
);

// ── list: mixed directory ──

printSection(
	'list — mixed directory entries',
	<ListOutput
		output={{
			_version: '1',
			entries: [
				{ path: 'src/index.ts', name: 'index.ts', type: 'file', size: '1240' },
				{ path: 'src/utils.ts', name: 'utils.ts', type: 'file', size: '3891' },
				{ path: 'src/README.md', name: 'README.md', type: 'file', size: '512' },
				{ path: 'src/components', name: 'components', type: 'directory', itemCount: 14 },
				{ path: 'src/hooks', name: 'hooks', type: 'directory', itemCount: 7 },
				{ path: 'src/services', name: 'services', type: 'directory', itemCount: 5 },
				{ path: 'src/node_modules', name: 'node_modules', type: 'symbolic_link' },
			],
		}}
	/>,
);

// ── read: file with content ──

printSection(
	'read — file with content',
	<ReadOutput
		output={{
			content: [
				'import { useState } from "react";',
				'',
				'export function Counter() {',
				'  const [count, setCount] = useState(0);',
				'  return (',
				'    <button onClick={() => setCount(c => c + 1)}>',
				'      Count: {count}',
				'    </button>',
				'  );',
				'}',
			].join('\n'),
			numberOfTotalLines: 10,
		}}
	/>,
);

// ── search: files found ──

printSection(
	'search — files found',
	<SearchOutput
		output={{
			_version: '1',
			files: [
				{ path: 'src/components/button.tsx', dir: 'src/components', size: '2048' },
				{ path: 'src/components/input.tsx', dir: 'src/components', size: '1536' },
				{ path: 'src/components/modal.tsx', dir: 'src/components', size: '4096' },
				{ path: 'src/components/tooltip.tsx', dir: 'src/components', size: '890' },
				{ path: 'src/hooks/use-modal.ts', dir: 'src/hooks', size: '640' },
				{ path: 'tests/components/button.test.tsx', dir: 'tests/components', size: '3200' },
			],
		}}
	/>,
);
