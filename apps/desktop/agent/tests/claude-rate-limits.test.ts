// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { listWindows } from '../src/claude-rate-limits';

describe('listWindows', () => {
	it('keeps the documented plan windows that apply, then the per-model ones', () => {
		const windows = listWindows({
			five_hour: null,
			seven_day: { utilization: 39, resets_at: '2026-11-16T09:00:00Z' },
			seven_day_opus: { utilization: 12, resets_at: null },
			model_scoped: [{ display_name: 'Fable', utilization: 80, resets_at: '2026-11-16T09:00:00Z' }],
		});

		expect(windows).toEqual([
			{ label: 'Current week (all models)', utilization: 39, resetsAt: '2026-11-16T09:00:00Z' },
			{ label: 'Current week (Opus)', utilization: 12, resetsAt: null },
			{ label: 'Current week (Fable)', utilization: 80, resetsAt: '2026-11-16T09:00:00Z' },
		]);
	});
});
