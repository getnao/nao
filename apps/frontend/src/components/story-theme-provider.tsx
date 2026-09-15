import { ChartStyleContext, DEFAULT_CHART_STYLE } from '@nao/shared';
import { storyThemeToCssVars } from '@nao/shared/story-theme';
import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ChartStyle } from '@nao/shared';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

const StoryThemeContext = createContext<StoryTheme | null>(null);

export function useActiveStoryTheme(): StoryTheme | null {
	return useContext(StoryThemeContext);
}

interface StoryThemeProviderProps {
	theme: StoryTheme | null;
	children: ReactNode;
	className?: string;
}

export function StoryThemeProvider({ theme, children, className }: StoryThemeProviderProps) {
	useFontStylesheets(theme?.text.fontStylesheets ?? []);
	const style = useMemo(() => (theme ? toReactStyle(storyThemeToCssVars(theme)) : undefined), [theme]);
	const chartStyle = useMemo<ChartStyle>(
		() => (theme ? { barRadius: theme.charts.barRadius } : DEFAULT_CHART_STYLE),
		[theme],
	);

	return (
		<StoryThemeContext.Provider value={theme}>
			<ChartStyleContext.Provider value={chartStyle}>
				<div
					className={cn('h-full min-h-0', className)}
					style={style}
					data-story-themed={theme ? 'true' : undefined}
					data-story-table-striped={theme?.table.stripedRows ? 'true' : undefined}
				>
					{children}
				</div>
			</ChartStyleContext.Provider>
		</StoryThemeContext.Provider>
	);
}

function toReactStyle(cssVars: Record<string, string>): CSSProperties {
	const { 'color-scheme': colorScheme, ...customProperties } = cssVars;
	return { ...customProperties, colorScheme } as CSSProperties;
}

const stylesheetRefCounts = new Map<string, number>();

/**
 * Webfonts must be loaded document-wide, so stylesheet links go in <head> and
 * are reference-counted: unmounting one themed story must not remove a face
 * another one is still using.
 */
function useFontStylesheets(hrefs: string[]) {
	const key = hrefs.join('|');
	useEffect(() => {
		if (!key) {
			return;
		}
		const urls = key.split('|');
		for (const href of urls) {
			stylesheetRefCounts.set(href, (stylesheetRefCounts.get(href) ?? 0) + 1);
			if (!findStylesheetLink(href)) {
				const link = document.createElement('link');
				link.rel = 'stylesheet';
				link.href = href;
				link.dataset.storyFont = href;
				document.head.appendChild(link);
			}
		}
		return () => {
			for (const href of urls) {
				const next = (stylesheetRefCounts.get(href) ?? 1) - 1;
				if (next <= 0) {
					stylesheetRefCounts.delete(href);
					findStylesheetLink(href)?.remove();
				} else {
					stylesheetRefCounts.set(href, next);
				}
			}
		};
	}, [key]);
}

function findStylesheetLink(href: string): HTMLLinkElement | null {
	const links = document.head.querySelectorAll<HTMLLinkElement>('link[data-story-font]');
	return Array.from(links).find((link) => link.dataset.storyFont === href) ?? null;
}
