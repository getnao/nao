import { Streamdown } from 'streamdown';
import { ToolCallWrapper } from './tool-call-wrapper';
import { TableDisplay } from './display-table';
import type { ToolCallComponentProps } from '.';
import { getToolName } from '@/lib/ai';
import { useToolCallContext } from '@/contexts/tool-call';

type McpContent = { type: string; text: string };

const extractText = (output: unknown): string | null => {
	if (typeof output === 'string') {
		return output;
	}
	if (output && typeof output === 'object') {
		const content = (output as { content?: McpContent[] }).content;
		if (Array.isArray(content)) {
			return content
				.filter((c) => c.type === 'text')
				.map((c) => c.text)
				.join('\n');
		}
	}
	return null;
};

const tryParseJson = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

const isArrayOfObjects = (value: unknown): value is Record<string, unknown>[] =>
	Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const KeyValueView = ({ data }: { data: Record<string, unknown> }) => (
	<div className='overflow-auto max-h-80 py-1'>
		{Object.entries(data).map(([key, value]) => (
			<div key={key} className='flex items-start gap-3 px-3 py-1 text-xs hover:bg-background/50 rounded'>
				<span className='text-foreground/50 shrink-0 min-w-24'>{key}</span>
				<span className='font-mono text-foreground/80 break-all'>{String(value ?? '')}</span>
			</div>
		))}
	</div>
);

const ListView = ({ data }: { data: unknown[] }) => (
	<div className='overflow-auto max-h-80 py-1'>
		{data.map((item, i) => (
			<div key={i} className='px-3 py-1 text-xs font-mono text-foreground/80 hover:bg-background/50 rounded'>
				{typeof item === 'object' ? JSON.stringify(item) : String(item)}
			</div>
		))}
	</div>
);

const McpOutputContent = ({ text }: { text: string }) => {
	const parsed = tryParseJson(text);

	if (isArrayOfObjects(parsed)) {
		return <TableDisplay data={parsed} showRowCount={false} tableContainerClassName='max-h-80' />;
	}
	if (Array.isArray(parsed)) {
		return <ListView data={parsed} />;
	}
	if (isPlainObject(parsed)) {
		return <KeyValueView data={parsed} />;
	}

	return (
		<div className='px-3 py-2 overflow-auto max-h-80 markdown-small'>
			<Streamdown mode='static'>{text}</Streamdown>
		</div>
	);
};

export const McpToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const { isSettled } = useToolCallContext();
	const toolName = getToolName(toolPart);
	const text = isSettled ? extractText(toolPart.output) : null;

	return <ToolCallWrapper title={toolName}>{text !== null && <McpOutputContent text={text} />}</ToolCallWrapper>;
};
