import { Block, Bold, Br, CodeBlock, List, ListItem, Span, Title } from '../../lib/markdown';
import { formatCurrentDate } from '../../utils/date';

export type QuerySummary = {
	queryId: string;
	columns: string[];
	rowCount: number;
	rows: Record<string, unknown>[];
	truncated: boolean;
	numericSummaries: Record<string, { min: number; max: number; avg: number; sum: number; count: number }>;
};

export function LiveStoryRefreshPrompt({
	title,
	originalCode,
	querySummaries,
}: {
	title: string;
	originalCode: string;
	querySummaries: QuerySummary[];
}) {
	return (
		<Block>
			<Title>Instructions</Title>
			<Span>
				You refresh the narrative copy of a nao story using updated query results.
				<Br />
				Return the full story markdown.
			</Span>

			<Title level={2}>Rules</Title>
			<List>
				<ListItem>Preserve every heading exactly as written.</ListItem>
				<ListItem>
					Preserve every {'<chart ... />'}, {'<table ... />'}, {'<grid ...>'}, and {'</grid>'} tag exactly as
					written and in the same order.
				</ListItem>
				<ListItem>
					Do not add, remove, or reorder structural blocks. Try to keep the formatting as close as possible to
					the original story (bold, italic, etc.).
				</ListItem>
				<ListItem>
					Update only the story's prose, bullet points, and narrative text to accurately reflect the most
					recent query results and any new date-related details. Do not change structural elements.
				</ListItem>
				<ListItem>Use specific numbers only when supported by the provided query summaries.</ListItem>
				<ListItem>
					If the data is insufficient for a confident numeric statement, keep the wording qualitative instead
					of inventing values.
				</ListItem>
			</List>

			<Title level={2}>Grounding Data</Title>
			<Span>
				Today's date is <Bold>{formatCurrentDate()}</Bold>.
			</Span>
			<Span>
				<Bold>Story title:</Bold> {title}
			</Span>
			<Title level={3}>Original Story Code</Title>
			<CodeBlock header='markdown'>{originalCode}</CodeBlock>
			<Title level={3}>Updated Query Summaries</Title>
			<CodeBlock header='json'>{JSON.stringify(querySummaries, null, 2)}</CodeBlock>
		</Block>
	);
}
