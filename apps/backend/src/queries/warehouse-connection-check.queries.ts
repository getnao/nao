import { desc, eq } from 'drizzle-orm';

import type { DBWarehouseConnectionCheck, NewWarehouseConnectionCheck } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';

export async function createWarehouseConnectionCheck(check: NewWarehouseConnectionCheck): Promise<void> {
	await db.insert(s.warehouseConnectionCheck).values(check).execute();
}

export async function getLatestWarehouseConnectionCheck(userId: string): Promise<DBWarehouseConnectionCheck | null> {
	const [check] = await db
		.select()
		.from(s.warehouseConnectionCheck)
		.where(eq(s.warehouseConnectionCheck.userId, userId))
		.orderBy(desc(s.warehouseConnectionCheck.createdAt))
		.limit(1)
		.execute();

	return check ?? null;
}
