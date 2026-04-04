import dbConfig from '../src/db/dbConfig';
import { runMigrations } from '../src/db/migrate';

await runMigrations({
	dbType: dbConfig.dialect,
	connectionString: dbConfig.dbUrl,
	migrationsPath: dbConfig.migrationsFolder,
});
