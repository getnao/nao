export function render(element, context) {
	const valueKey = context.config.series[0]?.data_key;
	const labelKey = context.config.xAxisKey;
	const color = context.config.series[0]?.color || context.colors[0] || '#104e64';
	const rows = context.data
		.map((row) => ({ label: String(row[labelKey] ?? ''), value: Number(row[valueKey]) }))
		.filter((row) => Number.isFinite(row.value))
		.sort((left, right) => right.value - left.value)
		.slice(0, 10);
	const maximum = rows.reduce((current, row) => Math.max(current, Math.abs(row.value)), 0) || 1;
	const foreground = context.theme === 'dark' ? '#f4f4f5' : '#18181b';
	const muted = context.theme === 'dark' ? '#a1a1aa' : '#71717a';

	const chart = document.createElement('div');
	chart.style.display = 'grid';
	chart.style.gap = '12px';
	chart.style.padding = '8px 0';

	for (const row of rows) {
		const item = document.createElement('div');
		item.style.display = 'grid';
		item.style.gridTemplateColumns = 'minmax(80px, 1fr) 3fr auto';
		item.style.alignItems = 'center';
		item.style.gap = '12px';

		const label = document.createElement('span');
		label.textContent = row.label;
		label.style.color = foreground;
		label.style.fontSize = '12px';

		const track = document.createElement('div');
		track.style.height = '10px';
		track.style.overflow = 'hidden';
		track.style.borderRadius = '999px';
		track.style.background = context.theme === 'dark' ? '#27272a' : '#e4e4e7';

		const bar = document.createElement('div');
		bar.style.width = `${(Math.abs(row.value) / maximum) * 100}%`;
		bar.style.height = '100%';
		bar.style.borderRadius = 'inherit';
		bar.style.background = color;
		track.append(bar);

		const value = document.createElement('span');
		value.textContent = row.value.toLocaleString();
		value.style.color = muted;
		value.style.fontSize = '12px';
		value.style.fontVariantNumeric = 'tabular-nums';

		item.append(label, track, value);
		chart.append(item);
	}

	element.replaceChildren(chart);
	return () => element.replaceChildren();
}
