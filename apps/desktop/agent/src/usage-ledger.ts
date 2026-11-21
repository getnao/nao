import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LocalAgentTurnUsage, LocalAgentUsageSummary, LocalAgentUsageTotals } from '@nao/shared/local-agent';

const LEDGER_FILE = 'usage.jsonl';
const SUMMARY_PERIOD_DAYS = 30;
const RETENTION_DAYS = 90;
const RECENT_TURNS = 10;
const COMPACTION_THRESHOLD_BYTES = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One turn run through nao, written on the user's computer: nao keeps no record of it. */
export interface LedgerEntry extends LocalAgentTurnUsage {
	serverOrigin: string;
}

export async function recordTurnUsage(entry: LedgerEntry): Promise<void> {
	const path = await ledgerPath();
	await appendFile(path, `${JSON.stringify(entry)}\n`);
	await compactWhenLarge(path);
}

/** Only the turns of the server asking, so one server never sees what the user did on another. */
export async function summarizeUsage(serverOrigin: string, now = new Date()): Promise<LocalAgentUsageSummary> {
	return summarizeEntries(await readEntries(await ledgerPath()), serverOrigin, now);
}

export function summarizeEntries(entries: LedgerEntry[], serverOrigin: string, now: Date): LocalAgentUsageSummary {
	const since = now.getTime() - SUMMARY_PERIOD_DAYS * DAY_MS;
	const turns = entries
		.filter((entry) => entry.serverOrigin === serverOrigin && Date.parse(entry.at) >= since)
		.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
	return {
		periodDays: SUMMARY_PERIOD_DAYS,
		totals: addUp(turns),
		byModel: groupBy(turns, (turn) => turn.modelId)
			.map(([modelId, modelTurns]) => ({ modelId, ...addUp(modelTurns) }))
			.sort((left, right) => right.turns - left.turns),
		byDay: groupBy(turns, (turn) => localDay(turn.at)).map(([day, dayTurns]) => ({ day, ...addUp(dayTurns) })),
		recentTurns: turns
			.slice(-RECENT_TURNS)
			.reverse()
			.map(({ serverOrigin: _serverOrigin, ...turn }) => turn),
	};
}

async function ledgerPath(): Promise<string> {
	const directory = process.env.NAO_AGENT_DATA_DIR || join(tmpdir(), 'nao-desktop-agent');
	await mkdir(directory, { recursive: true });
	return join(directory, LEDGER_FILE);
}

async function readEntries(path: string): Promise<LedgerEntry[]> {
	const content = await readFile(path, 'utf8').catch(() => '');
	return content.split('\n').flatMap(parseEntry);
}

function parseEntry(line: string): LedgerEntry[] {
	if (!line.trim()) {
		return [];
	}
	try {
		const entry = JSON.parse(line) as LedgerEntry;
		return typeof entry.at === 'string' && typeof entry.serverOrigin === 'string' ? [entry] : [];
	} catch {
		return [];
	}
}

async function compactWhenLarge(path: string): Promise<void> {
	const { size } = await stat(path);
	if (size < COMPACTION_THRESHOLD_BYTES) {
		return;
	}
	const oldestKept = Date.now() - RETENTION_DAYS * DAY_MS;
	const kept = (await readEntries(path)).filter((entry) => Date.parse(entry.at) >= oldestKept);
	await writeFile(path, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
}

function addUp(turns: LocalAgentTurnUsage[]): LocalAgentUsageTotals {
	return turns.reduce(
		(totals, turn) => ({
			turns: totals.turns + 1,
			inputTokens: totals.inputTokens + turn.inputTokens,
			outputTokens: totals.outputTokens + turn.outputTokens,
			estimatedCostUsd: totals.estimatedCostUsd + turn.estimatedCostUsd,
		}),
		{ turns: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
	);
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): [string, T[]][] {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}
	return [...groups.entries()];
}

function localDay(isoDate: string): string {
	const date = new Date(isoDate);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}
