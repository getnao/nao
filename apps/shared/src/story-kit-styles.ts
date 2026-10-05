import { STORY_PRINT_SLIDES_ATTRIBUTE, STORY_SLIDE_SIZE } from './story-app';

/** Loaded by the frame document before the story's own CSS, so `app.css` overrides it and hand-rolled */
export const KIT_STYLES = `
.nao-block{--background:var(--card);display:flex;flex-direction:column;gap:12px;min-width:0;padding:16px 20px;background:var(--card);color:var(--card-foreground);border:var(--story-block-border-width) solid var(--border);border-radius:var(--story-block-radius)}
.nao-block .nao-block{padding:0;background:transparent;border:0;border-radius:0}
.nao-block__header{display:flex;align-items:flex-start;gap:8px}
.nao-block__heading{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.nao-block__actions{display:flex;align-items:center;gap:2px;flex-shrink:0}
.nao-block__action{position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;padding:0;color:var(--muted-foreground);background:transparent;border:0;border-radius:999px;cursor:pointer}
.nao-block__action[data-tooltip]:hover::after,.nao-block__action[data-tooltip]:focus-visible::after{content:attr(data-tooltip);position:absolute;top:calc(100% + 6px);right:0;z-index:20;width:max-content;max-width:240px;padding:6px 10px;font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:1.4;text-align:left;white-space:normal;color:var(--foreground);background:var(--background);border:1px solid color-mix(in srgb, var(--border) 50%, transparent);border-radius:var(--radius-sm);box-shadow:0 20px 25px -5px rgb(0 0 0 / .1),0 8px 10px -6px rgb(0 0 0 / .1);pointer-events:none}
.nao-block__action svg{width:13px;height:13px}
.nao-block__action[aria-pressed=true]{background:color-mix(in srgb, var(--muted-foreground) 14%, transparent);color:var(--foreground)}
.nao-block__action:hover{background:color-mix(in srgb, var(--muted-foreground) 14%, transparent);color:var(--foreground)}
.nao-sql{margin:0;max-height:320px;overflow:auto;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;white-space:pre;color:var(--foreground);background:color-mix(in srgb, var(--muted) 50%, transparent);border:1px solid var(--border);border-radius:var(--radius-sm)}
.nao-sql__keyword{color:var(--primary);font-weight:600}
.nao-sql__string{color:var(--chart-2)}
.nao-sql__number{color:var(--chart-3)}
.nao-sql__comment{color:var(--muted-foreground);font-style:italic}
.nao-block__title{margin:0;font-family:var(--font-heading);font-size:14px;font-weight:600;line-height:1.3;color:var(--foreground)}
.nao-block__description{margin:0;font-size:12px;line-height:1.4;color:var(--muted-foreground)}
.nao-block__body{min-width:0;flex:1}
.nao-block__state{display:flex;align-items:center;justify-content:center;min-height:96px;padding:12px;font-size:12px;color:var(--muted-foreground);text-align:center}
.nao-block__state--error{color:#b91c1c}
.nao-block__state button{margin-left:8px;padding:2px 8px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:var(--radius-sm);cursor:pointer}
.nao-skeleton{width:100%;height:100%;min-height:96px;border-radius:var(--radius-sm);background:linear-gradient(90deg,var(--muted) 25%,var(--card) 50%,var(--muted) 75%);background-size:200% 100%;animation:nao-shimmer 1.4s ease-in-out infinite}
@keyframes nao-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.nao-narrative--loading{color:transparent;border-radius:var(--radius-sm);-webkit-box-decoration-break:clone;box-decoration-break:clone;background:linear-gradient(90deg,var(--muted) 25%,var(--card) 50%,var(--muted) 75%);background-size:200% 100%;animation:nao-shimmer 1.4s ease-in-out infinite}

.nao-block{break-inside:avoid}

.nao-slides{display:flex;flex-direction:column;gap:12px;height:100vh;padding:16px;box-sizing:border-box;background:var(--story-stage)}
.nao-slides__top{display:flex;align-items:flex-start;gap:16px}
.nao-slides__header{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.nao-slides__eyebrow,.nao-slide__eyebrow{font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--primary)}
.nao-slides__title{margin:0;font-family:var(--font-heading);font-size:clamp(28px,4vw,48px);line-height:1.05;letter-spacing:-.04em;color:var(--foreground)}
.nao-slides__toolbar{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-left:auto;flex-shrink:0}
.nao-slides__pager{display:flex;align-items:center;gap:2px}
.nao-slides__counter{padding:0 6px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--muted-foreground)}
.nao-slides__control{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;color:var(--muted-foreground);background:transparent;border:0;border-radius:999px;cursor:pointer}
.nao-slides__control svg{width:16px;height:16px}
.nao-slides__control:hover:not(:disabled){color:var(--foreground);background:color-mix(in srgb, var(--muted-foreground) 14%, transparent)}
.nao-slides__control:disabled{opacity:.35;cursor:default}
.nao-slides__stage{display:flex;flex:1;align-items:center;justify-content:center;min-height:0}
.nao-slides__viewport{position:relative;flex:none;overflow:hidden;border:1px solid var(--border);box-sizing:content-box}
.nao-slide{position:relative;display:flex;flex-direction:column;gap:24px;width:${STORY_SLIDE_SIZE.width}px;height:${STORY_SLIDE_SIZE.height}px;padding:48px 56px;overflow:hidden;box-sizing:border-box;color:var(--foreground);background:radial-gradient(circle at top right, color-mix(in srgb, var(--primary) 10%, transparent), transparent 40%),color-mix(in srgb, var(--background) 94%, var(--foreground) 3%)}
.nao-slides__viewport>.nao-slide{transform:scale(var(--nao-slide-scale));transform-origin:top left;will-change:transform}
.nao-slide__heading{display:flex;flex-direction:column;gap:8px;flex:none}
.nao-slide__title{margin:0;max-width:980px;font-family:var(--font-heading);font-size:52px;line-height:1;letter-spacing:-.04em;color:var(--foreground)}
.nao-slide .nao-block{min-height:0;max-height:100%}
.nao-slide .nao-block__body{display:flex;flex-direction:column;min-height:0}
.nao-slide .nao-chart{flex:0 1 auto;min-height:0}
.nao-slides--fullscreen{position:fixed;inset:0;z-index:50;gap:0;padding:0;background:transparent}
.nao-slides--fullscreen::backdrop{background:transparent}
html:has(.nao-slides--fullscreen) body{background:transparent}
.nao-slides--fullscreen .nao-slides__header{display:none}
.nao-slides--fullscreen .nao-slides__viewport{border:0}
.nao-slides--fullscreen .nao-slides__toolbar{position:absolute;top:0;right:0;z-index:1;padding:20px 24px;transition:opacity .25s ease}
.nao-slides--fullscreen[data-idle]{cursor:none}
.nao-slides--fullscreen[data-idle] .nao-slides__toolbar:not(:hover):not(:focus-within){opacity:0;pointer-events:none}
.nao-slides--fullscreen .nao-slides__pager,.nao-slides--fullscreen .nao-slides__control{background:var(--story-stage);border:1px solid var(--border);border-radius:999px}
.nao-slides--fullscreen .nao-slides__toolbar>.nao-slides__control:hover:not(:disabled){background:color-mix(in srgb, var(--muted-foreground) 14%, var(--story-stage));color:var(--foreground)}
.nao-slides--fullscreen .nao-slides__pager .nao-slides__control{background:transparent;border:0}
.nao-slides--fullscreen .nao-slides__pager .nao-slides__control:hover:not(:disabled){background:color-mix(in srgb, var(--muted-foreground) 14%, transparent)}
.nao-slides--print{display:block;height:auto;padding:0;background:none}
.nao-slides--print .nao-slide{break-after:page;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.nao-slides--print .nao-slide:last-child{break-after:auto}
html[${STORY_PRINT_SLIDES_ATTRIBUTE}] #root{display:none}

.nao-kpi-card{min-width:160px}
.nao-kpi-card__value{font-family:var(--font-heading);font-size:calc(var(--story-body-size) * 2);font-weight:500;line-height:1.1;letter-spacing:var(--story-heading-tracking);font-variant-numeric:tabular-nums;color:var(--foreground)}
.nao-kpi-card__comparison{display:flex;align-items:center;gap:6px;margin-top:6px;white-space:nowrap;font-size:14px;color:var(--muted-foreground)}
.nao-kpi-card__comparison svg{flex:none}
.nao-kpi-card__comparison--up{color:#16a34a}
.nao-kpi-card__comparison--down{color:#dc2626}
.nao-kpi-card__comparison-value{font-weight:500;font-variant-numeric:tabular-nums}

.nao-chart{position:relative;width:100%;font-size:12px}
.nao-chart .recharts-cartesian-axis-tick text{fill:var(--muted-foreground)}
.nao-chart .recharts-cartesian-grid line{stroke:var(--chart-grid, var(--border))}
.nao-chart .recharts-rectangle.recharts-tooltip-cursor{fill:var(--muted);opacity:.5}
.nao-chart .recharts-curve.recharts-tooltip-cursor{stroke:var(--border)}
.nao-chart .recharts-dot[stroke='#fff']{stroke:transparent}
.nao-chart .recharts-surface,.nao-chart .recharts-layer{outline:none}
.nao-chart-tooltip,.recharts-default-tooltip{display:grid;min-width:8rem;align-items:start;gap:6px;padding:6px 10px!important;font-size:12px;background:var(--background)!important;color:var(--foreground);border:1px solid color-mix(in srgb, var(--border) 50%, transparent)!important;border-radius:var(--radius-sm);box-shadow:0 20px 25px -5px rgb(0 0 0 / .1),0 8px 10px -6px rgb(0 0 0 / .1)}
.recharts-default-tooltip .recharts-tooltip-label{margin:0!important;font-weight:500;color:var(--foreground)}
.recharts-default-tooltip .recharts-tooltip-label:empty{display:none}
.recharts-default-tooltip .recharts-tooltip-item-list{display:grid;gap:6px}
.recharts-default-tooltip .recharts-tooltip-item{display:flex!important;align-items:center;gap:8px;padding:0!important;line-height:1}
.recharts-default-tooltip .recharts-tooltip-item::before{content:'';flex:none;width:10px;height:10px;border-radius:2px;background:currentColor}
/* Recharts falls back to black when a series has no colour (e.g. scatter axes): no swatch then. */
.recharts-default-tooltip .recharts-tooltip-item[style*='rgb(0, 0, 0)']::before{display:none}
.recharts-default-tooltip .recharts-tooltip-item-name{color:var(--muted-foreground)}
.recharts-default-tooltip .recharts-tooltip-item-separator{display:none}
.recharts-default-tooltip .recharts-tooltip-item-value{margin-left:auto;font-family:ui-monospace,monospace;font-weight:500;font-variant-numeric:tabular-nums;color:var(--foreground)}
.recharts-default-tooltip .recharts-tooltip-item-unit{color:var(--foreground)}
.nao-chart-tooltip__label{font-weight:500}
.nao-chart-tooltip__items{display:grid;gap:6px}
.nao-chart-tooltip__item{display:flex;width:100%;flex-wrap:wrap;align-items:center;gap:8px}
.nao-chart-tooltip__indicator{flex:none;border-radius:2px;background:var(--color-bg);border-color:var(--color-border)}
.nao-chart-tooltip__indicator--dot{width:10px;height:10px}
.nao-chart-tooltip__indicator--line{width:4px;align-self:stretch}
.nao-chart-tooltip__indicator--dashed{width:0;align-self:stretch;background:transparent;border:1.5px dashed var(--color-border)}
.nao-chart-tooltip__row{display:flex;flex:1;align-items:center;justify-content:space-between;gap:8px;line-height:1}
.nao-chart-tooltip__name{color:var(--muted-foreground)}
.nao-chart-tooltip__value{font-family:ui-monospace,monospace;font-weight:500;font-variant-numeric:tabular-nums;color:var(--foreground)}
.nao-chart-tooltip__total{display:flex;width:100%;align-items:center;gap:8px;margin-top:2px;padding-top:6px;border-top:1px solid color-mix(in srgb, var(--border) 50%, transparent)}
.nao-chart-tooltip__total .nao-chart-tooltip__name{font-weight:500}
.nao-chart-legend{display:flex;flex-wrap:wrap;width:100%;align-items:center;justify-content:center;gap:6px 16px;padding-top:12px}
.nao-chart-legend__item{display:flex;flex:none;align-items:center;gap:6px;white-space:nowrap;color:var(--muted-foreground);user-select:none}
.nao-chart-legend__item--clickable{cursor:pointer}
.nao-chart-legend__item--clickable:hover{color:var(--foreground)}
.nao-chart-legend__item--hidden{opacity:.4}
.nao-chart-legend__swatch{width:8px;height:8px;flex:none;border-radius:2px}

.nao-map{position:relative;width:100%;height:360px;overflow:hidden;isolation:isolate;border-radius:var(--radius-sm);background:var(--muted)}
.nao-map .leaflet-container{width:100%;height:100%;font-family:var(--font-sans);font-size:12px;background:var(--muted)}
.nao-map .leaflet-control-zoom a{color:var(--foreground);background:var(--card);border-color:var(--border)}
.nao-map .leaflet-control-zoom a:hover{color:var(--foreground);background:var(--accent)}
.nao-map .leaflet-bar{border:1px solid var(--border);box-shadow:0 4px 12px rgb(0 0 0 / .08)}
.nao-map .leaflet-control-attribution{font-size:10px;color:var(--muted-foreground);background:color-mix(in srgb, var(--background) 80%, transparent)}
.nao-map .leaflet-control-attribution a{color:inherit}
.nao-map .leaflet-popup-content-wrapper,.nao-map .leaflet-popup-tip{color:var(--popover-foreground);background:var(--popover);box-shadow:0 20px 25px -5px rgb(0 0 0 / .1),0 8px 10px -6px rgb(0 0 0 / .1)}
.nao-map .leaflet-popup-content-wrapper{border:1px solid color-mix(in srgb, var(--border) 50%, transparent);border-radius:var(--radius-sm)}
.nao-map .leaflet-popup-content{margin:8px 12px;font-size:12px;line-height:1.5}
.nao-map .leaflet-tooltip{padding:6px 10px;font-size:12px;color:var(--foreground);background:var(--background);border:1px solid color-mix(in srgb, var(--border) 50%, transparent);border-radius:var(--radius-sm);box-shadow:0 8px 10px -6px rgb(0 0 0 / .1)}
.nao-map .leaflet-tooltip-top::before{border-top-color:var(--background)}
.nao-map .leaflet-tooltip-bottom::before{border-bottom-color:var(--background)}
.nao-map .leaflet-tooltip-left::before{border-left-color:var(--background)}
.nao-map .leaflet-tooltip-right::before{border-right-color:var(--background)}
.nao-map__tooltip{display:grid;gap:2px;line-height:1.4}
.nao-map__tooltip strong{font-weight:500}

.nao-table-wrap{display:flex;flex-direction:column;gap:8px;min-width:0}
.nao-table{min-width:0}
.nao-table-display{display:flex;flex-direction:column;min-height:0}
.nao-table-display__scroll{min-height:0;max-height:var(--nao-table-max-height, none);overflow:auto;background:var(--story-table-bg, var(--background));border-top:1px solid var(--border)}
.nao-table-display table{width:100%;min-width:max-content;border-collapse:collapse;font-size:12px}
.nao-table-display thead{position:sticky;top:0;z-index:10;background:var(--story-table-header-bg, var(--panel));border-bottom:var(--story-table-border-width, 1px) solid var(--story-table-border, var(--border))}
.nao-table-display th{padding:8px 12px;text-align:left;font-weight:500;white-space:nowrap;color:var(--story-table-header-fg, var(--foreground));box-shadow:inset -1px 0 0 0 var(--border)}
.nao-table-display th:last-child,.nao-table-display td:last-child{box-shadow:none}
.nao-table-display th button{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;padding:0;font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.nao-table-display th.nao-table-display__numeric span:first-child{margin-left:auto}
.nao-table-display td{padding:4px 12px;vertical-align:top;font-family:ui-monospace,monospace;font-size:11px;line-height:20px;white-space:nowrap;color:var(--story-body-color, var(--foreground));box-shadow:inset -1px 0 0 0 var(--border)}
.nao-table-display tbody tr{background:var(--story-table-bg, var(--background));border-bottom:1px solid color-mix(in srgb, var(--story-table-border, var(--border)) 50%, transparent)}
.nao-table-display tbody tr:last-child{border-bottom:0}
.nao-table-display tbody tr:hover{background:color-mix(in srgb, var(--accent) 30%, var(--story-table-bg, var(--background)))}
.nao-table-display__numeric{text-align:right;font-variant-numeric:tabular-nums}
th.nao-table-display__index,td.nao-table-display__index{width:16px;text-align:center;background:var(--story-table-header-bg, var(--panel))}
td.nao-table-display__index span{padding:0 4px;font-weight:500;color:var(--foreground)}
.nao-table-display__null{font-style:italic;color:color-mix(in srgb, var(--muted-foreground) 60%, transparent)}
.nao-table-display__sort{display:inline-flex;flex:none;flex-direction:column}
.nao-table-display__sort svg{width:12px;height:12px;margin:-2px 0;color:color-mix(in srgb, var(--muted-foreground) 50%, transparent)}
.nao-table-display__sort svg.nao-table-display__sort--active{color:var(--foreground)}
.nao-table-display__empty{padding:24px 12px;text-align:center;font-size:14px;color:var(--muted-foreground)}
.nao-table-display__row-count{display:flex;padding:8px 16px;font-size:12px;color:var(--muted-foreground);border-top:1px solid var(--border)}
.nao-table__footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:8px 16px;font-size:12px;color:var(--muted-foreground);border-top:1px solid var(--border)}
.nao-table__pager{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.nao-table__page-size{display:flex;align-items:center;gap:6px}
.nao-table__page-size select{height:24px;font:inherit;font-size:12px;color:inherit;background:transparent;border:0;border-radius:var(--radius-sm);padding:0 4px;cursor:pointer}
.nao-table__page-size select:hover{color:var(--foreground)}
.nao-table__pager-buttons{display:flex;align-items:center;gap:2px}
.nao-table__pager-buttons button{display:flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;color:inherit;background:transparent;border:0;border-radius:999px;cursor:pointer}
.nao-table__pager-buttons button svg{width:14px;height:14px}
.nao-table__pager-buttons button:hover:not(:disabled){background:color-mix(in srgb, var(--muted-foreground) 12%, transparent)}
.nao-table__pager-buttons button:disabled{opacity:.35;cursor:default}
.nao-table__toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px}
.nao-table__actions{display:flex;align-items:center;gap:2px}
.nao-table__actions button{display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;color:var(--muted-foreground);background:transparent;border:0;border-radius:999px;cursor:pointer}
.nao-table__actions button svg{width:13px;height:13px}
.nao-table__actions button:hover{background:color-mix(in srgb, var(--muted-foreground) 14%, transparent);color:var(--foreground)}
.nao-table__export{position:relative}
.nao-table__export-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:20;display:flex;flex-direction:column;min-width:140px;padding:4px;background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);border-radius:var(--radius-sm);box-shadow:0 8px 24px rgb(0 0 0 / .12)}
.nao-table__export-menu button{width:100%;padding:6px 8px;font:inherit;font-size:12px;text-align:left;color:inherit;background:transparent;border:0;border-radius:var(--radius-sm);cursor:pointer}
.nao-table__export-menu button:hover{background:var(--accent)}
.nao-table__overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:24px;background:rgb(0 0 0 / .45)}
.nao-table__overlay-card{display:flex;flex-direction:column;gap:8px;width:100%;max-width:min(95vw,72rem);max-height:90vh;padding:16px;background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:var(--radius-sm);box-shadow:0 20px 50px rgb(0 0 0 / .25)}
.nao-table__overlay-card .nao-table{--nao-table-max-height:calc(90vh - 120px)}
.nao-table__overlay-close{display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;color:var(--muted-foreground);background:transparent;border:0;border-radius:999px;cursor:pointer}
.nao-table__overlay-close:hover{background:color-mix(in srgb, var(--muted-foreground) 14%, transparent);color:var(--foreground)}
.nao-table__overlay-close svg{width:14px;height:14px}
`;
