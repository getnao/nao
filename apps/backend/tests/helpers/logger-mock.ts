import { vi } from 'vitest';

/** Module stand-in for `src/utils/logger`: `vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'))`. */
export const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
