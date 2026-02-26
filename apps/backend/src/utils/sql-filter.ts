import { Dialect, init, isInitialized, isSelect, parse } from '@polyglot-sql/sdk';

let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
	if (!isInitialized()) {
		if (!initPromise) {
			initPromise = init().catch((err) => {
				initPromise = null;
				throw err;
			});
		}
		await initPromise;
	}
}

export async function isReadOnlySqlQuery(sql: string): Promise<boolean> {
	await ensureInitialized();
	const result = parse(sql, Dialect.Generic);
	if (!result.success || !result.ast) {
		return false;
	}
	// ast is an array-like object of statements; every statement must be a SELECT
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const statements: any[] = Object.values(result.ast);
	if (statements.length === 0) {
		return false;
	}
	return statements.every((stmt) => isSelect(stmt));
}
