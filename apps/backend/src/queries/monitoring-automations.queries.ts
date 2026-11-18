import { and, eq, gte } from 'drizzle-orm';

import s, { type DBAutomationRun } from '../db/abstractSchema';
import { db } from '../db/db';

export type AutomationRunRecord = Pick<
	DBAutomationRun,
	'id' | 'automationId' | 'status' | 'trigger' | 'startedAt' | 'completedAt' | 'errorMessage' | 'chatId'
> & { automationTitle: string };

/** Every run of the project's automations started since the given date, oldest first. */
export const listProjectAutomationRunsSince = async (
	projectId: string,
	since: Date,
): Promise<AutomationRunRecord[]> => {
	return db
		.select({
			id: s.automationRun.id,
			automationId: s.automationRun.automationId,
			status: s.automationRun.status,
			trigger: s.automationRun.trigger,
			startedAt: s.automationRun.startedAt,
			completedAt: s.automationRun.completedAt,
			errorMessage: s.automationRun.errorMessage,
			chatId: s.automationRun.chatId,
			automationTitle: s.automation.title,
		})
		.from(s.automationRun)
		.innerJoin(s.automation, eq(s.automation.id, s.automationRun.automationId))
		.where(and(eq(s.automation.projectId, projectId), gte(s.automationRun.startedAt, since)))
		.orderBy(s.automationRun.startedAt)
		.execute();
};
