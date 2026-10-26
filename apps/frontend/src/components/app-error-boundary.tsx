import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { RouteErrorPage } from '@/components/route-error-page';
import { TooltipProvider } from '@/components/ui/tooltip';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state = { error: null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error('Uncaught React error', error, info.componentStack);
	}

	render() {
		return this.state.error ? (
			<TooltipProvider>
				<RouteErrorPage error={this.state.error} fullScreen />
			</TooltipProvider>
		) : (
			this.props.children
		);
	}
}
