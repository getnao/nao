import { pathToFileURL } from 'node:url';

const METABASE_URL = process.env.METABASE_URL ?? 'http://localhost:3001';
const METABASE_API_KEY = process.env.METABASE_API_KEY;
const ADMIN_EMAIL = 'fixture-admin@getnao.local';
const ADMIN_PASSWORD = 'N4o!F1xture#Metabase$1636';
const ROOT_COLLECTION_NAME = 'nao Migration Fixtures';
const COLLECTION_NAME = 'Ecommerce';
const DASHBOARD_NAME = 'Native SQL Basics';
const LAYOUT_DASHBOARD_NAME = 'Layout and Tabs';
const FILTER_DASHBOARD_NAME = 'Filters and Templates';
const MBQL_DASHBOARD_NAME = 'GUI Query and Reusable Objects';
const VISUALIZATION_DASHBOARD_NAME = 'Visualization Breadth';
const ACCEPTANCE_DASHBOARD_NAME = 'Full Migration Acceptance';
const API_KEY_NAME = 'nao Migration Fixture';
const CATEGORY_PARAMETER_ID = 'category';
const PERIOD_PARAMETER_ID = 'period';
const ACCEPTANCE_CARD_COUNT = 30;
const API_STARTUP_TIMEOUT_MS = secondsFromEnvironment('METABASE_API_STARTUP_TIMEOUT_SECONDS', 180);
const SCHEMA_TIMEOUT_MS = secondsFromEnvironment('METABASE_SCHEMA_TIMEOUT_SECONDS', 180);
const REQUEST_TIMEOUT_MS = secondsFromEnvironment('METABASE_REQUEST_TIMEOUT_SECONDS', 30);
const POLL_INTERVAL_MS = 2_000;
let useApiKey = false;

async function bootstrap() {
	await waitForMetabase();
	const sessionId = await getSessionId();
	const database = await ensureDatabase(sessionId);
	const rootCollection = await ensureCollection(sessionId, ROOT_COLLECTION_NAME, null);
	const collection = await ensureCollection(sessionId, COLLECTION_NAME, rootCollection.id);
	const dashboard = await ensureDashboard(sessionId, collection.id, {
		name: DASHBOARD_NAME,
		description: 'A deterministic native-SQL dashboard used to verify Metabase-to-nao story migrations.',
		parameters: [],
	});
	const cards = await ensureCards(sessionId, collection.id, cardDefinitions(database.id));

	await ensureDashboardLayout(sessionId, dashboard.id, cards);
	await verifyCards(sessionId, cards);
	const layoutDashboard = await ensureDashboard(sessionId, collection.id, {
		name: LAYOUT_DASHBOARD_NAME,
		description: 'Tabbed rows, mixed widths, text, and visual cards for layout migration.',
		parameters: [],
	});
	await ensureDashboardLayout(sessionId, layoutDashboard.id, cards);

	const ordersTable = await getTableMetadata(sessionId, database.id, 'orders', ['ordered_at', 'status']);
	const orderedAtFieldId = getFieldId(ordersTable, 'ordered_at');
	const filterDashboard = await ensureDashboard(sessionId, collection.id, {
		name: FILTER_DASHBOARD_NAME,
		description: 'Native SQL template tags with selective dashboard filter wiring.',
		parameters: filterDashboardParameters(),
	});
	const filterCards = await ensureCards(
		sessionId,
		collection.id,
		filterCardDefinitions(database.id, orderedAtFieldId),
	);
	await ensureFilterDashboardLayout(sessionId, filterDashboard.id, filterCards);
	await verifyCards(sessionId, filterCards);
	await verifyDashboardFilters(sessionId, filterDashboard.id, filterCards);

	const mbqlDashboard = await ensureDashboard(sessionId, collection.id, {
		name: MBQL_DASHBOARD_NAME,
		description: 'GUI-built questions and reusable Metabase objects.',
		parameters: [],
	});
	const [completedOrdersModel] = await ensureCards(sessionId, collection.id, [
		completedOrdersModelDefinition(database.id),
	]);
	const completedOrdersSegment = await ensureSegment(
		sessionId,
		database.id,
		ordersTable.id,
		getFieldId(ordersTable, 'status'),
	);
	const mbqlCards = await ensureCards(
		sessionId,
		collection.id,
		mbqlCardDefinitions(
			database.id,
			ordersTable.id,
			getFieldId(ordersTable, 'status'),
			completedOrdersModel.id,
			completedOrdersSegment.id,
		),
	);
	await ensureSimpleDashboardLayout(sessionId, mbqlDashboard.id, mbqlCards);
	await verifyCards(sessionId, mbqlCards);
	await verifyMbqlCards(sessionId, mbqlCards);

	const visualizationDashboard = await ensureDashboard(sessionId, collection.id, {
		name: VISUALIZATION_DASHBOARD_NAME,
		description: 'Direct chart, map, formatting, and table migration fixtures.',
		parameters: [],
	});
	const visualizationCards = await ensureCards(
		sessionId,
		collection.id,
		visualizationCardDefinitions(database.id, ordersTable.id, orderedAtFieldId, getFieldId(ordersTable, 'status')),
	);
	await ensureSimpleDashboardLayout(sessionId, visualizationDashboard.id, visualizationCards);
	await verifyVisualizationCards(sessionId, visualizationCards);

	const acceptanceDashboard = await ensureDashboard(sessionId, collection.id, {
		name: ACCEPTANCE_DASHBOARD_NAME,
		description: 'All migration fixtures in one dashboard for side-by-side source and nao verification.',
		parameters: filterDashboardParameters(),
	});
	await ensureAcceptanceDashboardLayout(sessionId, acceptanceDashboard.id, {
		native: cards,
		filters: filterCards,
		reusable: mbqlCards,
		visualizations: visualizationCards,
	});
	await verifyDashboardFilters(sessionId, acceptanceDashboard.id, filterCards);

	const apiKey = useApiKey ? null : await ensureApiKey(sessionId);
	console.log(`Metabase fixture ready at ${METABASE_URL}/dashboard/${dashboard.id}`);
	console.log(`Layout fixture ready at ${METABASE_URL}/dashboard/${layoutDashboard.id}`);
	console.log(`Filter fixture ready at ${METABASE_URL}/dashboard/${filterDashboard.id}`);
	console.log(`MBQL fixture ready at ${METABASE_URL}/dashboard/${mbqlDashboard.id}`);
	console.log(`Visualization fixture ready at ${METABASE_URL}/dashboard/${visualizationDashboard.id}`);
	console.log(`Full acceptance fixture ready at ${METABASE_URL}/dashboard/${acceptanceDashboard.id}`);
	console.log(`Analytics database ID: ${database.id}`);
	if (useApiKey) {
		console.log('Authenticated with METABASE_API_KEY from the environment.');
	} else if (apiKey) {
		console.log(`METABASE_API_KEY=${apiKey}`);
		console.log('Copy this value into your local .env file. It will not be shown again.');
	} else {
		console.log('The fixture API key already exists. Keep the METABASE_API_KEY from its first creation.');
	}
}

async function waitForMetabase() {
	await pollRead('Metabase API startup', API_STARTUP_TIMEOUT_MS, async (remainingMs) => {
		const health = await request('/api/health', {
			timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remainingMs),
		});
		return health?.status === 'ok' ? health : null;
	});
}

async function getSessionId() {
	const properties = await request('/api/session/properties');

	if (properties['setup-token']) {
		const setup = await request('/api/setup', {
			method: 'POST',
			body: {
				token: properties['setup-token'],
				user: {
					email: ADMIN_EMAIL,
					first_name: 'nao',
					last_name: 'Fixture',
					password: ADMIN_PASSWORD,
				},
				prefs: {
					site_name: 'nao Metabase Migration Fixture',
					site_locale: 'en',
				},
			},
		});
		return setup.id;
	}

	if (METABASE_API_KEY) {
		useApiKey = true;
		return null;
	}

	const session = await request('/api/session', {
		method: 'POST',
		body: {
			username: ADMIN_EMAIL,
			password: ADMIN_PASSWORD,
		},
	});
	return session.id;
}

async function ensureDatabase(sessionId) {
	const databases = asList(await request('/api/database', { sessionId }));
	const existing = databases.find((database) => database.name === 'nao Ecommerce Analytics');
	if (existing) {
		return existing;
	}

	return request('/api/database', {
		method: 'POST',
		sessionId,
		body: {
			name: 'nao Ecommerce Analytics',
			engine: 'postgres',
			details: {
				host: 'analytics-db',
				port: 5432,
				dbname: 'analytics',
				user: 'analytics',
				password: 'analytics',
				ssl: false,
			},
			is_full_sync: true,
			is_on_demand: false,
		},
	});
}

async function getTableMetadata(sessionId, databaseId, tableName, fieldNames) {
	return pollRead(`Metabase schema metadata for ${tableName}`, SCHEMA_TIMEOUT_MS, async (remainingMs) => {
		const metadata = await request(`/api/database/${databaseId}/metadata`, {
			sessionId,
			timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remainingMs),
		});
		const table = metadata.tables?.find((candidate) => candidate.name === tableName);
		const availableFields = new Set(table?.fields?.map((field) => field.name));
		return table && fieldNames.every((fieldName) => availableFields.has(fieldName)) ? table : null;
	});
}

function getFieldId(table, fieldName) {
	const field = table.fields?.find((candidate) => candidate.name === fieldName);
	if (!field) {
		throw new Error(`Metabase field not found: ${table.name}.${fieldName}`);
	}
	return field.id;
}

async function ensureCollection(sessionId, name, parentId) {
	const collections = asList(await request('/api/collection', { sessionId }));
	const existing = collections.find((collection) => collection.name === name && collection.parent_id === parentId);
	if (existing) {
		return existing;
	}

	return request('/api/collection', {
		method: 'POST',
		sessionId,
		body: {
			name,
			parent_id: parentId,
		},
	});
}

async function ensureDashboard(sessionId, collectionId, definition) {
	const dashboards = asList(await request('/api/dashboard', { sessionId }));
	const existing = dashboards.find(
		(dashboard) => dashboard.name === definition.name && dashboard.collection_id === collectionId,
	);
	const body = {
		name: definition.name,
		description: definition.description,
		collection_id: collectionId,
		parameters: definition.parameters,
	};

	if (existing) {
		return request(`/api/dashboard/${existing.id}`, {
			method: 'PUT',
			sessionId,
			body,
		});
	}

	return request('/api/dashboard', {
		method: 'POST',
		sessionId,
		body,
	});
}

async function ensureCards(sessionId, collectionId, definitions) {
	const existingCards = asList(await request('/api/card?f=all', { sessionId }));
	const cards = [];

	for (const definition of definitions) {
		const existing = existingCards.find(
			(card) => card.name === definition.name && card.collection_id === collectionId,
		);
		const body = {
			...definition,
			collection_id: collectionId,
			type: definition.type ?? 'question',
		};
		const card = existing
			? await request(`/api/card/${existing.id}`, {
					method: 'PUT',
					sessionId,
					body,
				})
			: await request('/api/card', {
					method: 'POST',
					sessionId,
					body,
				});
		cards.push(card);
	}

	return cards;
}

async function ensureSegment(sessionId, databaseId, ordersTableId, statusFieldId) {
	const segments = asList(await request('/api/segment', { sessionId }));
	const existing = segments.find(
		(segment) => segment.name === 'Completed orders segment' && segment.table_id === ordersTableId,
	);
	if (existing) {
		return existing;
	}
	return request('/api/segment', {
		method: 'POST',
		sessionId,
		body: {
			name: 'Completed orders segment',
			description: 'Orders whose status is completed.',
			table_id: ordersTableId,
			definition: {
				type: 'query',
				database: databaseId,
				query: {
					'source-table': ordersTableId,
					filter: ['=', ['field', statusFieldId, null], 'completed'],
				},
			},
		},
	});
}

async function ensureDashboardLayout(sessionId, dashboardId, cards) {
	const dashboard = await request(`/api/dashboard/${dashboardId}`, { sessionId });
	let temporaryId = -1;
	const tabs = ['Overview', 'Details'].map((name) => ({
		id: dashboard.tabs?.find((tab) => tab.name === name)?.id ?? temporaryId--,
		name,
	}));
	const positions = [
		{ dashboard_tab_id: tabs[0].id, row: 2, col: 0, size_x: 6, size_y: 4 },
		{ dashboard_tab_id: tabs[0].id, row: 2, col: 6, size_x: 12, size_y: 8 },
		{ dashboard_tab_id: tabs[1].id, row: 0, col: 0, size_x: 9, size_y: 8 },
		{ dashboard_tab_id: tabs[1].id, row: 0, col: 9, size_x: 9, size_y: 8 },
		{ dashboard_tab_id: tabs[1].id, row: 8, col: 0, size_x: 9, size_y: 8 },
	];
	const dashcards = cards.map((card, index) => {
		const existing = dashboard.dashcards.find((dashcard) => dashcard.card_id === card.id);
		return {
			id: existing?.id ?? temporaryId--,
			card_id: card.id,
			...positions[index],
			parameter_mappings: [],
			visualization_settings: {},
			series: [],
		};
	});
	const existingText = dashboard.dashcards.find(
		(dashcard) => dashcard.visualization_settings?.virtual_card?.display === 'text',
	);
	dashcards.unshift({
		id: existingText?.id ?? temporaryId--,
		card_id: null,
		dashboard_tab_id: tabs[0].id,
		row: 0,
		col: 0,
		size_x: 18,
		size_y: 2,
		parameter_mappings: [],
		visualization_settings: {
			virtual_card: {
				name: null,
				display: 'text',
				dataset_query: {},
				visualization_settings: {
					text: '# Ecommerce performance\nCompleted-order revenue for the 2025 fixture year.',
				},
			},
		},
		series: [],
	});

	await request(`/api/dashboard/${dashboardId}`, {
		method: 'PUT',
		sessionId,
		body: {
			dashcards,
			tabs,
		},
	});

	const updated = await request(`/api/dashboard/${dashboardId}`, { sessionId });
	const tabNames = updated.tabs.map((tab) => tab.name);
	if (JSON.stringify(tabNames) !== JSON.stringify(['Overview', 'Details'])) {
		throw new Error(`Dashboard tabs do not match fixture: ${JSON.stringify(tabNames)}`);
	}
	const tabNameById = new Map(updated.tabs.map((tab) => [tab.id, tab.name]));
	for (const [index, card] of cards.entries()) {
		const dashcard = updated.dashcards.find((candidate) => candidate.card_id === card.id);
		const expectedTab = index < 2 ? 'Overview' : 'Details';
		if (!dashcard || tabNameById.get(dashcard.dashboard_tab_id) !== expectedTab) {
			throw new Error(`Card "${card.name}" is not in the ${expectedTab} tab.`);
		}
	}
}

async function ensureFilterDashboardLayout(sessionId, dashboardId, cards) {
	const dashboard = await request(`/api/dashboard/${dashboardId}`, { sessionId });
	let temporaryId = -1;
	const positions = [
		{ row: 0, col: 0, size_x: 6, size_y: 4 },
		{ row: 0, col: 6, size_x: 12, size_y: 8 },
		{ row: 8, col: 0, size_x: 18, size_y: 8 },
	];
	const dashcards = cards.map((card, index) => {
		const existing = dashboard.dashcards.find((dashcard) => dashcard.card_id === card.id);
		return {
			id: existing?.id ?? temporaryId--,
			card_id: card.id,
			dashboard_tab_id: null,
			...positions[index],
			parameter_mappings: filterParameterMappings(card.id, index),
			visualization_settings: {},
			series: [],
		};
	});

	await request(`/api/dashboard/${dashboardId}`, {
		method: 'PUT',
		sessionId,
		body: { dashcards, tabs: [] },
	});

	const updated = await request(`/api/dashboard/${dashboardId}`, { sessionId });
	for (const [index, card] of cards.entries()) {
		const dashcard = updated.dashcards.find((candidate) => candidate.card_id === card.id);
		const parameterIds = dashcard?.parameter_mappings.map((mapping) => mapping.parameter_id).sort() ?? [];
		const expectedParameterIds =
			index === 0 ? [CATEGORY_PARAMETER_ID, PERIOD_PARAMETER_ID] : index === 1 ? [PERIOD_PARAMETER_ID] : [];
		if (JSON.stringify(parameterIds) !== JSON.stringify(expectedParameterIds)) {
			throw new Error(`Card "${card.name}" has incorrect filter wiring.`);
		}
	}
}

function filterParameterMappings(cardId, index) {
	return [
		...(index < 2
			? [
					{
						parameter_id: PERIOD_PARAMETER_ID,
						card_id: cardId,
						target: ['dimension', ['template-tag', PERIOD_PARAMETER_ID]],
					},
				]
			: []),
		...(index === 0
			? [
					{
						parameter_id: CATEGORY_PARAMETER_ID,
						card_id: cardId,
						target: ['variable', ['template-tag', CATEGORY_PARAMETER_ID]],
					},
				]
			: []),
	];
}

async function ensureSimpleDashboardLayout(sessionId, dashboardId, cards) {
	const dashboard = await request(`/api/dashboard/${dashboardId}`, { sessionId });
	let temporaryId = -1;
	const dashcards = cards.map((card, index) => {
		const existing = dashboard.dashcards.find((dashcard) => dashcard.card_id === card.id);
		return {
			id: existing?.id ?? temporaryId--,
			card_id: card.id,
			dashboard_tab_id: null,
			row: index * 8,
			col: 0,
			size_x: 18,
			size_y: 8,
			parameter_mappings: [],
			visualization_settings: {},
			series: [],
		};
	});
	await request(`/api/dashboard/${dashboardId}`, {
		method: 'PUT',
		sessionId,
		body: { dashcards, tabs: [] },
	});
}

async function ensureAcceptanceDashboardLayout(sessionId, dashboardId, cardGroups) {
	const dashboard = await request(`/api/dashboard/${dashboardId}`, { sessionId });
	let temporaryId = -1;
	const groups = [
		{ name: 'Native SQL', cards: cardGroups.native },
		{ name: 'Filters', cards: cardGroups.filters },
		{ name: 'Reusable Objects', cards: cardGroups.reusable },
		{ name: 'Visualizations', cards: cardGroups.visualizations },
	];
	const tabs = groups.map((group) => ({
		id: dashboard.tabs?.find((tab) => tab.name === group.name)?.id ?? temporaryId--,
		name: group.name,
	}));
	const dashcards = groups.flatMap((group, groupIndex) =>
		group.cards.map((card, cardIndex) => {
			const existing = dashboard.dashcards.find((dashcard) => dashcard.card_id === card.id);
			return {
				id: existing?.id ?? temporaryId--,
				card_id: card.id,
				dashboard_tab_id: tabs[groupIndex].id,
				row: (groupIndex === 0 ? 2 : 0) + Math.floor(cardIndex / 2) * 8,
				col: (cardIndex % 2) * 9,
				size_x: 9,
				size_y: 8,
				parameter_mappings: group.name === 'Filters' ? filterParameterMappings(card.id, cardIndex) : [],
				visualization_settings: {},
				series: [],
			};
		}),
	);
	const existingText = dashboard.dashcards.find(
		(dashcard) => dashcard.visualization_settings?.virtual_card?.display === 'text',
	);
	dashcards.unshift({
		id: existingText?.id ?? temporaryId--,
		card_id: null,
		dashboard_tab_id: tabs[0].id,
		row: 0,
		col: 0,
		size_x: 18,
		size_y: 2,
		parameter_mappings: [],
		visualization_settings: {
			virtual_card: {
				name: null,
				display: 'text',
				dataset_query: {},
				visualization_settings: {
					text: '# Full migration acceptance\nEvery supported and intentionally unsupported fixture.',
				},
			},
		},
		series: [],
	});

	await request(`/api/dashboard/${dashboardId}`, {
		method: 'PUT',
		sessionId,
		body: { dashcards, tabs },
	});

	const updated = await request(`/api/dashboard/${dashboardId}`, { sessionId });
	const expectedTabNames = groups.map((group) => group.name);
	const expectedCardIds = groups
		.flatMap((group) => group.cards.map((card) => card.id))
		.sort((left, right) => left - right);
	const actualCardIds = updated.dashcards
		.map((dashcard) => dashcard.card_id)
		.filter((cardId) => cardId !== null)
		.sort((left, right) => left - right);
	if (
		expectedCardIds.length !== ACCEPTANCE_CARD_COUNT ||
		JSON.stringify(updated.tabs.map((tab) => tab.name)) !== JSON.stringify(expectedTabNames) ||
		JSON.stringify(actualCardIds) !== JSON.stringify(expectedCardIds)
	) {
		throw new Error('Full acceptance dashboard does not contain the complete fixture matrix.');
	}
}

async function verifyCards(sessionId, cards) {
	for (const card of cards) {
		const result = await request(`/api/card/${card.id}/query`, {
			method: 'POST',
			sessionId,
			body: {
				ignore_cache: true,
				parameters: [],
			},
		});
		if (result.status !== 'completed') {
			throw new Error(`Card "${card.name}" did not complete: ${JSON.stringify(result)}`);
		}
	}
}

async function verifyMbqlCards(sessionId, cards) {
	for (const card of cards) {
		const result = await request(`/api/card/${card.id}/query`, {
			method: 'POST',
			sessionId,
			body: { ignore_cache: true, parameters: [] },
		});
		if (!result.data?.native_form?.query || result.data.rows.length === 0) {
			throw new Error(`MBQL card "${card.name}" did not return compiled SQL and rows.`);
		}
		if (
			card.name === 'Orders by status' &&
			JSON.stringify(result.data.rows) !==
				JSON.stringify([
					['completed', 18],
					['pending', 3],
					['refunded', 3],
				])
		) {
			throw new Error(`MBQL card "${card.name}" did not match its result oracle.`);
		}
		if (
			['Completed order count metric', 'Completed orders from segment'].includes(card.name) &&
			JSON.stringify(result.data.rows) !== JSON.stringify([[18]])
		) {
			throw new Error(`Reusable object card "${card.name}" did not match its result oracle.`);
		}
		if (
			card.name === 'Completed orders from model' &&
			(result.data.rows.length !== 5 || result.data.rows.some((row) => row[3] !== 'completed'))
		) {
			throw new Error(`Model-backed card "${card.name}" did not match its result oracle.`);
		}
	}
}

async function verifyVisualizationCards(sessionId, cards) {
	const expectations = {
		'Completed revenue share pie': {
			display: 'pie',
			rowCount: 4,
			totalColumns: [1],
			total: 5835,
			settings: { 'pie.show_total': false },
		},
		'Completed revenue share donut': {
			display: 'pie',
			rowCount: 4,
			totalColumns: [1],
			total: 5835,
			settings: { 'pie.show_total': true },
		},
		'Monthly revenue mix': {
			display: 'area',
			rowCount: 12,
			totalColumns: [1, 2],
			total: 5835,
			settings: { 'stackable.stack_type': 'stacked' },
		},
		'Monthly revenue mix normalized': {
			display: 'area',
			rowCount: 12,
			totalColumns: [1, 2],
			total: 5835,
			settings: { 'stackable.stack_type': 'normalized' },
		},
		'Monthly revenue comparison': {
			display: 'smartscalar',
			rowCount: 12,
			totalColumns: [1],
			total: 5835,
			settings: {
				'scalar.comparisons': [{ id: '5b13a4f6-cae5-48ba-bba6-ebcc7cfa8be3', type: 'previousPeriod' }],
			},
		},
		'Monthly revenue and orders': {
			display: 'combo',
			rowCount: 12,
			totalColumns: [1],
			total: 5835,
			settings: { 'graph.dimensions': ['month'] },
		},
		'Completed revenue gauge': {
			display: 'gauge',
			rowCount: 1,
			totalColumns: [0],
			total: 5835,
			settings: {
				'gauge.segments': [
					{ min: 0, max: 3000, color: '#ED6E6E', label: 'Below target' },
					{ min: 3000, max: 5000, color: '#F9D45C', label: 'Near target' },
					{ min: 5000, max: 8000, color: '#84BB4C', label: 'On target' },
				],
			},
		},
		'Completed orders progress': {
			display: 'progress',
			rowCount: 1,
			totalColumns: [0],
			total: 18,
			settings: { 'progress.goal': 24 },
		},
		'Product price and demand': {
			display: 'scatter',
			rowCount: 8,
			totalColumns: [2],
			total: 63,
			settings: { 'graph.x_axis.scale': 'linear' },
		},
		'Customer revenue map': {
			display: 'map',
			rowCount: 8,
			totalColumns: [3],
			total: 5835,
			settings: { 'map.type': 'pin' },
		},
		'Formatted category revenue': {
			display: 'table',
			rowCount: 4,
			totalColumns: [1],
			total: 5835,
			settings: {
				'table.column_formatting': [
					{
						columns: ['revenue'],
						type: 'range',
						min_color: '#C6E6FB',
						max_color: '#509EE3',
					},
					{
						columns: ['revenue'],
						type: 'single',
						operator: '>',
						value: 1500,
						color: '#ED6E6E',
					},
				],
			},
		},
		'Revenue by category and status stacked': {
			display: 'bar',
			rowCount: 4,
			totalColumns: [1, 2, 3],
			total: 7815,
			settings: { 'stackable.stack_type': 'stacked' },
		},
		'Revenue by category and status': {
			display: 'row',
			rowCount: 4,
			totalColumns: [1, 2, 3],
			total: 7815,
			settings: { 'stackable.stack_type': 'normalized' },
		},
		'Monthly completed revenue waterfall': {
			display: 'waterfall',
			rowCount: 12,
			totalColumns: [1],
			total: 5835,
			settings: { 'graph.metrics': ['revenue'] },
		},
		'Revenue flow by category and status': {
			display: 'sankey',
			rowCount: 11,
			totalColumns: [2],
			total: 7815,
			settings: { 'sankey.value': 'revenue' },
		},
		'Orders pivot by month and status': {
			display: 'pivot',
			rowCount: 34,
			totalColumns: [3],
			total: 96,
			settings: {
				'pivot_table.column_split': {
					rows: ['ordered_at'],
					columns: ['status'],
					values: ['count'],
				},
			},
		},
		'Order value distribution by category': {
			display: 'boxplot',
			rowCount: 48,
			totalColumns: [2],
			total: 7815,
			settings: { 'boxplot.show_mean': true },
		},
		'Most recent order detail': {
			display: 'object',
			rowCount: 1,
			totalColumns: [0],
			total: 24,
			settings: {
				'table.columns': [
					{ enabled: true, name: 'order_id' },
					{ enabled: true, name: 'customer' },
					{ enabled: true, name: 'ordered_at' },
					{ enabled: true, name: 'status' },
				],
			},
		},
	};

	for (const card of cards) {
		const expectation = expectations[card.name];
		if (!expectation) {
			throw new Error(`Missing visualization oracle for "${card.name}".`);
		}
		const result = await request(`/api/card/${card.id}/query`, {
			method: 'POST',
			sessionId,
			body: { ignore_cache: true, parameters: [] },
		});
		const rows = result.data?.rows;
		if (result.status !== 'completed' || !Array.isArray(rows)) {
			throw new Error(`Visualization card "${card.name}" did not complete.`);
		}
		const total = rows.reduce(
			(sum, row) => sum + expectation.totalColumns.reduce((rowSum, column) => rowSum + Number(row[column]), 0),
			0,
		);
		if (
			rows.length !== expectation.rowCount ||
			Math.abs(total - expectation.total) > 0.001 ||
			card.display !== expectation.display
		) {
			throw new Error(`Visualization card "${card.name}" did not match its result oracle.`);
		}
		for (const [key, value] of Object.entries(expectation.settings)) {
			if (JSON.stringify(card.visualization_settings[key]) !== JSON.stringify(value)) {
				throw new Error(`Visualization card "${card.name}" did not preserve "${key}".`);
			}
		}
	}
}

async function verifyDashboardFilters(sessionId, dashboardId, cards) {
	const dashboard = await request(`/api/dashboard/${dashboardId}`, { sessionId });
	for (const card of cards) {
		const unfiltered = await request(`/api/card/${card.id}/query`, {
			method: 'POST',
			sessionId,
			body: { ignore_cache: true, parameters: [] },
		});
		const dashcard = dashboard.dashcards.find((candidate) => candidate.card_id === card.id);
		if (!dashcard) {
			throw new Error(`Dashboard card not found for "${card.name}".`);
		}
		for (const mapping of dashcard.parameter_mappings) {
			const filtered = await request(
				`/api/dashboard/${dashboardId}/dashcard/${dashcard.id}/card/${card.id}/query`,
				{
					method: 'POST',
					sessionId,
					body: {
						ignore_cache: true,
						dashboard_id: dashboardId,
						parameters: [filterParameter(mapping)],
					},
				},
			);
			if (
				filtered.status !== 'completed' ||
				JSON.stringify(filtered.data?.rows) === JSON.stringify(unfiltered.data?.rows)
			) {
				throw new Error(`Filter "${mapping.parameter_id}" did not change card "${card.name}".`);
			}
		}
	}
}

function filterParameter(mapping) {
	if (mapping.parameter_id === CATEGORY_PARAMETER_ID) {
		return {
			id: CATEGORY_PARAMETER_ID,
			type: 'string/=',
			value: ['Electronics'],
			target: mapping.target,
		};
	}
	return {
		id: PERIOD_PARAMETER_ID,
		type: 'date/range',
		value: '2025-01-01~2025-06-30',
		target: mapping.target,
	};
}

async function ensureApiKey(sessionId) {
	const apiKeys = asList(await request('/api/api-key', { sessionId }));
	if (apiKeys.some((apiKey) => apiKey.name === API_KEY_NAME)) {
		return null;
	}

	const groups = asList(await request('/api/permissions/group', { sessionId }));
	const administrators = groups.find((group) => group.name === 'Administrators');
	if (!administrators) {
		throw new Error('Metabase Administrators permission group was not found');
	}

	const created = await request('/api/api-key', {
		method: 'POST',
		sessionId,
		body: {
			name: API_KEY_NAME,
			group_id: administrators.id,
		},
	});
	return created.unmasked_key ?? created.key;
}

function cardDefinitions(databaseId) {
	return [
		{
			name: 'Total completed revenue',
			description: 'Gross revenue from completed orders.',
			display: 'scalar',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS total_revenue
FROM order_items AS oi
JOIN orders AS o ON o.id = oi.order_id
WHERE o.status = 'completed'`,
			),
			visualization_settings: {
				number_style: 'currency',
				currency: 'USD',
				currency_style: 'symbol',
				decimals: 2,
			},
		},
		{
			name: 'Monthly completed revenue',
			description: 'Completed-order revenue by month.',
			display: 'line',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT date_trunc('month', o.ordered_at)::date AS month,
       SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS revenue
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
WHERE o.status = 'completed'
GROUP BY 1
ORDER BY 1`,
			),
			visualization_settings: {
				'graph.dimensions': ['month'],
				'graph.metrics': ['revenue'],
			},
		},
		{
			name: 'Completed revenue by category',
			description: 'Completed-order revenue grouped by product category.',
			display: 'bar',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT c.name AS category,
       SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS revenue
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id
JOIN categories AS c ON c.id = p.category_id
WHERE o.status = 'completed'
GROUP BY c.name
ORDER BY revenue DESC`,
			),
			visualization_settings: {
				'graph.dimensions': ['category'],
				'graph.metrics': ['revenue'],
			},
		},
		{
			name: 'Top customers by completed revenue',
			description: 'The five customers with the highest completed-order revenue.',
			display: 'table',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT c.name AS customer,
       c.region,
       COUNT(DISTINCT o.id)::integer AS completed_orders,
       SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS revenue
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN customers AS c ON c.id = o.customer_id
WHERE o.status = 'completed'
GROUP BY c.id, c.name, c.region
ORDER BY revenue DESC, c.name
LIMIT 5`,
			),
			visualization_settings: {},
		},
		{
			name: 'Completed revenue funnel',
			description: 'An intentionally unsupported visualization used to verify partial reports.',
			display: 'funnel',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT c.name AS stage,
       SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS value
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id
JOIN categories AS c ON c.id = p.category_id
WHERE o.status = 'completed'
GROUP BY c.name
ORDER BY value DESC`,
			),
			visualization_settings: {
				'funnel.metric': 'value',
				'funnel.dimension': 'stage',
			},
		},
	];
}

function filterDashboardParameters() {
	return [
		{
			id: PERIOD_PARAMETER_ID,
			name: 'Period',
			slug: PERIOD_PARAMETER_ID,
			type: 'date/range',
			sectionId: 'date',
			required: false,
		},
		{
			id: CATEGORY_PARAMETER_ID,
			name: 'Category',
			slug: CATEGORY_PARAMETER_ID,
			type: 'string/=',
			sectionId: 'string',
			default: ['Electronics'],
			required: true,
		},
	];
}

function visualizationCardDefinitions(databaseId, ordersTableId, orderedAtFieldId, statusFieldId) {
	const categoryRevenueQuery = `SELECT c.name AS category,
       SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS revenue
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id
JOIN categories AS c ON c.id = p.category_id
WHERE o.status = 'completed'
GROUP BY c.name
ORDER BY revenue DESC`;
	const monthlyRevenueQuery = `SELECT date_trunc('month', o.ordered_at)::date AS month,
       SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS revenue
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
WHERE o.status = 'completed'
GROUP BY 1
ORDER BY 1`;
	const monthlyRevenueMixQuery = `SELECT date_trunc('month', o.ordered_at)::date AS month,
       COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE c.name = 'Electronics'), 0)::numeric(12, 2) AS electronics,
       COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE c.name <> 'Electronics'), 0)::numeric(12, 2) AS other
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id
JOIN categories AS c ON c.id = p.category_id
WHERE o.status = 'completed'
GROUP BY 1
ORDER BY 1`;
	const categoryRevenueByStatusQuery = `SELECT c.name AS category,
       COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE o.status = 'completed'), 0)::numeric(12, 2) AS completed,
       COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE o.status = 'pending'), 0)::numeric(12, 2) AS pending,
       COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE o.status = 'refunded'), 0)::numeric(12, 2) AS refunded
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id
JOIN categories AS c ON c.id = p.category_id
GROUP BY c.name
ORDER BY c.name`;
	return [
		{
			name: 'Completed revenue share pie',
			description: 'Completed revenue split by product category.',
			display: 'pie',
			dataset_query: nativeQuery(databaseId, categoryRevenueQuery),
			visualization_settings: {
				'pie.dimension': 'category',
				'pie.metric': 'revenue',
				'pie.show_total': false,
				'pie.show_labels': true,
				'pie.percent_visibility': 'inside',
				'pie.colors': {
					Electronics: '#509EE3',
					Outdoors: '#88BF4D',
					Home: '#F9CF48',
					Accessories: '#A989C5',
				},
			},
		},
		{
			name: 'Completed revenue share donut',
			description: 'Completed revenue split by product category with a center total.',
			display: 'pie',
			dataset_query: nativeQuery(databaseId, categoryRevenueQuery),
			visualization_settings: {
				'pie.dimension': 'category',
				'pie.metric': 'revenue',
				'pie.show_total': true,
				'pie.show_labels': true,
				'pie.percent_visibility': 'legend',
			},
		},
		{
			name: 'Monthly revenue mix',
			description: 'Completed monthly revenue split between electronics and other categories.',
			display: 'area',
			dataset_query: nativeQuery(databaseId, monthlyRevenueMixQuery),
			visualization_settings: {
				'graph.dimensions': ['month'],
				'graph.metrics': ['electronics', 'other'],
				'stackable.stack_type': 'stacked',
				'graph.show_values': true,
				series_settings: {
					electronics: { color: '#509EE3', title: 'Electronics' },
					other: { color: '#88BF4D', title: 'Other categories' },
				},
			},
		},
		{
			name: 'Monthly revenue mix normalized',
			description: 'One-hundred-percent stacked monthly revenue composition.',
			display: 'area',
			dataset_query: nativeQuery(databaseId, monthlyRevenueMixQuery),
			visualization_settings: {
				'graph.dimensions': ['month'],
				'graph.metrics': ['electronics', 'other'],
				'stackable.stack_type': 'normalized',
				'graph.show_values': true,
			},
		},
		{
			name: 'Monthly revenue comparison',
			description: 'Completed revenue with previous-period comparison.',
			display: 'smartscalar',
			dataset_query: nativeQuery(databaseId, monthlyRevenueQuery),
			visualization_settings: {
				'scalar.field': 'revenue',
				'scalar.comparisons': [{ id: '5b13a4f6-cae5-48ba-bba6-ebcc7cfa8be3', type: 'previousPeriod' }],
				column_settings: {
					'["name","revenue"]': {
						number_style: 'currency',
						currency: 'USD',
						currency_style: 'symbol',
						decimals: 2,
					},
				},
			},
		},
		{
			name: 'Monthly revenue and orders',
			description: 'Completed revenue and order count on separate axes.',
			display: 'combo',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT date_trunc('month', o.ordered_at)::date AS month,
       SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS revenue,
       COUNT(DISTINCT o.id)::integer AS completed_orders
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
WHERE o.status = 'completed'
GROUP BY 1
ORDER BY 1`,
			),
			visualization_settings: {
				'graph.dimensions': ['month'],
				'graph.metrics': ['revenue', 'completed_orders'],
				'graph.x_axis.title_text': 'Month',
				'graph.y_axis.title_text': 'Revenue',
				'graph.y_axis.auto_range': true,
				series_settings: {
					revenue: { display: 'bar', axis: 'left', color: '#509EE3', title: 'Revenue' },
					completed_orders: {
						display: 'line',
						axis: 'right',
						color: '#EF8C8C',
						title: 'Completed orders',
					},
				},
				column_settings: {
					'["name","revenue"]': {
						number_style: 'currency',
						currency: 'USD',
						currency_style: 'symbol',
						decimals: 2,
					},
				},
			},
		},
		{
			name: 'Completed revenue gauge',
			description: 'Completed revenue measured against deterministic ranges.',
			display: 'gauge',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS revenue
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
WHERE o.status = 'completed'`,
			),
			visualization_settings: {
				'gauge.segments': [
					{ min: 0, max: 3000, color: '#ED6E6E', label: 'Below target' },
					{ min: 3000, max: 5000, color: '#F9D45C', label: 'Near target' },
					{ min: 5000, max: 8000, color: '#84BB4C', label: 'On target' },
				],
			},
		},
		{
			name: 'Completed orders progress',
			description: 'Completed orders compared with the 24-order fixture goal.',
			display: 'progress',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT COUNT(*)::integer AS completed_orders
FROM orders
WHERE status = 'completed'`,
			),
			visualization_settings: {
				'progress.goal': 24,
				'progress.color': '#509EE3',
			},
		},
		{
			name: 'Product price and demand',
			description: 'Completed units ordered at each product price.',
			display: 'scatter',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT p.name AS product,
       p.price,
       SUM(oi.quantity)::integer AS completed_units
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id
WHERE o.status = 'completed'
GROUP BY p.id, p.name, p.price
ORDER BY p.price`,
			),
			visualization_settings: {
				'graph.dimensions': ['price'],
				'graph.metrics': ['completed_units'],
				'graph.x_axis.scale': 'linear',
				'graph.x_axis.title_text': 'Product price',
				'graph.y_axis.title_text': 'Completed units',
			},
		},
		{
			name: 'Customer revenue map',
			description: 'Completed revenue at each customer location.',
			display: 'map',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT c.name AS customer,
       c.latitude,
       c.longitude,
       SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS revenue
FROM customers AS c
JOIN orders AS o ON o.customer_id = c.id
JOIN order_items AS oi ON oi.order_id = o.id
WHERE o.status = 'completed'
GROUP BY c.id, c.name, c.latitude, c.longitude
ORDER BY c.name`,
			),
			visualization_settings: {
				'map.type': 'pin',
				'map.latitude_column': 'latitude',
				'map.longitude_column': 'longitude',
				'map.metric_column': 'revenue',
			},
		},
		{
			name: 'Formatted category revenue',
			description: 'Currency formatting and a revenue color scale.',
			display: 'table',
			dataset_query: nativeQuery(databaseId, categoryRevenueQuery),
			visualization_settings: {
				column_settings: {
					'["name","revenue"]': {
						number_style: 'currency',
						currency: 'USD',
						currency_style: 'symbol',
						decimals: 2,
					},
				},
				'table.column_formatting': [
					{
						columns: ['revenue'],
						type: 'range',
						min_color: '#C6E6FB',
						max_color: '#509EE3',
					},
					{
						columns: ['revenue'],
						type: 'single',
						operator: '>',
						value: 1500,
						color: '#ED6E6E',
					},
				],
			},
		},
		{
			name: 'Revenue by category and status stacked',
			description: 'Stacked vertical bars for revenue composition by order status.',
			display: 'bar',
			dataset_query: nativeQuery(databaseId, categoryRevenueByStatusQuery),
			visualization_settings: {
				'graph.dimensions': ['category'],
				'graph.metrics': ['completed', 'pending', 'refunded'],
				'stackable.stack_type': 'stacked',
				'graph.show_values': true,
			},
		},
		{
			name: 'Revenue by category and status',
			description: 'Normalized horizontal bars for revenue composition by order status.',
			display: 'row',
			dataset_query: nativeQuery(databaseId, categoryRevenueByStatusQuery),
			visualization_settings: {
				'graph.dimensions': ['category'],
				'graph.metrics': ['completed', 'pending', 'refunded'],
				'stackable.stack_type': 'normalized',
				'graph.show_values': true,
			},
		},
		{
			name: 'Monthly completed revenue waterfall',
			description: 'Completed revenue changes accumulated across fixture months.',
			display: 'waterfall',
			dataset_query: nativeQuery(databaseId, monthlyRevenueQuery),
			visualization_settings: {
				'graph.dimensions': ['month'],
				'graph.metrics': ['revenue'],
				'graph.show_values': true,
			},
		},
		{
			name: 'Revenue flow by category and status',
			description: 'Revenue flowing from product category to order status.',
			display: 'sankey',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT c.name AS category,
       o.status,
       SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS revenue
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id
JOIN categories AS c ON c.id = p.category_id
GROUP BY c.name, o.status
ORDER BY c.name, o.status`,
			),
			visualization_settings: {
				'sankey.source': 'category',
				'sankey.target': 'status',
				'sankey.value': 'revenue',
				'sankey.node_align': 'justify',
				'sankey.show_edge_labels': true,
			},
		},
		{
			name: 'Orders pivot by month and status',
			description: 'Order counts pivoted by month and status using an MBQL query.',
			display: 'pivot',
			dataset_query: {
				type: 'query',
				database: databaseId,
				query: {
					'source-table': ordersTableId,
					aggregation: [['count']],
					breakout: [
						['field', orderedAtFieldId, { 'temporal-unit': 'month' }],
						['field', statusFieldId, null],
					],
				},
			},
			visualization_settings: {
				'pivot_table.column_split': {
					rows: ['ordered_at'],
					columns: ['status'],
					values: ['count'],
				},
			},
		},
		{
			name: 'Order value distribution by category',
			description: 'Order-value distribution and outliers grouped by category.',
			display: 'boxplot',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT c.name AS category,
       o.id AS order_id,
       SUM(oi.quantity * oi.unit_price)::numeric(12, 2) AS order_value
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id
JOIN categories AS c ON c.id = p.category_id
GROUP BY c.name, o.id
ORDER BY c.name, o.id`,
			),
			visualization_settings: {
				'graph.dimensions': ['category'],
				'graph.metrics': ['order_value'],
				'boxplot.points_mode': 'outliers',
				'boxplot.show_mean': true,
				'boxplot.show_values_mode': 'median',
			},
		},
		{
			name: 'Most recent order detail',
			description: 'A single-record object view of the latest fixture order.',
			display: 'object',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT o.id AS order_id,
       c.name AS customer,
       o.ordered_at,
       o.status
FROM orders AS o
JOIN customers AS c ON c.id = o.customer_id
ORDER BY o.ordered_at DESC, o.id DESC
LIMIT 1`,
			),
			visualization_settings: {
				'table.columns': [
					{ enabled: true, name: 'order_id' },
					{ enabled: true, name: 'customer' },
					{ enabled: true, name: 'ordered_at' },
					{ enabled: true, name: 'status' },
				],
			},
		},
	];
}

function filterCardDefinitions(databaseId, orderedAtFieldId) {
	const templateTags = {
		...periodTemplateTag(orderedAtFieldId),
		...categoryTemplateTag(),
	};
	return [
		{
			name: 'Filtered completed revenue',
			description: 'Completed revenue filtered by period and category.',
			display: 'scalar',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT SUM(order_items.quantity * order_items.unit_price)::numeric(12, 2) AS total_revenue
FROM orders
JOIN order_items ON order_items.order_id = orders.id
JOIN products ON products.id = order_items.product_id
JOIN categories ON categories.id = products.category_id
WHERE orders.status = 'completed'
[[AND {{period}}]]
[[AND categories.name = {{category}}]]`,
				templateTags,
			),
			visualization_settings: {
				number_style: 'currency',
				currency: 'USD',
				currency_style: 'symbol',
				decimals: 2,
			},
		},
		{
			name: 'Filtered monthly completed revenue',
			description: 'Completed revenue by month filtered only by period.',
			display: 'line',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT date_trunc('month', orders.ordered_at)::date AS month,
       SUM(order_items.quantity * order_items.unit_price)::numeric(12, 2) AS revenue
FROM orders
JOIN order_items ON order_items.order_id = orders.id
WHERE orders.status = 'completed'
[[AND {{period}}]]
GROUP BY 1
ORDER BY 1`,
				periodTemplateTag(orderedAtFieldId),
			),
			visualization_settings: {
				'graph.dimensions': ['month'],
				'graph.metrics': ['revenue'],
			},
		},
		{
			name: 'Unwired completed revenue by category',
			description: 'Control card intentionally unaffected by dashboard filters.',
			display: 'bar',
			dataset_query: nativeQuery(
				databaseId,
				`SELECT categories.name AS category,
       SUM(order_items.quantity * order_items.unit_price)::numeric(12, 2) AS revenue
FROM orders
JOIN order_items ON order_items.order_id = orders.id
JOIN products ON products.id = order_items.product_id
JOIN categories ON categories.id = products.category_id
WHERE orders.status = 'completed'
GROUP BY categories.name
ORDER BY revenue DESC`,
			),
			visualization_settings: {
				'graph.dimensions': ['category'],
				'graph.metrics': ['revenue'],
			},
		},
	];
}

function completedOrdersModelDefinition(databaseId) {
	return {
		name: 'Completed orders model',
		description: 'Reusable SQL model containing completed orders.',
		type: 'model',
		display: 'table',
		dataset_query: nativeQuery(
			databaseId,
			`SELECT id, customer_id, ordered_at, status
FROM orders
WHERE status = 'completed'`,
		),
		visualization_settings: {},
	};
}

function mbqlCardDefinitions(databaseId, ordersTableId, statusFieldId, modelId, segmentId) {
	return [
		{
			name: 'Orders by status',
			description: 'Order count grouped by status, built with the Metabase query editor.',
			display: 'bar',
			dataset_query: {
				type: 'query',
				database: databaseId,
				query: {
					'source-table': ordersTableId,
					aggregation: [['count']],
					breakout: [['field', statusFieldId, null]],
				},
			},
			visualization_settings: {
				'graph.dimensions': ['status'],
				'graph.metrics': ['count'],
			},
		},
		{
			name: 'Completed orders from model',
			description: 'Rows selected from the reusable completed-orders model.',
			display: 'table',
			dataset_query: {
				type: 'query',
				database: databaseId,
				query: {
					'source-table': `card__${modelId}`,
					limit: 5,
				},
			},
			visualization_settings: {},
		},
		{
			name: 'Completed order count metric',
			description: 'Reusable metric counting completed orders.',
			type: 'metric',
			display: 'scalar',
			dataset_query: {
				type: 'query',
				database: databaseId,
				query: {
					'source-table': ordersTableId,
					aggregation: [['count']],
					filter: ['=', ['field', statusFieldId, null], 'completed'],
				},
			},
			visualization_settings: {},
		},
		{
			name: 'Completed orders from segment',
			description: 'Order count using the reusable completed-orders segment.',
			display: 'scalar',
			dataset_query: {
				type: 'query',
				database: databaseId,
				query: {
					'source-table': ordersTableId,
					aggregation: [['count']],
					filter: ['segment', segmentId],
				},
			},
			visualization_settings: {},
		},
	];
}

function nativeQuery(databaseId, query, templateTags = {}) {
	return {
		type: 'native',
		database: databaseId,
		native: {
			query,
			'template-tags': templateTags,
		},
	};
}

function periodTemplateTag(orderedAtFieldId) {
	return {
		[PERIOD_PARAMETER_ID]: {
			id: 'e02d62a7-0402-4903-af88-7a9e02005b20',
			name: PERIOD_PARAMETER_ID,
			'display-name': 'Period',
			type: 'dimension',
			dimension: ['field', orderedAtFieldId, null],
			'widget-type': 'date/range',
			required: false,
		},
	};
}

function categoryTemplateTag() {
	return {
		[CATEGORY_PARAMETER_ID]: {
			id: 'f11f3342-e91f-4a37-81fc-d2947e158861',
			name: CATEGORY_PARAMETER_ID,
			'display-name': 'Category',
			type: 'text',
			required: false,
		},
	};
}

async function request(path, options = {}) {
	const method = options.method ?? 'GET';
	let response;
	try {
		response = await fetch(`${METABASE_URL}${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(useApiKey ? { 'X-Api-Key': METABASE_API_KEY } : {}),
				...(options.sessionId ? { 'X-Metabase-Session': options.sessionId } : {}),
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`${method} ${path} failed: ${error.message}`, { cause: error });
	}
	const text = await response.text();

	if (!response.ok) {
		throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
	}

	try {
		return text ? JSON.parse(text) : null;
	} catch (error) {
		throw new Error(`${method} ${path} returned invalid JSON`, { cause: error });
	}
}

async function pollRead(description, timeoutMs, read, pollIntervalMs = POLL_INTERVAL_MS) {
	const deadline = Date.now() + timeoutMs;
	let lastError;

	while (Date.now() < deadline) {
		const remainingMs = deadline - Date.now();
		try {
			const result = await read(remainingMs);
			if (result) {
				return result;
			}
		} catch (error) {
			lastError = error;
		}
		const waitMs = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
		if (waitMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
	}

	const detail = lastError ? ` Last error: ${lastError.message}` : '';
	throw new Error(`${description} did not become ready within ${timeoutMs / 1_000} seconds.${detail}`);
}

function secondsFromEnvironment(name, fallback) {
	const seconds = Number(process.env[name] ?? fallback);
	if (!Number.isSafeInteger(seconds) || seconds <= 0) {
		throw new Error(`${name} must be a positive integer.`);
	}
	return seconds * 1_000;
}

function asList(value) {
	if (Array.isArray(value)) {
		return value;
	}
	if (Array.isArray(value?.data)) {
		return value.data;
	}
	throw new Error(`Expected a list response, received: ${JSON.stringify(value)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await bootstrap();
}

export { pollRead };
