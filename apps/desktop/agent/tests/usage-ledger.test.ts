// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { type LedgerEntry, summarizeEntries } from '../src/usage-ledger';

const NAO_SERVER = 'https://nao.example.com';
const NOW = new Date('2026-11-14T12:00:00');

function turn(at: string, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
	return {
		at: new Date(at).toISOString(),
		serverOrigin: NAO_SERVER,
		modelId: 'claude-sonnet-5-5',
		inputTokens: 1_000,
		outputTokens: 100,
		estimatedCostUsd: 0.5,
		durationMs: 4_000,
		stopReason: 'stop',
		...overrides,
	};
}

describe('summarizeEntries', () => {
	it('adds up the last 30 days of the asking server, by model and by day', () => {
		const summary = summarizeEntries(
			[
				turn('2026-11-13T09:00:00'),
				turn('2026-11-14T10:00:00', { modelId: 'claude-opus-5-5', estimatedCostUsd: 2 }),
				turn('2026-11-14T11:00:00'),
				turn('2026-11-14T11:30:00', { serverOrigin: 'https://other.example.com' }),
				turn('2026-10-01T09:00:00'),
			],
			NAO_SERVER,
			NOW,
		);

		expect(summary.totals).toEqual({ turns: 3, inputTokens: 3_000, outputTokens: 300, estimatedCostUsd: 3 });
		expect(summary.byModel.map(({ modelId, turns }) => [modelId, turns])).toEqual([
			['claude-sonnet-5-5', 2],
			['claude-opus-5-5', 1],
		]);
		expect(summary.byDay.map(({ day, turns }) => [day, turns])).toEqual([
			['2026-11-13', 1],
			['2026-11-14', 2],
		]);
		expect(summary.recentTurns.map((recent) => recent.at)).toEqual([
			new Date('2026-11-14T11:00:00').toISOString(),
			new Date('2026-11-14T10:00:00').toISOString(),
			new Date('2026-11-13T09:00:00').toISOString(),
		]);
		expect(summary.recentTurns[0]).not.toHaveProperty('serverOrigin');
	});
});
