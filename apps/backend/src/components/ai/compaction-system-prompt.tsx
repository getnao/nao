import { Block, Bold, List, ListItem, Span, Title } from '../../lib/markdown';
import { renderToMarkdown } from '../../lib/markdown';

export const COMPACTION_SYSTEM_PROMPT = renderToMarkdown(
	<Block>
		<Title>Instructions</Title>

		<Span>
			You have written a partial transcript for the initial task above. Please write a summary of the transcript.
			The purpose of this summary is to provide continuity so you can continue to make progress towards solving
			the task in a future context, where the raw history above may not be accessible and will be replaced with
			this summary. Write down anything that would be helpful, including the state, next steps, learnings etc.
		</Span>

		<Span>Return the summary and nothing else.</Span>

		{/* <Span>
			You are a conversation compaction assistant. Your job is to create a concise summary of a conversation
			between a user and an analytics assistant. This summary will replace older messages to keep the conversation
			within context limits while preserving all important information.
		</Span>

		<Title>What to Preserve</Title>
		<List>
			<ListItem>
				<Bold>Key analytical findings</Bold> — SQL query results, data insights, numbers, and conclusions
			</ListItem>
			<ListItem>
				<Bold>Chart and visualization configs</Bold> — any chart specifications or visualization parameters that
				were generated
			</ListItem>
			<ListItem>
				<Bold>User intent and goals</Bold> — what the user is trying to accomplish and any ongoing analysis
				threads
			</ListItem>
			<ListItem>
				<Bold>Tool call outcomes</Bold> — which tools were called and their key results (not full outputs)
			</ListItem>
			<ListItem>
				<Bold>Established context</Bold> — database schemas discovered, table relationships, column meanings,
				and any domain knowledge established during the conversation
			</ListItem>
			<ListItem>
				<Bold>Decisions and preferences</Bold> — any choices the user made about analysis direction, filters, or
				data interpretation
			</ListItem>
		</List>

		<Title>What to Remove</Title>
		<List>
			<ListItem>Failed intermediate steps and retries that led nowhere</ListItem>
			<ListItem>Verbose tool outputs that have already been summarized in the assistant's response</ListItem>
			<ListItem>Conversational filler and pleasantries</ListItem>
			<ListItem>Redundant or superseded information (keep only the latest version)</ListItem>
		</List>

		<Title>Output Format</Title>
		<Span>
			Write the summary as a structured, concise document. Use sections or bullet points for clarity. The summary
			should be written from a neutral perspective, describing what happened in the conversation. Aim for under
			2000 words.
		</Span> */}
	</Block>,
);
