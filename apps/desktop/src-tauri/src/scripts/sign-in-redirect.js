/**
 * The nao web app moves to /login or /signup with the History API, which native navigation
 * handlers never see. Turning those client-side moves into a real navigation lets the Rust
 * navigation handler cancel it and start the browser sign-in instead.
 */
(() => {
	if (window.top !== window) {
		return;
	}

	const signInPaths = ['/login', '/signup'];
	const leaveIfOnSignInPage = () => {
		const path = window.location.pathname.replace(/\/+$/, '');
		if (signInPaths.includes(path)) {
			window.location.replace(window.location.href);
		}
	};

	for (const method of ['pushState', 'replaceState']) {
		const original = window.history[method];
		window.history[method] = function (...args) {
			const result = original.apply(this, args);
			leaveIfOnSignInPage();
			return result;
		};
	}
	window.addEventListener('popstate', leaveIfOnSignInPage);
})();
