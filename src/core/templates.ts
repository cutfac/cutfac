import skill from "../../skills/content-factory/SKILL.md" with { type: "text" };
import product from "../../templates/product.yaml" with { type: "text" };

/**
 * Files a new workspace starts from. They are imported as text so the compiled sidecar carries
 * them too; it has no package folder to read them from.
 */
export const PRODUCT_TEMPLATE: string = product;

/** The agent skill installed into each workspace for Claude Code and Codex. */
export const SKILL_MARKDOWN: string = skill;
