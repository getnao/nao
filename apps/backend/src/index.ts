import app from './app';

app.listen({ host: '0.0.0.0', port: 5005 })
	.then((address) => {
		console.log(`Server is running on ${address}`);
	})
	.catch((err) => {
		app.log.error(err);
		process.exit(1);
	});
