/* React ships as CommonJS, so `export *` cannot be resolved statically; the names are listed and kept in sync by a test. */
import * as module from 'react/jsx-runtime';

export const { Fragment, jsx, jsxs } = module;
