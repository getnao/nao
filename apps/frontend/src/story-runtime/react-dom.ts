/* React ships as CommonJS, so `export *` cannot be resolved statically; the names are listed and kept in sync by a test. */
import * as module from 'react-dom';

export const {
	createPortal,
	flushSync,
	preconnect,
	prefetchDNS,
	preinit,
	preinitModule,
	preload,
	preloadModule,
	requestFormReset,
	unstable_batchedUpdates,
	useFormState,
	useFormStatus,
	version,
} = module;

export default module;
