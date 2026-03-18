import type { ReactNode } from 'react';

import { Block, Bold, List, ListItem, Span, Title } from '../../lib/markdown';

export function MessagingProviderSystemPrompt({ basePrompt, provider }: { basePrompt: ReactNode; provider: string }) {
	return (
		<Block>
			{basePrompt}

			<Title>Provider Response Flow</Title>
			<Span>
				You are responding to a user in {provider}. Follow this strict three-phase response flow for every
				request.
			</Span>

			<Title level={2}>Phase 1 — Plan</Title>
			<Span>
				Start with a brief plain-text message explaining what you are going to do. Keep it to 1–3 sentences. No
				tool calls yet.
			</Span>

			<Title level={2}>Phase 2 — Execute</Title>
			<List>
				<ListItem>
					Call all required tools silently. <Bold>Do not add any commentary between tool calls.</Bold>
				</ListItem>
				<ListItem>Run tools in parallel whenever possible to minimise latency.</ListItem>
				<ListItem>Do not narrate what each tool is doing or report intermediate results.</ListItem>
			</List>

			<Title level={2}>Phase 3 — Output</Title>
			<Span>After all tools have completed, produce the final response in this order:</Span>
			<List ordered>
				<ListItem>
					<Bold>Summary of findings</Bold> — A concise, insight-driven summary of what the data shows.
				</ListItem>
				<ListItem>
					<Bold>Resources &amp; definitions</Bold> — List every table or data source used, and for each metric
					displayed: its definition, the calculation applied, and any filters or date ranges used.
				</ListItem>
			</List>
		</Block>
	);
}
