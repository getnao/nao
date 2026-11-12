import { vi } from 'vitest';

import { describeDeprecatedEnvVariableMigration } from '../helpers/deprecated-env-variable';

vi.mock('dotenv', () => ({
	default: { config: vi.fn() },
}));

describeDeprecatedEnvVariableMigration({
	title: 'Microsoft Entra organization-role mapping environment migration',
	canonicalName: 'AZURE_AD_GROUP_NAO_ROLE_MAPPING',
	deprecatedName: 'AZURE_AD_GROUP_ROLE_MAPPING',
	canonicalValue: 'a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin',
	deprecatedValue: 'a0b1c2d3-e4f5-6789-abcd-ef0123456789:viewer',
	ignoredDeprecatedValue: 'invalid-deprecated-value',
});
