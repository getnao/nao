import { describe, expect, it } from 'vitest';

import {
	collectTriggerChatIds,
	collectTriggerTargetIds,
	computeImpact,
	fingerprintFor,
	reconcile,
	repairTriggerRefs,
} from '../src/services/context-recommendations.reconcile';

const TOTALS = { errors: 100, downvotes: 20, regenerations: 30 };

function finding(overrides: Partial<Parameters<typeof reconcile>[0]['recorded'][number]> = {}) {
	return {
		suggestedFile: 'databases/x/columns.md',
		subjectKey: 'events_v1',
		category: 'tool_error' as const,
		rootCause: 'r',
		title: 't',
		summary: 's',
		suggestedAction: 'a',
		insights: [
			{
				signalType: 'tool_error' as const,
				metric: 'errors',
				count: 50,
				triggerRefs: [{ chatId: 'c1' }, { chatId: 'c2' }],
			},
		],
		...overrides,
	};
}

describe('fingerprintFor', () => {
	it('is stable and distinguishes resources', () => {
		expect(fingerprintFor('a.md', 'k')).toBe(fingerprintFor('a.md', 'k'));
		expect(fingerprintFor('a.md', 'k')).not.toBe(fingerprintFor('a.md', 'k2'));
	});
});

describe('computeImpact', () => {
	it('counts distinct chats and computes failure share', () => {
		const { impact, impactScore } = computeImpact(
			[
				{
					signalType: 'tool_error',
					metric: 'errors',
					count: 30,
					triggerRefs: [{ chatId: 'c1' }, { chatId: 'c2' }],
				},
			],
			TOTALS,
		);
		expect(impact.affectedChats).toBe(2);
		expect(impact.failureShare).toBeCloseTo(30 / 150, 5);
		expect(impactScore).toBeGreaterThan(0);
	});
});

describe('repairTriggerRefs', () => {
	const item = (triggerRefs: { chatId: string; targetId?: string }[]) => ({
		insights: [{ signalType: 'coverage_gap' as const, metric: 'm', count: 1, triggerRefs }],
	});

	it('rewrites a mis-transcribed chatId using the target that resolves to the real chat', () => {
		const [repaired] = repairTriggerRefs(
			[item([{ chatId: 'wrong-chat', targetId: 'msg-1' }])],
			new Map([['msg-1', 'real-chat']]),
			new Set(),
		);
		expect(repaired.insights[0].triggerRefs).toEqual([{ chatId: 'real-chat', targetId: 'msg-1' }]);
	});

	it('keeps a recorded chatId that exists even when the target does not resolve', () => {
		const [repaired] = repairTriggerRefs(
			[item([{ chatId: 'known-chat', targetId: 'stale-msg' }])],
			new Map(),
			new Set(['known-chat']),
		);
		expect(repaired.insights[0].triggerRefs).toEqual([{ chatId: 'known-chat', targetId: 'stale-msg' }]);
	});

	it('drops a ref that resolves to no real chat', () => {
		const [repaired] = repairTriggerRefs([item([{ chatId: 'phantom' }])], new Map(), new Set());
		expect(repaired.insights[0].triggerRefs).toEqual([]);
	});

	it('collects distinct target and chat ids', () => {
		const items = [
			item([{ chatId: 'c1', targetId: 't1' }, { chatId: 'c2' }]),
			item([{ chatId: 'c1', targetId: 't1' }]),
		];
		expect(collectTriggerTargetIds(items)).toEqual(['t1']);
		expect(collectTriggerChatIds(items)).toEqual(['c1', 'c2']);
	});
});

describe('reconcile', () => {
	const base = { totals: TOTALS, impactFloor: 5 };

	it('inserts a new finding above the floor', () => {
		const actions = reconcile({
			...base,
			existing: [],
			recorded: [finding()],
			resolvedFingerprints: [],
			dismissedFingerprints: [],
		});
		expect(actions).toHaveLength(1);
		expect(actions[0].kind).toBe('insert');
	});

	it('collapses repeat recordings of one resource into a single action (last wins)', () => {
		const actions = reconcile({
			...base,
			existing: [],
			recorded: [finding({ title: 'first pass' }), finding({ title: 'refined' })],
			resolvedFingerprints: [],
			dismissedFingerprints: [],
		});
		expect(actions).toHaveLength(1);
		expect(actions[0]).toMatchObject({ kind: 'insert', finding: { title: 'refined' } });
	});

	it('suppresses a new finding below the floor', () => {
		const tiny = finding({
			insights: [{ signalType: 'tool_error', metric: 'errors', count: 1, triggerRefs: [{ chatId: 'c1' }] }],
		});
		const actions = reconcile({
			...base,
			impactFloor: 1000,
			existing: [],
			recorded: [tiny],
			resolvedFingerprints: [],
			dismissedFingerprints: [],
		});
		expect(actions).toHaveLength(0);
	});

	it('skips a dismissed fingerprint', () => {
		const fp = fingerprintFor('databases/x/columns.md', 'events_v1');
		const actions = reconcile({
			...base,
			existing: [],
			recorded: [finding()],
			resolvedFingerprints: [],
			dismissedFingerprints: [fp],
		});
		expect(actions).toHaveLength(0);
	});

	it('updates an existing open rec (keeps state)', () => {
		const fp = fingerprintFor('databases/x/columns.md', 'events_v1');
		const existing = [{ id: 'r1', fingerprint: fp, status: 'open' as const, occurrenceCount: 1 }];
		const actions = reconcile({
			...base,
			existing,
			recorded: [finding()],
			resolvedFingerprints: [],
			dismissedFingerprints: [],
		});
		expect(actions[0]).toMatchObject({ kind: 'update', id: 'r1', reopen: false });
	});

	it('reopens an applied rec when the gap recurs', () => {
		const fp = fingerprintFor('databases/x/columns.md', 'events_v1');
		const existing = [{ id: 'r1', fingerprint: fp, status: 'applied' as const, occurrenceCount: 3 }];
		const actions = reconcile({
			...base,
			existing,
			recorded: [finding()],
			resolvedFingerprints: [],
			dismissedFingerprints: [],
		});
		expect(actions[0]).toMatchObject({ kind: 'update', id: 'r1', reopen: true });
	});

	it('auto-clears an open rec the agent verified resolved', () => {
		const fp = fingerprintFor('RULES.md', 'gone');
		const existing = [{ id: 'r2', fingerprint: fp, status: 'open' as const, occurrenceCount: 1 }];
		const actions = reconcile({
			...base,
			existing,
			recorded: [],
			resolvedFingerprints: [fp],
			dismissedFingerprints: [],
		});
		expect(actions[0]).toMatchObject({ kind: 'resolve', id: 'r2' });
	});

	it('leaves an unmentioned open rec unchanged (no inferred auto-clear)', () => {
		const existing = [{ id: 'r3', fingerprint: 'other', status: 'open' as const, occurrenceCount: 1 }];
		const actions = reconcile({
			...base,
			existing,
			recorded: [],
			resolvedFingerprints: [],
			dismissedFingerprints: [],
		});
		expect(actions).toHaveLength(0);
	});
});
