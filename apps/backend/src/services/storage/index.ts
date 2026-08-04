import path from 'node:path';

import { env } from '../../env';
import { LocalStorageProvider } from './local.provider';
import { S3StorageProvider } from './s3.provider';
import type { StorageBackendSetting, StorageHealth, StorageProvider } from './types';

export { relativePathFromKey, sanitizeRelativePath, scopedKey, scopeRoot } from './keys';
export type {
	StorageBackend,
	StorageBackendSetting,
	StorageHealth,
	StorageObject,
	StorageProvider,
	StorageScope,
} from './types';

export type CredentialSource = 'explicit' | 'default-chain';

export interface StorageConfigSummary {
	backend: StorageBackendSetting;
	maxFileSizeMb: number;
	local?: { path: string };
	s3?: {
		bucket: string;
		region?: string;
		endpoint?: string;
		prefix?: string;
		forcePathStyle: boolean;
		credentialSource: CredentialSource;
		accessKeyId?: string;
	};
}

export const STORAGE_DISABLED_MESSAGE =
	'Permanent storage is disabled on this nao instance. Ask an admin to set NAO_STORAGE_BACKEND to `local` or `s3`.';

let provider: StorageProvider | null = null;

export const isStorageEnabled = (): boolean => {
	return env.NAO_STORAGE_BACKEND !== 'none';
};

/** @throws Error when permanent storage is disabled. */
export const getStorage = (): StorageProvider => {
	if (!isStorageEnabled()) {
		throw new Error(STORAGE_DISABLED_MESSAGE);
	}
	provider ??= createProvider();
	return provider;
};

export const getStorageHealth = async (): Promise<StorageHealth> => {
	if (!isStorageEnabled()) {
		return { ok: false, error: STORAGE_DISABLED_MESSAGE };
	}
	return getStorage().healthCheck();
};

/** Display-safe view of the configuration; secrets never leave this module. */
export const getStorageConfig = (): StorageConfigSummary => {
	const maxFileSizeMb = env.NAO_STORAGE_MAX_FILE_SIZE_MB;

	if (env.NAO_STORAGE_BACKEND === 'none') {
		return { backend: 'none', maxFileSizeMb };
	}

	if (env.NAO_STORAGE_BACKEND === 's3') {
		return {
			backend: 's3',
			maxFileSizeMb,
			s3: {
				bucket: env.NAO_STORAGE_S3_BUCKET ?? '',
				region: env.NAO_STORAGE_S3_REGION,
				endpoint: env.NAO_STORAGE_S3_ENDPOINT,
				prefix: env.NAO_STORAGE_S3_PREFIX,
				forcePathStyle: env.NAO_STORAGE_S3_FORCE_PATH_STYLE,
				credentialSource: hasExplicitS3Credentials() ? 'explicit' : 'default-chain',
				accessKeyId: maskCredential(env.NAO_STORAGE_S3_ACCESS_KEY_ID),
			},
		};
	}

	return {
		backend: 'local',
		maxFileSizeMb,
		local: { path: path.resolve(env.NAO_STORAGE_LOCAL_PATH) },
	};
};

/** TEST ONLY — drops the cached provider so a new env can take effect. */
export const __resetStorageForTesting = (): void => {
	provider = null;
};

const createProvider = (): StorageProvider => {
	if (env.NAO_STORAGE_BACKEND === 's3') {
		return new S3StorageProvider({
			bucket: env.NAO_STORAGE_S3_BUCKET!,
			region: env.NAO_STORAGE_S3_REGION,
			endpoint: env.NAO_STORAGE_S3_ENDPOINT,
			prefix: env.NAO_STORAGE_S3_PREFIX,
			forcePathStyle: env.NAO_STORAGE_S3_FORCE_PATH_STYLE,
			accessKeyId: env.NAO_STORAGE_S3_ACCESS_KEY_ID,
			secretAccessKey: env.NAO_STORAGE_S3_SECRET_ACCESS_KEY,
		});
	}

	return new LocalStorageProvider(env.NAO_STORAGE_LOCAL_PATH);
};

const hasExplicitS3Credentials = (): boolean => {
	return Boolean(env.NAO_STORAGE_S3_ACCESS_KEY_ID && env.NAO_STORAGE_S3_SECRET_ACCESS_KEY);
};

const maskCredential = (value: string | undefined): string | undefined => {
	if (!value) {
		return undefined;
	}
	if (value.length <= 8) {
		return '••••••••';
	}
	return `${value.slice(0, 4)}••••${value.slice(-4)}`;
};
