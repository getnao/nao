import { defaultColorFor, labelize } from '@nao/shared';
import type { ParsedChartBlock, ParsedTableBlock, Segment } from '@nao/shared/story-segments';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { formatCellValue, isNumericColumn } from '@nao/shared/story-table-utils';
import type { displayChart } from '@nao/shared/tools';
import { marked, Renderer } from 'marked';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { renderChartToSvg } from '../components/generate-chart';
import type { QueryDataMap, StoryInput } from './story-download';

const MAX_TABLE_ROWS = 10;

const DOC_MAX_WIDTH = 900;
const DOC_HORIZ_PADDING = 24;
const CHART_WIDTH = DOC_MAX_WIDTH - DOC_HORIZ_PADDING * 2;
const CHART_HEIGHT = Math.round((CHART_WIDTH * 9) / 16);

export function generateStoryHtml(story: StoryInput, queryData: QueryDataMap | null): string {
	const segments = splitCodeIntoSegments(story.code);
	const markup = renderToStaticMarkup(
		<StoryDocument title={story.title}>
			{segments.map((seg, i) => (
				<StorySegment key={i} segment={seg} queryData={queryData} />
			))}
			<StoryFooter />
		</StoryDocument>,
	);
	return `<!DOCTYPE html>\n${markup}`;
}

function StoryDocument({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<html lang='en'>
			<head>
				<meta charSet='utf-8' />
				<meta name='viewport' content='width=device-width,initial-scale=1' />
				<title>{title}</title>
				<style dangerouslySetInnerHTML={{ __html: DOCUMENT_STYLES }} />
			</head>
			<body>
				{children}
				<script dangerouslySetInnerHTML={{ __html: TOOLTIP_SCRIPT }} />
			</body>
		</html>
	);
}

function StoryFooter() {
	const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
	return (
		<footer
			style={{ marginTop: 48, paddingTop: 16, borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#9ca3af' }}
		>
			Generated on {date}
		</footer>
	);
}

function StorySegment({ segment, queryData }: { segment: Segment; queryData: QueryDataMap | null }) {
	switch (segment.type) {
		case 'markdown':
			return <MarkdownBlock content={segment.content} />;
		case 'chart':
			return <ChartBlock chart={segment.chart} queryData={queryData} />;
		case 'table':
			return <TableBlock table={segment.table} queryData={queryData} />;
		case 'grid':
			return <GridBlock cols={segment.cols} segments={segment.children} queryData={queryData} />;
	}
}

const safeRenderer = new Renderer();
safeRenderer.html = () => '';

function MarkdownBlock({ content }: { content: string }) {
	const html = marked.parse(content, { async: false, renderer: safeRenderer }) as string;
	return <div className='nao-md' dangerouslySetInnerHTML={{ __html: html }} />;
}

function GridBlock({
	cols: _cols,
	segments,
	queryData,
}: {
	cols: number;
	segments: Segment[];
	queryData: QueryDataMap | null;
}) {
	const allKpi = segments.every((s) => s.type === 'chart' && s.chart.chartType === 'kpi_card');
	if (allKpi) {
		return (
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '16px 0' }}>
				{segments.map((seg, i) => (
					<div key={i} style={{ flex: '1 1 0%', minWidth: 160 }}>
						<StorySegment segment={seg} queryData={queryData} />
					</div>
				))}
			</div>
		);
	}
	return (
		<>
			{segments.map((seg, i) => (
				<StorySegment key={i} segment={seg} queryData={queryData} />
			))}
		</>
	);
}

function ChartBlock({ chart, queryData }: { chart: ParsedChartBlock; queryData: QueryDataMap | null }) {
	const rows = queryData?.[chart.queryId]?.data as Record<string, unknown>[] | undefined;
	if (!rows?.length) {
		return <Placeholder label={chart.title || 'Chart'} message='Data unavailable' />;
	}

	if (chart.chartType === 'kpi_card') {
		return <KpiCards chart={chart} rows={rows} />;
	}

	try {
		const svg = renderChartToSvg({
			config: toChartConfig(chart),
			data: rows,
			width: CHART_WIDTH,
			height: CHART_HEIGHT,
			margin: { top: 0, right: 0, bottom: 0, left: 0 },
			includeLegend: false,
		});
		const chartData = JSON.stringify({
			data: rows,
			xAxisKey: chart.xAxisKey,
			series: chart.series,
			chartType: chart.chartType,
		});
		return (
			<div style={{ margin: '16px 0' }}>
				<div
					className='nao-chart'
					style={{ textAlign: 'center', position: 'relative' }}
					data-chart={chartData}
					dangerouslySetInnerHTML={{ __html: svg }}
				/>
				{chart.chartType !== 'pie' && <ChartLegend series={chart.series} />}
			</div>
		);
	} catch {
		return <Placeholder label={chart.title || 'Chart'} message='Could not render chart' />;
	}
}

function ChartLegend({ series }: { series: ParsedChartBlock['series'] }) {
	return (
		<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 12 }}>
			{series.map((s, i) => {
				const color = s.color || defaultColorFor(s.data_key, i);
				return (
					<div
						key={s.data_key}
						style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 12 }}
					>
						<div style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: color }} />
						{s.label || labelize(s.data_key)}
					</div>
				);
			})}
		</div>
	);
}

function KpiCards({ chart, rows }: { chart: ParsedChartBlock; rows: Record<string, unknown>[] }) {
	const firstRow = rows[0] ?? {};
	return (
		<div
			style={{
				display: 'flex',
				flexWrap: 'wrap',
				gap: 16,
				margin: '16px 0',
				width: '100%',
				justifyContent: 'flex-start',
			}}
		>
			{chart.series.map((s) => {
				const raw = firstRow[s.data_key];
				const value = typeof raw === 'number' ? raw.toLocaleString() : String(raw ?? '');
				const label = s.label ?? s.data_key;
				return (
					<div key={s.data_key} style={{ minWidth: 160 }}>
						<div style={{ fontSize: 18, letterSpacing: '0.025em', color: '#1f2937' }}>{label}</div>
						<div style={{ fontSize: 30, fontWeight: 500, color: '#111827' }}>{value}</div>
					</div>
				);
			})}
		</div>
	);
}

function TableBlock({ table, queryData }: { table: ParsedTableBlock; queryData: QueryDataMap | null }) {
	const qd = queryData?.[table.queryId];
	if (!qd?.data.length) {
		return <Placeholder label={table.title || 'Table'} message='Data unavailable' />;
	}

	const { columns } = qd;
	const allRows = qd.data as Record<string, unknown>[];
	const truncated = allRows.length > MAX_TABLE_ROWS;
	const rows = truncated ? allRows.slice(0, MAX_TABLE_ROWS) : allRows;
	const numericCols = new Set(columns.filter((c) => isNumericColumn(allRows, c)));

	const thStyle = (col: string): React.CSSProperties => ({
		padding: '8px 12px',
		textAlign: numericCols.has(col) ? 'right' : 'left',
		fontWeight: 500,
		whiteSpace: 'nowrap',
		color: 'rgba(0,0,0,0.5)',
		borderBottom: '1px solid #e5e7eb',
	});

	const tdStyle = (col: string): React.CSSProperties => ({
		padding: '4px 12px',
		textAlign: numericCols.has(col) ? 'right' : 'left',
		fontVariantNumeric: numericCols.has(col) ? 'tabular-nums' : undefined,
		fontFamily: 'source-code-pro,Menlo,Monaco,Consolas,monospace',
		fontSize: 11,
		lineHeight: '20px',
		whiteSpace: 'nowrap',
	});

	const rowCount = truncated
		? `${allRows.length} rows (showing ${MAX_TABLE_ROWS}, +${allRows.length - MAX_TABLE_ROWS} more)`
		: `${allRows.length} rows`;

	return (
		<div style={{ margin: '8px 0' }}>
			{table.title && <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>{table.title}</div>}
			<div
				style={{
					overflow: 'auto',
					borderRadius: 8,
					border: '1px solid #e5e7eb',
					background: 'rgba(255,255,255,0.5)',
				}}
			>
				<table style={{ width: '100%', borderCollapse: 'collapse', borderSpacing: 0, fontSize: 12 }}>
					<thead style={{ background: '#fafafa' }}>
						<tr>
							{columns.map((col) => (
								<th key={col} style={thStyle(col)}>
									{col}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row, i) => (
							<tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
								{columns.map((col) => (
									<td key={col} style={tdStyle(col)}>
										<CellValue value={row[col]} />
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div style={{ textAlign: 'right', padding: '4px 8px', fontSize: 14, color: 'rgba(0,0,0,0.5)' }}>
				{rowCount}
			</div>
		</div>
	);
}

function CellValue({ value }: { value: unknown }) {
	if (value === null || value === undefined) {
		return <span style={{ fontStyle: 'italic', color: 'rgba(0,0,0,0.3)' }}>NULL</span>;
	}
	return <>{formatCellValue(value)}</>;
}

function Placeholder({ label, message }: { label: string; message: string }) {
	return (
		<div
			style={{
				margin: '16px 0',
				padding: 24,
				border: '1px dashed #d1d5db',
				borderRadius: 8,
				textAlign: 'center',
				color: '#9ca3af',
				fontSize: 13,
			}}
		>
			<div style={{ fontWeight: 500, marginBottom: 4 }}>{label}</div>
			{message}
		</div>
	);
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

const DOCUMENT_STYLES = `
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
.nao-tooltip{position:absolute;pointer-events:none;background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:6px 10px;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:10;opacity:0;transition:opacity .15s;min-width:128px;display:grid;gap:6px}
.nao-tooltip.visible{opacity:1}
.nao-tooltip-label{font-weight:500;color:#111827;text-align:left}
.nao-tooltip-rows{display:grid;gap:6px}
.nao-tooltip-row{display:flex;align-items:center;gap:8px;width:100%}
.nao-tooltip-swatch{width:10px;height:10px;border-radius:2px;flex-shrink:0}
.nao-tooltip-name{color:rgba(0,0,0,0.5);flex:1;text-align:left}
.nao-tooltip-value{color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:500;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;margin-left:auto}
.nao-tooltip-total{display:flex;align-items:center;gap:8px;width:100%;border-top:1px solid rgba(0,0,0,0.08);padding-top:6px;margin-top:2px}
.nao-tooltip-total .nao-tooltip-name{font-weight:500}
.nao-tooltip-total .nao-tooltip-value{font-weight:500}
@media print{body{padding:0;max-width:none}.nao-tooltip{display:none}.nao-chart{break-inside:avoid}table{break-inside:avoid}div[style*="display:flex"]{break-inside:avoid}h1,h2,h3{break-after:avoid}svg{max-width:100%!important;height:auto!important}footer{break-inside:avoid}}
`;

const TOOLTIP_SCRIPT = `
(function(){
	var PIE_COLORS=['#104e64','#f54900','#009689','#ffb900','#fe9a00'];
	function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
	function labelize(s){
		var str=String(s);
		if(/^\\d{4}-\\d{2}-\\d{2}/.test(str)){var d=new Date(str);if(!isNaN(d.getTime()))return escHtml(d.toLocaleDateString('en-US',{timeZone:'UTC'}))}
		return escHtml(str.replace(/_/g,' ').replace(/\\b\\w/g,function(c){return c.toUpperCase()}))
	}
	function formatVal(v){return escHtml(typeof v==='number'?v.toLocaleString():String(v!=null?v:''))}

	document.querySelectorAll('.nao-chart').forEach(function(container){
		var raw=container.getAttribute('data-chart');
		if(!raw)return;
		var cfg;try{cfg=JSON.parse(raw.replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&'))}catch(e){return}

		var pieColorMap=null;
		if(cfg.chartType==='pie'){
			pieColorMap={};var ci=0;var seen={};
			cfg.data.forEach(function(d){
				var v=String(d[cfg.xAxisKey]!=null?d[cfg.xAxisKey]:'');
				if(!seen[v]){seen[v]=true;pieColorMap[v]=PIE_COLORS[ci%PIE_COLORS.length];ci++}
			});
		}

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
			var isPie=!!pieColorMap;
			var html='<div class="nao-tooltip-label">'+(isPie?labelize(cfg.series[0]&&(cfg.series[0].label||cfg.series[0].data_key)||''):labelize(label!=null?label:''))+'</div>';
			html+='<div class="nao-tooltip-rows">';
			var numericValues=[];
			cfg.series.forEach(function(s){
				var color;
				if(isPie){
					color=pieColorMap[String(label!=null?label:'')]||PIE_COLORS[0];
				}else{
					color=s.color||'#2563eb';
					if(color.startsWith('var('))color='#2563eb';
				}
				var val=row[s.data_key];
				if(typeof val==='number')numericValues.push(val);
				var rowName=isPie?labelize(label!=null?label:''):labelize(s.label||s.data_key);
				html+='<div class="nao-tooltip-row">'
					+'<span class="nao-tooltip-swatch" style="background:'+escHtml(color)+'"></span>'
					+'<span class="nao-tooltip-name">'+rowName+'</span>'
					+'<span class="nao-tooltip-value">'+formatVal(val)+'</span>'
					+'</div>';
			});
			if(numericValues.length>1){
				var total=numericValues.reduce(function(a,b){return a+b},0);
				html+='<div class="nao-tooltip-total">'
					+'<span class="nao-tooltip-name">Total</span>'
					+'<span class="nao-tooltip-value">'+escHtml(total.toLocaleString())+'</span>'
					+'</div>';
			}
			html+='</div>';
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
`;
