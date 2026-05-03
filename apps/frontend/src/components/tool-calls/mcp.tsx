import { Streamdown } from 'streamdown';
import { parseChartBlock } from '@nao/shared/story-segments';
import { ChartDisplay } from './display-chart';
import { TableDisplay } from './display-table';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import type { displayChart } from '@nao/shared/tools';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';
import { getToolName } from '@/lib/ai';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useToolCallContext } from '@/contexts/tool-call';

const EMPTY_MESSAGES: UIMessage[] = [];

type McpContent = { type: string; text: string };

const extractChartBlock = (output: unknown): string | null => {
	if (output && typeof output === 'object' && !Array.isArray(output)) {
		const block = (output as Record<string, unknown>).block;
		if (typeof block === 'string' && /^<chart\s/.test(block)) {
			return block;
		}
	}
	return null;
};

const findSqlData = (messages: UIMessage[], queryId: string): Record<string, unknown>[] | null => {
	for (const message of messages) {
		for (const part of message.parts) {
			const output = (part as UIToolPart).output;
			if (output && typeof output === 'object' && !Array.isArray(output)) {
				const typed = output as Record<string, unknown>;
				if (typed.query_id === queryId && Array.isArray(typed.data)) {
					return typed.data as Record<string, unknown>[];
				}
			}
		}
	}
	return null;
};

const McpChartOutput = ({ chartBlock }: { chartBlock: string }) => {
	const agent = useOptionalAgentContext();
	const messages = agent?.messages ?? EMPTY_MESSAGES;

	const attrString = chartBlock.match(/^<chart\s+([\s\S]*?)\s*\/?>$/)?.[1] ?? '';
	const chart = parseChartBlock(attrString);

	if (!chart || chart.series.length === 0) {
		return null;
	}

	const data = findSqlData(messages, chart.queryId);

	if (!data || data.length === 0) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Chart data unavailable
			</div>
		);
	}

	return (
		<div className={`my-4 w-full ${chart.chartType !== 'kpi_card' ? 'aspect-3/2' : ''}`}>
			<ChartDisplay
				data={data}
				chartType={chart.chartType as displayChart.ChartType}
				xAxisKey={chart.xAxisKey}
				xAxisType={chart.xAxisType === 'number' ? 'number' : 'category'}
				series={chart.series}
				title={chart.title}
			/>
		</div>
	);
};

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

	if (isSettled) {
		const chartBlock = extractChartBlock(toolPart.output);
		if (chartBlock) {
			return <McpChartOutput chartBlock={chartBlock} />;
		}
	}

	const text = isSettled ? extractText(toolPart.output) : null;
	return <ToolCallWrapper title={toolName}>{text !== null && <McpOutputContent text={text} />}</ToolCallWrapper>;
};
