export const execute_sql = async (query: string) => {
	const response = await fetch(`${process.env.FASTAPI_URL}/execute_sql`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		// TO DO : replace with only the query and get the project_id and credentials_path from cli config
		body: JSON.stringify({
			sql: query,
			project_id: '',
			credentials_path: '',
		}),
	});

	if (!response.ok) {
		throw new Error(`Error executing SQL query: ${response.statusText}`);
	}

	return response.json();
};
