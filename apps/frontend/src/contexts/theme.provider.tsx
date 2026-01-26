import { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark' | 'system';

const ThemeContext = createContext<{
	theme: Theme;
	setTheme: (theme: Theme) => void;
} | null>(null);

export const useTheme = () => {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error('useTheme must be used within a ThemeProvider');
	}
	return context;
};

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
	const [theme, setTheme] = useState<Theme>(() => {
		const saved = localStorage.getItem('theme');
		return (saved as Theme) || 'system';
	});

	useEffect(() => {
		localStorage.setItem('theme', theme);
	}, [theme]);
	useEffect(() => {
		const root = document.documentElement;
		root.classList.remove('dark');

		if (theme === 'dark') {
			root.classList.add('dark');
		} else if (theme === 'system') {
			const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			if (systemDark) {
				root.classList.add('dark');
			}
			const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			const handleChange = (e: MediaQueryListEvent) => {
				root.classList.remove('dark');
				if (e.matches) {
					root.classList.add('dark');
				}
			};
			mediaQuery.addEventListener('change', handleChange);
			return () => mediaQuery.removeEventListener('change', handleChange);
		}
	}, [theme]);

	return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};
