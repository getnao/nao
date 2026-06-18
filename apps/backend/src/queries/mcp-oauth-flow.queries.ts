import { eq, lt } from 'drizzle-orm';

import s, { DBMcpOauthFlow, NewMcpOauthFlow } from '../db/abstractSchema';
import { db } from '../db/db';

export const createMcpOauthFlow = async (flow: NewMcpOauthFlow): Promise<void> => {
	await db.insert(s.mcpOauthFlow).values(flow).execute();
};

export const getMcpOauthFlow = async (state: string): Promise<DBMcpOauthFlow | null> => {
	const [flow] = await db.select().from(s.mcpOauthFlow).where(eq(s.mcpOauthFlow.state, state)).execute();

	return flow ?? null;
};

export const deleteMcpOauthFlow = async (state: string): Promise<void> => {
	await db.delete(s.mcpOauthFlow).where(eq(s.mcpOauthFlow.state, state)).execute();
};

export const deleteExpiredMcpOauthFlows = async (now: Date): Promise<void> => {
	await db.delete(s.mcpOauthFlow).where(lt(s.mcpOauthFlow.expiresAt, now)).execute();
};
