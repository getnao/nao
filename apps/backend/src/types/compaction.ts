import { ModelMessage } from 'ai';

import { TokenUsage } from './chat';

export interface CompactionResult {
	summary: string;
	usage: TokenUsage;
}

export interface ICompactionLLM {
	readonly modelId: string;
	compact(messages: ModelMessage[]): Promise<CompactionResult>;
}
