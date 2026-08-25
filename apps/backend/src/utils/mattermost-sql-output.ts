import type { SqlOutput } from '../types/messaging-provider';

export async function resolveMattermostSqlOutput(input: {
	queryId: string;
	sqlOutputs: Map<string, SqlOutput>;
	loadPersisted: (queryId: string) => Promise<SqlOutput | null>;
}): Promise<SqlOutput | undefined> {
	const inStream = input.sqlOutputs.get(input.queryId);
	if (inStream) {
		return inStream;
	}
	try {
		const persisted = await input.loadPersisted(input.queryId);
		if (!persisted) {
			return undefined;
		}
		input.sqlOutputs.set(input.queryId, persisted);
		return persisted;
	} catch {
		return undefined;
	}
}
