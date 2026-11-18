/* React ships as CommonJS, so `export *` cannot be resolved statically; the names are listed and kept in sync by a test. */
import * as module from 'react-dom/client';

export const { createRoot, hydrateRoot } = module;

export default module;
