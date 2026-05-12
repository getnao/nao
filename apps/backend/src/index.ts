import { startServer } from './app';

startServer({ port: 5005, host: '0.0.0.0' }).catch((err) => {
	console.error('\n❌ Server failed to start:\n');
	console.error(`   ${err.message}\n`);
	process.exit(1);
});
