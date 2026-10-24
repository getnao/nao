import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { RouteErrorPage } from '@/components/route-error-page';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
	state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error('Uncaught React error', error, info.componentStack);
	}

	render() {
		return this.state.hasError ? <RouteErrorPage fullScreen /> : this.props.children;
	}
}
