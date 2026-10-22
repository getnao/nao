import { ChartStyleContext, DEFAULT_CHART_STYLE } from '@nao/shared';
import { storyThemeToCssVars } from '@nao/shared/story-theme';
import { storyBrandStyles } from '@nao/shared/story-theme-brand-styles';
import { useEffect, useMemo, useState } from 'react';
import type { ChartStyle } from '@nao/shared';
import type { StoryTheme, StoryThemePair } from '@nao/shared/story-theme';
import type { CSSProperties, ReactNode } from 'react';

import { PortalContainerContext } from '@/contexts/portal-container';
import { useIsDarkMode } from '@/contexts/theme.provider';
import { cn } from '@/lib/utils';

interface StoryThemeProviderProps {
	theme: StoryTheme | null;
	children: ReactNode;
	className?: string;
}

export function StoryThemeProvider({ theme, children, className }: StoryThemeProviderProps) {
	useFontStylesheets(theme?.text.fontStylesheets ?? []);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const style = useMemo(() => (theme ? toReactStyle(storyThemeToCssVars(theme)) : undefined), [theme]);
	const chartStyle = useMemo<ChartStyle>(
		() => (theme ? { barRadius: theme.charts.barRadius } : DEFAULT_CHART_STYLE),
		[theme],
	);

	return (
		<ChartStyleContext.Provider value={chartStyle}>
			<div
				ref={setContainer}
				className={cn('h-full min-h-0', className)}
				style={style}
				data-story-themed={theme ? 'true' : undefined}
				data-story-table-striped={theme?.table.stripedRows ? 'true' : undefined}
			>
				{theme && <style>{BRAND_STYLES}</style>}
				<PortalContainerContext.Provider value={theme ? container : null}>
					{children}
				</PortalContainerContext.Provider>
			</div>
		</ChartStyleContext.Provider>
	);
}

export function useStoryThemeForCurrentMode(pair: StoryThemePair | null | undefined): StoryTheme | null {
	const isDarkMode = useIsDarkMode();
	return pair ? pair[isDarkMode ? 'dark' : 'light'] : null;
}

const BRAND_STYLES = storyBrandStyles("[data-story-themed='true'] ");

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
	const key = hrefs.length > 0 ? JSON.stringify(hrefs) : '';
	useEffect(() => {
		if (!key) {
			return;
		}
		const urls = JSON.parse(key) as string[];
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
