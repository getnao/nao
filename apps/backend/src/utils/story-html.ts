import type { ParsedChartBlock, ParsedTableBlock, Segment } from '@nao/shared/story-segments';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { formatCellValue, isNumericColumn } from '@nao/shared/story-table-utils';
import type { displayChart } from '@nao/shared/tools';
import { marked } from 'marked';

import { renderChartToSvg } from '../components/generate-chart';
import type { QueryDataMap, StoryInput } from './story-download';

const MAX_TABLE_ROWS = 10;

export function generateStoryHtml(story: StoryInput, queryData: QueryDataMap | null): string {
	const segments = splitCodeIntoSegments(story.code);
	const segmentHtml = segments.map((seg) => renderSegmentHtml(seg, queryData)).join('\n');
	const timestamp = `<footer style="margin-top:48px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af">Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</footer>`;
	return wrapHtmlDocument(story.title, `${segmentHtml}\n${timestamp}`);
}

function wrapHtmlDocument(title: string, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:rgba(0,0,0,0.85);max-width:900px;margin:0 auto;padding:32px 24px}
h1{font-size:20px;font-weight:700;margin:0 0 24px;color:#111827}
h2{font-size:20px;font-weight:600;margin:32px 0 12px;color:#111827}
h3{font-size:18px;font-weight:600;margin:24px 0 8px;color:#374151}
p{margin:8px 0;font-size:14px}
ul,ol{padding-left:24px;margin:8px 0;font-size:14px}
li{margin:4px 0}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12px;font-family:source-code-pro,Menlo,Monaco,Consolas,monospace}
pre{background:#f3f4f6;padding:16px;border-radius:8px;overflow-x:auto;font-size:12px;font-family:source-code-pro,Menlo,Monaco,Consolas,monospace}
blockquote{border-left:3px solid #d1d5db;padding-left:16px;margin:12px 0;color:#6b7280}
.nao-md table{width:100%;border-collapse:separate;border-spacing:0;margin:8px 0;font-size:12px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:rgba(255,255,255,0.5)}
.nao-md thead{background:#fafafa}
.nao-md th{padding:8px 12px;text-align:left;font-weight:500;white-space:nowrap;color:rgba(0,0,0,0.5);border-bottom:1px solid #e5e7eb}
.nao-md td{padding:4px 12px;font-family:source-code-pro,Menlo,Monaco,Consolas,monospace;font-size:11px;line-height:20px;white-space:nowrap;border-bottom:1px solid rgba(0,0,0,0.05)}
.nao-md tr:last-child td{border-bottom:none}
svg{max-width:100%;height:auto}
img{max-width:100%;height:auto;border-radius:4px;margin:8px 0}
.nao-tooltip{position:absolute;pointer-events:none;background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.12);z-index:10;opacity:0;transition:opacity .15s}
.nao-tooltip.visible{opacity:1}
.nao-tooltip-label{font-weight:600;margin-bottom:4px;color:#111827}
.nao-tooltip-row{display:flex;align-items:center;gap:6px;padding:1px 0}
.nao-tooltip-swatch{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.nao-tooltip-value{color:#374151}
@media print{body{padding:0;max-width:none}.nao-tooltip{display:none}.nao-chart{break-inside:avoid}table{break-inside:avoid}div[style*="display:flex"]{break-inside:avoid}h1,h2,h3{break-after:avoid}svg{max-width:100%!important;height:auto!important}footer{break-inside:avoid}}
</style>
</head>
<body>
${body}
${chartTooltipScript()}
</body>
</html>`;
}

function chartTooltipScript(): string {
	return (
		`<script>
(function(){
	function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
	function labelize(s){return escHtml(String(s).replace(/_/g,' ').replace(/\\b\\w/g,function(c){return c.toUpperCase()}))}
	function formatVal(v){return escHtml(typeof v==='number'?v.toLocaleString():String(v!=null?v:''))}

	document.querySelectorAll('.nao-chart').forEach(function(container){
		var raw=container.getAttribute('data-chart');
		if(!raw)return;
		var cfg;try{cfg=JSON.parse(raw.replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"'))}catch(e){return}

		var tip=document.createElement('div');
		tip.className='nao-tooltip';
		container.appendChild(tip);

		var svg=container.querySelector('svg');
		if(!svg)return;

		var bars=svg.querySelectorAll('.recharts-bar-rectangle');
		var areas=svg.querySelectorAll('.recharts-active-dot, .recharts-dot');
		var shapes=bars.length?bars:areas;

		if(cfg.chartType==='pie'){
			var slices=svg.querySelectorAll('.recharts-pie-sector');
			slices.forEach(function(el,i){
				var row=cfg.data[i];
				if(!row)return;
				el.addEventListener('mouseenter',function(e){showTip(e,row)});
				el.addEventListener('mousemove',function(e){moveTip(e)});
				el.addEventListener('mouseleave',function(){hideTip()});
			});
		}else{
			var cellCount=cfg.data.length;
			if(bars.length>0){
				var seriesCount=cfg.series.length;
				bars.forEach(function(el,i){
					var dataIndex=i%cellCount;
					var row=cfg.data[dataIndex];
					if(!row)return;
					el.addEventListener('mouseenter',function(e){showTip(e,row)});
					el.addEventListener('mousemove',function(e){moveTip(e)});
					el.addEventListener('mouseleave',function(){hideTip()});
				});
			}
			svg.addEventListener('mousemove',function(e){
				if(bars.length>0)return;
				var rect=svg.getBoundingClientRect();
				var plotArea=svg.querySelector('.recharts-cartesian-grid')||svg.querySelector('.recharts-area');
				if(!plotArea)return;
				var pRect=plotArea.getBoundingClientRect();
				var relX=(e.clientX-pRect.left)/pRect.width;
				if(relX<0||relX>1){hideTip();return}
				var idx=Math.round(relX*(cellCount-1));
				idx=Math.max(0,Math.min(cellCount-1,idx));
				var row=cfg.data[idx];
				if(row){showTip(e,row);moveTip(e)}
			});
			svg.addEventListener('mouseleave',function(){hideTip()});
		}

		function showTip(e,row){
			var label=row[cfg.xAxisKey];
			var html='<div class="nao-tooltip-label">'+labelize(label!=null?label:'')+'</div>';
			cfg.series.forEach(function(s){
				var color=s.color||'#2563eb';
				if(color.startsWith('var('))color='#2563eb';
				html+='<div class="nao-tooltip-row"><span class="nao-tooltip-swatch" style="background:'+escHtml(color)+'"></span><span>'+labelize(s.label||s.data_key)+': </span><span class="nao-tooltip-value">'+formatVal(row[s.data_key])+'</span></div>';
			});
			tip.innerHTML=html;
			tip.classList.add('visible');
			moveTip(e);
		}

		function moveTip(e){
			var cr=container.getBoundingClientRect();
			var x=e.clientX-cr.left+12;
			var y=e.clientY-cr.top-10;
			if(x+tip.offsetWidth>cr.width)x=e.clientX-cr.left-tip.offsetWidth-12;
			tip.style.left=x+'px';
			tip.style.top=y+'px';
		}

		function hideTip(){tip.classList.remove('visible')}
	});
})();
<` + `/script>`
	);
}

function renderSegmentHtml(segment: Segment, queryData: QueryDataMap | null): string {
	switch (segment.type) {
		case 'markdown':
			return `<div class="nao-md">${marked.parse(segment.content, { async: false }) as string}</div>`;
		case 'chart':
			return renderChartHtml(segment.chart, queryData);
		case 'table':
			return renderTableHtml(segment.table, queryData);
		case 'grid':
			return renderGridHtml(segment.cols, segment.children, queryData);
	}
}

function renderGridHtml(cols: number, children: Segment[], queryData: QueryDataMap | null): string {
	const allKpi = children.every((c) => c.type === 'chart' && c.chart.chartType === 'kpi_card');
	if (allKpi) {
		const items = children
			.map((c) => `<div style="flex:1 1 0%;min-width:160px">${renderSegmentHtml(c, queryData)}</div>`)
			.join('');
		return `<div style="display:flex;flex-wrap:wrap;gap:16px;margin:16px 0">${items}</div>`;
	}
	return children.map((c) => renderSegmentHtml(c, queryData)).join('\n');
}

function renderChartHtml(chart: ParsedChartBlock, queryData: QueryDataMap | null): string {
	const rows = queryData?.[chart.queryId]?.data as Record<string, unknown>[] | undefined;
	if (!rows?.length) {
		return renderPlaceholderHtml(chart.title || 'Chart', 'Data unavailable');
	}

	if (chart.chartType === 'kpi_card') {
		return renderKpiCardHtml(chart, rows);
	}

	try {
		const svg = renderChartToSvg({ config: toChartConfig(chart), data: rows });
		const chartData = JSON.stringify({
			data: rows,
			xAxisKey: chart.xAxisKey,
			series: chart.series,
			chartType: chart.chartType,
		});
		return `<div class="nao-chart" style="margin:16px 0;text-align:center;position:relative;aspect-ratio:3/2" data-chart='${esc(chartData)}'>${svg}</div>`;
	} catch {
		return renderPlaceholderHtml(chart.title || 'Chart', 'Could not render chart');
	}
}

function toChartConfig(chart: ParsedChartBlock) {
	return {
		chart_type: chart.chartType as displayChart.ChartType,
		x_axis_key: chart.xAxisKey,
		x_axis_type: chart.xAxisType as displayChart.XAxisType | null,
		series: chart.series,
		title: chart.title,
	};
}

function renderKpiCardHtml(chart: ParsedChartBlock, rows: Record<string, unknown>[]): string {
	const firstRow = rows[0] ?? {};
	const cards = chart.series
		.map((s) => {
			const raw = firstRow[s.data_key];
			const value = typeof raw === 'number' ? raw.toLocaleString() : String(raw ?? '');
			const label = s.label ?? s.data_key;
			return `<div style="min-width:160px"><div style="font-size:18px;letter-spacing:0.025em;color:#1f2937">${esc(label)}</div><div style="font-size:30px;font-weight:500;color:#111827">${esc(value)}</div></div>`;
		})
		.join('');
	return `<div style="display:flex;flex-wrap:wrap;gap:16px;margin:16px 0;width:100%;justify-content:flex-start">${cards}</div>`;
}

function renderTableHtml(table: ParsedTableBlock, queryData: QueryDataMap | null): string {
	const qd = queryData?.[table.queryId];
	if (!qd?.data.length) {
		return renderPlaceholderHtml(table.title || 'Table', 'Data unavailable');
	}

	const columns = qd.columns;
	const allRows = qd.data as Record<string, unknown>[];
	const truncated = allRows.length > MAX_TABLE_ROWS;
	const rows = truncated ? allRows.slice(0, MAX_TABLE_ROWS) : allRows;
	const numericCols = new Set(columns.filter((c) => isNumericColumn(allRows, c)));

	const title = table.title
		? `<div style="font-size:14px;font-weight:500;margin-bottom:8px">${esc(table.title)}</div>`
		: '';

	const thAlign = (c: string) => (numericCols.has(c) ? 'text-align:right' : 'text-align:left');
	const tdAlign = (c: string) =>
		numericCols.has(c) ? 'text-align:right;font-variant-numeric:tabular-nums' : 'text-align:left';

	const ths = columns.map(
		(c) =>
			`<th style="padding:8px 12px;${thAlign(c)};font-weight:500;white-space:nowrap;color:rgba(0,0,0,0.5);border-bottom:1px solid #e5e7eb">${esc(c)}</th>`,
	);
	const trs = rows.map(
		(row) =>
			`<tr style="border-bottom:1px solid rgba(0,0,0,0.05)">${columns.map((c) => `<td style="padding:4px 12px;${tdAlign(c)};font-family:source-code-pro,Menlo,Monaco,Consolas,monospace;font-size:11px;line-height:20px;white-space:nowrap">${formatCellValueHtml(row[c])}</td>`).join('')}</tr>`,
	);

	let footer = '';
	if (truncated) {
		const hidden = allRows.length - MAX_TABLE_ROWS;
		footer = `<div style="text-align:right;padding:4px 8px;font-size:14px;color:rgba(0,0,0,0.5)">${allRows.length} rows (showing ${MAX_TABLE_ROWS}, +${hidden} more)</div>`;
	} else {
		footer = `<div style="text-align:right;padding:4px 8px;font-size:14px;color:rgba(0,0,0,0.5)">${allRows.length} rows</div>`;
	}

	return `<div style="margin:8px 0">${title}<div style="overflow:auto;border-radius:8px;border:1px solid #e5e7eb;background:rgba(255,255,255,0.5)"><table style="width:100%;border-collapse:collapse;border-spacing:0;font-size:12px"><thead style="background:#fafafa"><tr>${ths.join('')}</tr></thead><tbody>${trs.join('')}</tbody></table></div>${footer}</div>`;
}

function formatCellValueHtml(value: unknown): string {
	if (value === null || value === undefined) {
		return '<span style="font-style:italic;color:rgba(0,0,0,0.3)">NULL</span>';
	}
	return esc(formatCellValue(value));
}

function renderPlaceholderHtml(label: string, message: string): string {
	return `<div style="margin:16px 0;padding:24px;border:1px dashed #d1d5db;border-radius:8px;text-align:center;color:#9ca3af;font-size:13px"><div style="font-weight:500;margin-bottom:4px">${esc(label)}</div>${esc(message)}</div>`;
}

function esc(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
