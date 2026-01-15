import { openai } from '@ai-sdk/openai';
import { ModelMessage, ToolLoopAgent } from 'ai';

import { getInstructions } from '../agents/prompt';
import { tools } from '../agents/tools';

function createAgent() {
	const instructions = getInstructions();

	return new ToolLoopAgent({
		model: openai.chat('gpt-5.1'),
		instructions,
		tools,
	});
}

export function agentStreamResponse(messages: ModelMessage[]) {
	const agent = createAgent();
	return agent.stream({ messages });
}

export async function agentGenerateResponse(prompt: string): Promise<string> {
	const agent = createAgent();
	const result = await agent.generate({ prompt });
	return result.text;
}
