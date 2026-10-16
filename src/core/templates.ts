import skill from "../../skills/content-factory/SKILL.md" with { type: "text" };

/**
 * The agent skill installed into each workspace for Claude Code and Codex. It is imported as text
 * so the compiled sidecar carries it too; it has no package folder to read it from.
 */
export const SKILL_MARKDOWN: string = skill;
