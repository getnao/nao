import { ContextFileReadCost } from '../types/context-recommendation';

export type ContextFileCostFlag = 'truncated_on_read' | 'frequent_and_expensive' | 'rare_but_outlier';

export interface FlaggedContextFile extends ContextFileReadCost {
	flag?: ContextFileCostFlag;
}

/** A file must cost at least this many estimated tokens per read to be worth flagging. */
const MIN_TOKENS_TO_FLAG = 1_000;

export function flagExpensiveContextFiles(costs: ContextFileReadCost[]): FlaggedContextFile[] {
	if (costs.length === 0) {
		return [];
	}

	const meanReadCount = mean(costs.map((c) => c.readCount));
	const meanAvgTokens = mean(costs.map((c) => c.avgTokens));

	return costs.map((cost) => ({ ...cost, flag: flagFor(cost, { meanReadCount, meanAvgTokens }) }));
}

function flagFor(
	cost: ContextFileReadCost,
	batch: { meanReadCount: number; meanAvgTokens: number },
): ContextFileCostFlag | undefined {
	if (cost.truncated) {
		return 'truncated_on_read';
	}
	if (cost.avgTokens < MIN_TOKENS_TO_FLAG && cost.maxTokens < MIN_TOKENS_TO_FLAG) {
		return undefined;
	}
	if (cost.readCount >= Math.max(2, batch.meanReadCount) && cost.avgTokens >= batch.meanAvgTokens) {
		return 'frequent_and_expensive';
	}
	if (cost.readCount <= 2 && cost.maxTokens >= 2 * batch.meanAvgTokens) {
		return 'rare_but_outlier';
	}
	return undefined;
}

function mean(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}
