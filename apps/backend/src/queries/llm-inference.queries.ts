import s, { NewLlmInference } from '../db/abstractSchema';
import { db } from '../db/db';

export const insertLlmInference = async (record: NewLlmInference): Promise<void> => {
	await db.insert(s.llmInference).values(record).execute();
};
