import { isCloud } from '../env';

/**
 * A variable of the nao process, used as a fallback for one that a project's config files reference.
 * Self-hosted deployments rely on it. On nao Cloud those files are written by tenants and the process
 * environment holds nao's own secrets, so only the project's variables may resolve a reference.
 */
export function getDeploymentEnvVar(name: string): string | undefined {
	return isCloud ? undefined : process.env[name];
}
