import * as postgresSchema from './db/pg-schema';
import * as sqliteSchema from './db/sqlite-schema';

export const isPostgres = process.env.DB_SELECTED === 'postgres';

export const provider = isPostgres ? 'pg' : 'sqlite';
export const schema = isPostgres ? postgresSchema : sqliteSchema;

export const dialect = isPostgres ? 'postgresql' : 'sqlite';
export const migrationsFolder = isPostgres ? './migrations-postgres' : './migrations-sqlite';
export const schemaPath = isPostgres ? './src/db/pg-schema.ts' : './src/db/sqlite-schema.ts';
export const dbUrl = isPostgres ? process.env.DB_URL! : process.env.DB_FILE_NAME!;
