import { useEffect, useState } from 'react';
import { useTheme } from '@/contexts/theme.provider';

export function useEditorTheme(): 'vs' | 'vs-dark' {
	const { theme } = useTheme();
	const [editorTheme, setEditorTheme] = useState<'vs' | 'vs-dark'>(() => resolveTheme(theme));

	useEffect(() => {
		if (theme !== 'system') {
			setEditorTheme(theme === 'dark' ? 'vs-dark' : 'vs');
			return;
		}

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		setEditorTheme(mediaQuery.matches ? 'vs-dark' : 'vs');

		const handler = (e: MediaQueryListEvent) => {
			setEditorTheme(e.matches ? 'vs-dark' : 'vs');
		};
		mediaQuery.addEventListener('change', handler);
		return () => mediaQuery.removeEventListener('change', handler);
	}, [theme]);

	return editorTheme;
}

function resolveTheme(theme: 'light' | 'dark' | 'system'): 'vs' | 'vs-dark' {
	if (theme === 'dark') {
		return 'vs-dark';
	}
	if (theme === 'light') {
		return 'vs';
	}
	if (typeof window !== 'undefined') {
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs';
	}
	return 'vs';
}
