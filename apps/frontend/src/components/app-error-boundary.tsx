import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { RouteErrorPage } from '@/components/route-error-page';
import { TooltipProvider } from '@/components/ui/tooltip';

interface AppErrorBoundaryState {
	hasError: boolean;
	error: unknown;
	componentStack: string | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
	state: AppErrorBoundaryState = { hasError: false, error: undefined, componentStack: null };

	static getDerivedStateFromError(error: unknown) {
		return { hasError: true, error };
	}

	componentDidCatch(error: unknown, info: ErrorInfo) {
		console.error('Uncaught React error', error, info.componentStack);
		this.setState({ componentStack: info.componentStack ?? null });
	}

	render() {
		return this.state.hasError ? (
			<TooltipProvider>
				<RouteErrorPage error={this.state.error} componentStack={this.state.componentStack} fullScreen />
			</TooltipProvider>
		) : (
			this.props.children
		);
	}
}
