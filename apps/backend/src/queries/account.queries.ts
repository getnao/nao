import s, { NewAccount } from '../db/abstractSchema';
import { db } from '../db/db';

export const createAccount = async (account: NewAccount): Promise<void> => {
	await db.insert(s.account).values(account).returning().execute();
};
