import app from './app';
import { assignAdminToOrphanedProject } from './queries/project.queries';

assignAdminToOrphanedProject()
	.then(() => {
		return app.listen({ host: '0.0.0.0', port: 5005 });
	})
	.then((address) => {
		console.log(`Server is running on ${address}`);
	})
	.catch((err) => {
		console.error('\n❌ Server failed to start:\n');
		console.error(`   ${err.message}\n`);
		process.exit(1);
	});
