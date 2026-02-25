import { type DBMemory } from '../../db/abstractSchema';
import { Block, Br, renderToMarkdown, Span, XML } from '../../lib/markdown';

export function renderMemoryExtractionUserMessage(memories: DBMemory[]): string {
	const instructions = memories.filter((m) => m.category === 'global_rule');
	const facts = memories.filter((m) => m.category === 'personal_fact');

	return renderToMarkdown(
		<Block>
			<Span>
				Review the conversation and existing memories to extract personal facts about me (name, role, company,
				etc.) if I shared any.
				<Br />
				For instructions or preferences, only extract if I used permanence signals like "always", "never", "from
				now on", etc.
				<Br />
				If nothing qualifies, return null for both fields.
			</Span>

			<XML tag='memories'>
				<XML tag='user_instructions'>
					{!instructions.length
						? 'Empty'
						: instructions.map((m) => (
								<Span>
									[id: {m.id}] {m.content}
								</Span>
							))}
				</XML>

				<XML tag='user_profile'>
					{!facts.length
						? 'Empty'
						: facts.map((m) => (
								<Span>
									[id: {m.id}] {m.content}
								</Span>
							))}
				</XML>
			</XML>
		</Block>,
	);
}
