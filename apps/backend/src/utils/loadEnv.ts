import path from 'node:path';

import dotenv from 'dotenv';

// Loads .env file at the root of the repository
dotenv.config({
	path: path.join(process.cwd(), '..', '..', '.env'),
});
