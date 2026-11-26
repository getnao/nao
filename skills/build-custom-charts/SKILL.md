---
name: build-custom-charts
description: Create or update browser-rendered custom nao chart modules in agent/charts.
---

# build-custom-charts

Use this skill when a project needs a visualization beyond nao's built-in chart types.

## Create a chart

Add `agent/charts/<type>.js`, where `<type>` starts with a lowercase letter and may then contain lowercase letters, numbers, hyphens, or underscores. It must not collide with a built-in chart type (such as `bar`, `line`, `pie`) or `table`. Names that break these rules are silently ignored. The file must export a `render` function:

```js
export function render(element, context) {
	const { data, config, colors, theme, libs } = context;

	element.textContent = `${data.length} rows`;
	return () => element.replaceChildren();
}
```

The context contains:

- `data`: rows from the referenced `execute_sql` result
- `config`: `chartType`, `xAxisKey`, `xAxisType`, `series`, and `title`
- `colors`: nao's default chart palette
- `theme`: `light` or `dark`
- `libs`: the installed `React`, `ReactDOM`, and `Recharts` modules
- `settings`: the `settings` prop of the chart's block in a custom story, or `undefined`
- `mode`: `view`, `edit` while someone who can change the story has it open, or `print` in PDF exports and deliveries
- `saveSettings(settings)`: only in `edit` mode; writes `settings` into the block's `settings` prop as a new story version, and resolves once it is published

`render` may return a promise: PDF exports and deliveries wait for it, up to 15 seconds, before printing.

## Save settings from the chart

A chart with its own settings panel keeps what a user changed in the story itself, without asking the agent:

```js
export function render(element, context) {
	const palette = context.settings?.palette ?? 'default';
	draw(element, context.data, palette);
	if (context.saveSettings) {
		showPaletteMenu(element, palette, (next) => context.saveSettings({ palette: next }));
	}
}
```

In the story, the settings sit next to the chart's other props, as a JSON value: `<Chart type="waterfall" queryId="..." settings={{ palette: 'warm' }} />`. Saving with `null` removes the prop. Show editing controls only when `saveSettings` is defined, and keep `print` output free of controls and transient messages.

Use plain JavaScript without JSX. Do not import bare package names; use the libraries from `context.libs`. A React chart must return a cleanup function that unmounts its root.

Optionally add `agent/charts/<type>.json`:

```json
{
	"name": "Bubble chart",
	"description": "Shows two numeric axes while marker size represents a third measure."
}
```

The description tells the agent when to select the chart. Without metadata, nao derives a name from the file name.

## Constraints

- Custom charts render only in authenticated, interactive web chats.
- Custom stories render custom charts, including their PDF exports and deliveries. PNG exports, automations, MCP embeds, and messaging channels use built-in charts.
- Keep modules self-contained and treat them as trusted project code.
- Return cleanup for event listeners, timers, React roots, and other resources.
- Editing the module reloads active custom charts within a few seconds.
