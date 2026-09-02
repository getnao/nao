/**
 * Internal skills are playbooks nao ships with itself, rather than ones a user writes in
 * their project. They exist to teach the loop how to handle something the tools alone do
 * not explain — a file format with traps in it, typically.
 *
 * They are deliberately invisible to users: they never appear in the `/` picker, because
 * nobody should have to know they exist for the agent to do the right thing. Only the name
 * and the description sit in the system prompt; the body is loaded on demand.
 */
export interface InternalSkill {
	name: string;
	/** Shown in the system prompt catalog, so it has to say when the skill is worth loading. */
	description: string;
	/**
	 * Written for the run that loads it: a playbook that sends the agent to a tool the
	 * deployment does not have is worse than no playbook, because it looks like a way out.
	 */
	body: (capabilities: SkillCapabilities) => string;
}

/** What the run loading a skill can do, for the parts of a playbook that depend on it. */
export interface SkillCapabilities {
	/** False when `execute_sandboxed_code` is not in the run's tool set, so pandas is not an option. */
	canRunSandbox: boolean;
}
