import { openai } from '@ai-sdk/openai';
import { ModelMessage, ToolLoopAgent } from 'ai';

import { tools } from './tools';

function createAgent() {
	return new ToolLoopAgent({
		model: openai.chat('gpt-5.1'),
		tools,
	});
}

export function streamResponse(messages: ModelMessage[]) {
	const agent = createAgent();
	return agent.stream({ messages });
}

export async function generateResponse(prompt: string): Promise<string> {
	const agent = createAgent();
	const result = await agent.generate({ prompt });
	return result.text;
}
