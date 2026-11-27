import { and, eq } from 'drizzle-orm';

import s, { DBProjectDecisionConfig, NewProjectDecisionConfig } from '../db/abstractSchema';
import { db } from '../db/db';
import type { DecisionProvider } from '../types/decision';

export const getProjectDecisionConfigs = async (projectId: string): Promise<DBProjectDecisionConfig[]> => {
	return db.select().from(s.projectDecisionConfig).where(eq(s.projectDecisionConfig.projectId, projectId)).execute();
};

export const upsertProjectDecisionConfig = async (
	config: Pick<NewProjectDecisionConfig, 'projectId' | 'provider' | 'apiKey' | 'credentials' | 'baseUrl'>,
): Promise<DBProjectDecisionConfig> => {
	const [saved] = await db
		.insert(s.projectDecisionConfig)
		.values(config)
		.onConflictDoUpdate({
			target: [s.projectDecisionConfig.projectId, s.projectDecisionConfig.provider],
			set: { apiKey: config.apiKey, credentials: config.credentials, baseUrl: config.baseUrl },
		})
		.returning()
		.execute();
	return saved;
};

export const deleteProjectDecisionConfig = async (projectId: string, provider: DecisionProvider): Promise<void> => {
	await db
		.delete(s.projectDecisionConfig)
		.where(and(eq(s.projectDecisionConfig.projectId, projectId), eq(s.projectDecisionConfig.provider, provider)))
		.execute();
};
