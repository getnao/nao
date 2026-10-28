import type { NewWarehouseConnectionCheck } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';

export async function createWarehouseConnectionCheck(check: NewWarehouseConnectionCheck): Promise<void> {
	await db.insert(s.warehouseConnectionCheck).values(check).execute();
}
