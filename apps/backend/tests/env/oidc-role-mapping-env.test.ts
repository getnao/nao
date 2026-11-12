import { vi } from 'vitest';

import { describeDeprecatedEnvVariableMigration } from '../helpers/deprecated-env-variable';

vi.mock('dotenv', () => ({
	default: { config: vi.fn() },
}));

describeDeprecatedEnvVariableMigration({
	title: 'OIDC organization-role mapping environment migration',
	canonicalName: 'OIDC_GROUP_NAO_ROLE_MAPPING',
	deprecatedName: 'OIDC_GROUP_ROLE_MAPPING',
	canonicalValue: 'nao-admins:admin',
	deprecatedValue: 'nao-viewers:viewer',
	ignoredDeprecatedValue: 'nao-viewers:viewer',
});
