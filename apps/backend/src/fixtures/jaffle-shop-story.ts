export const JAFFLE_SHOP_STORY = {
	slug: 'jaffle-shop-overview',
	title: 'Jaffle Shop: Revenue, Order Status & Top Customers',
	format: 'classic',
	code: `This story gives a quick overview of Jaffle Shop's business: revenue trend over time, how orders break down by status, and the top customers by revenue.

## Revenue Over Time

Monthly revenue across all orders.

<chart query_id="query_f0ac20cd" chart_type="line" x_axis_key="month" x_axis_type="date" title="Monthly Revenue" series='[{"data_key": "revenue", "label": "Revenue", "value_format": {"d3_format": ",.0f", "prefix": "$"}}]' />

## Order Status Breakdown

Order counts and revenue by status.

<grid widths="1,1">
<chart query_id="query_70cfcc4e" chart_type="donut" x_axis_key="status" title="Revenue by Order Status" series='[{"data_key": "revenue", "label": "Revenue", "value_format": {"d3_format": ",.0f", "prefix": "$"}}]' />
<table query_id="query_70cfcc4e" title="Orders by Status" />
</grid>

## Top Customers

Top 10 customers ranked by total revenue.

<chart query_id="query_85a643b0" chart_type="horizontal_bar" x_axis_key="customer_name" x_axis_type="category" title="Top 10 Customers by Revenue" series='[{"data_key": "revenue", "label": "Revenue", "value_format": {"d3_format": ",.0f", "prefix": "$"}}]' />
`,
	queries: {
		query_f0ac20cd: {
			name: 'Revenue over time (monthly)',
			sql: `SELECT date_trunc('month', order_date) AS month, SUM(amount) AS revenue
FROM main.orders
GROUP BY 1
ORDER BY 1`,
			columns: ['month', 'revenue'],
			data: [
				{ month: '2018-01-01T00:00:00', revenue: 496 },
				{ month: '2018-02-01T00:00:00', revenue: 415 },
				{ month: '2018-03-01T00:00:00', revenue: 622 },
				{ month: '2018-04-01T00:00:00', revenue: 139 },
			],
		},
		query_70cfcc4e: {
			name: 'Order status breakdown',
			sql: `SELECT status, COUNT(*) AS order_count, SUM(amount) AS revenue
FROM main.orders
GROUP BY 1
ORDER BY revenue DESC`,
			columns: ['status', 'order_count', 'revenue'],
			data: [
				{ status: 'completed', order_count: 67, revenue: 1103 },
				{ status: 'placed', order_count: 13, revenue: 284 },
				{ status: 'shipped', order_count: 13, revenue: 198 },
				{ status: 'returned', order_count: 4, revenue: 49 },
				{ status: 'return_pending', order_count: 2, revenue: 38 },
			],
		},
		query_85a643b0: {
			name: 'Top 10 customers by revenue',
			sql: `SELECT c.customer_id, c.first_name || ' ' || c.last_name AS customer_name, SUM(o.amount) AS revenue
FROM main.orders o
JOIN main.customers c ON c.customer_id = o.customer_id
GROUP BY 1,2
ORDER BY revenue DESC
LIMIT 10`,
			columns: ['customer_id', 'customer_name', 'revenue'],
			data: [
				{ customer_id: 51, customer_name: 'Howard R.', revenue: 99 },
				{ customer_id: 3, customer_name: 'Kathleen P.', revenue: 65 },
				{ customer_id: 46, customer_name: 'Norma C.', revenue: 64 },
				{ customer_id: 54, customer_name: 'Rose M.', revenue: 57 },
				{ customer_id: 30, customer_name: 'Christina W.', revenue: 57 },
				{ customer_id: 70, customer_name: 'Helen F.', revenue: 54 },
				{ customer_id: 22, customer_name: 'Sean H.', revenue: 52 },
				{ customer_id: 50, customer_name: 'Billy L.', revenue: 47 },
				{ customer_id: 8, customer_name: 'Frank R.', revenue: 45 },
				{ customer_id: 71, customer_name: 'Gerald C.', revenue: 44 },
			],
		},
	},
} as const;
