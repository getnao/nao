import { vi } from 'vitest';

type Callback = () => void | Promise<void>;

export const postgresDbConfigMock = {
	Dialect: { Postgres: 'postgres', Sqlite: 'sqlite' },
	default: { dialect: 'postgres' },
};

export function mockSelectQuery(rows: unknown[], beforeExecute?: Callback) {
	const builder = {
		from: () => builder,
		innerJoin: () => builder,
		leftJoin: () => builder,
		where: (_condition?: unknown) => builder,
		orderBy: () => builder,
		limit: () => builder,
		for: (_strength: string) => builder,
		execute: vi.fn(async () => {
			await beforeExecute?.();
			return rows;
		}),
	};
	return builder;
}

/** `onLock` only runs when the query is executed after `.for(strength)`, like a PostgreSQL row lock. */
export function mockLockingSelectQuery(rows: unknown[], onLock: (strength: string) => void | Promise<void>) {
	const builder = mockSelectQuery(rows);
	builder.for = (strength: string) => {
		builder.execute = vi.fn(async () => {
			await onLock(strength);
			return rows;
		});
		return builder;
	};
	return builder;
}

export function mockMutationQuery({
	result,
	beforeExecute,
	onSet,
}: {
	result?: unknown;
	beforeExecute?: Callback;
	onSet?: (values: Record<string, unknown>) => void;
} = {}) {
	const builder = {
		values: () => builder,
		set: (values: Record<string, unknown>) => {
			onSet?.(values);
			return builder;
		},
		where: () => builder,
		returning: () => builder,
		onConflictDoNothing: () => builder,
		execute: vi.fn(async () => {
			await beforeExecute?.();
			return result;
		}),
	};
	return builder;
}

export function recordEvent(events: string[], event: string) {
	return () => {
		events.push(event);
	};
}
