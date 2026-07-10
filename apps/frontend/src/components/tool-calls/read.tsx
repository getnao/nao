import { Streamdown } from 'streamdown';
import { ToolCallWrapper } from './tool-call-wrapper';
import { McpTitle } from './mcp-title';
import type { ToolCallComponentProps } from '.';
import type { McpTarget } from '@/lib/mcp';
import { getMcpTarget } from '@/lib/mcp';
import { useToolCallContext } from '@/contexts/tool-call';
import { markdownPlugins } from '@/lib/markdown';

export const ReadToolCall = ({ toolPart: { output, input } }: ToolCallComponentProps<'read'>) => {
	const { isSettled } = useToolCallContext();

	const filePath = input?.file_path;
	const fileName = filePath?.split('/').pop() ?? filePath;
	const mcpTarget = getMcpTarget(filePath);
	const contextLabel = getReadContextLabel(filePath);
	const titleContext = contextLabel ? (
		<>
			{' '}
			from <code className='text-xs font-[Geist]! bg-accent/70! px-1 py-0.5 rounded'>{contextLabel}</code>
		</>
	) : null;

	if (!isSettled) {
		return (
			<ToolCallWrapper
				title={
					mcpTarget ? (
						<McpReadTitle target={mcpTarget} isSettled={false} />
					) : (
						<>
							Reading...{' '}
							<code className='text-xs font-[Geist]! bg-accent/70! px-1 py-0.5 rounded'>{fileName}</code>
							{titleContext}
						</>
					)
				}
			/>
		);
	}

	return (
		<ToolCallWrapper
			title={
				mcpTarget ? (
					<McpReadTitle target={mcpTarget} isSettled={true} />
				) : (
					<>
						Read <code className='text-xs font-[Geist]! bg-accent/70! px-1 py-0.5 rounded'>{fileName}</code>
						{titleContext}
					</>
				)
			}
			badge={output && `${output.numberOfTotalLines} lines`}
		>
			{output && (
				<div className='border rounded-lg'>
					{input?.file_path && (
						<div className='px-3 py-2 border-b'>
							<FilePathBreadcrumb filePath={input.file_path} />
						</div>
					)}
					<div className='overflow-auto max-h-200 hide-code-header markdown-small'>
						<Streamdown mode='static' controls={false} plugins={markdownPlugins} className='py-10 px-24'>
							{toMarkdown(output.content, filePath)}
						</Streamdown>
					</div>
				</div>
			)}
		</ToolCallWrapper>
	);
};

const McpReadTitle = ({ target, isSettled }: { target: McpTarget; isSettled: boolean }) => (
	<McpTitle server={target.server}>
		{isSettled ? 'Loaded' : 'Loading...'}{' '}
		{target.tool ? (
			<>
				<em>{target.tool}</em> from {target.server}
			</>
		) : (
			(target.server ?? 'MCP servers')
		)}
	</McpTitle>
);

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);

const toMarkdown = (content: string, filePath?: string): string => {
	const extension = filePath?.split('.').pop()?.toLowerCase() ?? '';
	if (MARKDOWN_EXTENSIONS.has(extension)) {
		return wrapJsonLines(content);
	}

	return `\`\`\`${extension}\n${content}\n\`\`\``;
};

const wrapJsonLines = (content: string): string => {
	const lines = content.split('\n');
	const result: string[] = [];
	let buffer: string[] = [];

	const flushBuffer = () => {
		if (buffer.length === 0) {
			return;
		}
		result.push(jsonLinesToMarkdown(buffer));
		buffer = [];
	};

	for (const line of lines) {
		const candidate = line.trim().replace(/^[-*]\s+/, '');
		if (candidate.startsWith('{') && candidate.endsWith('}')) {
			buffer.push(candidate);
		} else {
			flushBuffer();
			result.push(line);
		}
	}
	flushBuffer();

	return result.join('\n');
};

const jsonLinesToMarkdown = (jsonLines: string[]): string => {
	const rows: Record<string, unknown>[] = [];
	for (const line of jsonLines) {
		try {
			const parsed = JSON.parse(line);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				rows.push(parsed as Record<string, unknown>);
			} else {
				return fencedJson(jsonLines);
			}
		} catch {
			return fencedJson(jsonLines);
		}
	}

	const columns: string[] = [];
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			if (!columns.includes(key)) {
				columns.push(key);
			}
		}
	}

	const header = `| ${columns.join(' | ')} |`;
	const separator = `| ${columns.map(() => '---').join(' | ')} |`;
	const body = rows.map((row) => `| ${columns.map((col) => formatCell(row[col])).join(' | ')} |`);

	return ['', header, separator, ...body, ''].join('\n');
};

const formatCell = (value: unknown): string => {
	if (value === null || value === undefined) {
		return '';
	}
	const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
	return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
};

const fencedJson = (jsonLines: string[]): string => ['```json', ...jsonLines, '```'].join('\n');

const FilePathBreadcrumb = ({ filePath }: { filePath: string }) => {
	const segments = filePath.split('/').filter(Boolean);

	return (
		<span className='text-[11px] font-mono break-all leading-relaxed'>
			{segments.map((segment, i) => (
				<span key={i}>
					{i > 0 && <span className='text-muted-foreground/60 mx-1'>›</span>}
					{segment}
				</span>
			))}
		</span>
	);
};

const getReadContextLabel = (filePath?: string): string | null => {
	if (!filePath) {
		return null;
	}

	const schemaMatch = filePath.match(/\/schema=([^/]+)/);
	const tableMatch = filePath.match(/\/table=([^/]+)/);
	if (schemaMatch && tableMatch) {
		return `${schemaMatch[1]}.${tableMatch[1]}`;
	}

	const pathSegments = filePath.split('/').filter(Boolean);
	if (pathSegments.length < 2) {
		return null;
	}

	const parentDir = pathSegments[pathSegments.length - 2];
	if (!parentDir || parentDir.includes('=')) {
		return null;
	}

	return parentDir;
};
