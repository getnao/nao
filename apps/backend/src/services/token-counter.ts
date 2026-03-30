import { ModelMessage, Tool } from 'ai';

import type { AgentTools } from '../types/chat';
import { getJsonSchema } from '../utils/tools';

const ESTIMATED_TOKENS_PER_IMAGE = 1000;

export interface ITokenCounter {
	estimateMessages(messages: ModelMessage[]): number;
	estimateTools(tools: Record<string, Tool>): Promise<number>;
	estimate(text: string): number;
}

export class TokenCounter implements ITokenCounter {
	estimateMessages(messages: ModelMessage[]): number {
		return messages.reduce((acc, curr) => acc + this.estimateMessage(curr), 0);
	}

	async estimateTools(tools: AgentTools): Promise<number> {
		const toolSchemaSizePromise = Object.values(tools).map(async (tool) => {
			const schema = await getJsonSchema(tool);
			return this.estimate(JSON.stringify(schema, null, 2));
		});
		const toolSchemaSizes = await Promise.all(toolSchemaSizePromise);
		return toolSchemaSizes.reduce((acc, curr) => acc + curr, 0);
	}

	estimateMessage(message: ModelMessage): number {
		if (!Array.isArray(message.content)) {
			return this.estimate(JSON.stringify(message, null, 2));
		}

		let imageCount = 0;
		const sanitizedContent = (message.content as Record<string, unknown>[]).map((part) => {
			if (part.type === 'file' && typeof part.data === 'string' && part.data.startsWith('data:')) {
				imageCount++;
				return { ...part, data: '[image]' };
			}
			if (part.type === 'image' && typeof part.image === 'string' && part.image.startsWith('data:')) {
				imageCount++;
				return { ...part, image: '[image]' };
			}
			return part;
		});

		const sanitized = { ...message, content: sanitizedContent };
		return this.estimate(JSON.stringify(sanitized, null, 2)) + imageCount * ESTIMATED_TOKENS_PER_IMAGE;
	}

	estimate(text: string) {
		return Math.ceil(text.length / 4);
	}
}

export const tokenCounter = new TokenCounter();
