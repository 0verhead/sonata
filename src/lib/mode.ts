import type { Config } from "../types/index.js";
import { specsExist } from "./specs.js";

/**
 * Mode type: local specs folder or Notion
 */
export type Mode = "local" | "notion";

/**
 * Mode flags from CLI
 */
export interface ModeFlags {
  local?: boolean;
  notion?: boolean;
}

/**
 * Error thrown when mode cannot be resolved
 */
export class ModeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModeResolutionError";
  }
}

/**
 * Resolve which mode to use based on flags, config, and environment
 * 
 * Resolution order:
 * 1. If --local flag → use local mode
 * 2. If --notion flag → use Notion mode
 * 3. If config.mode is set → use that mode (no conflict check)
 * 4. If config.mode NOT set AND both specs/ AND Notion exist → ERROR
 * 5. If only specs/ folder exists → use local mode
 * 6. If only Notion configured → use Notion mode
 * 7. Otherwise → throw error (run setup)
 */
export function resolveMode(
  flags: ModeFlags,
  config: Config,
  cwd: string
): Mode {
  // 1. Explicit flags take priority
  if (flags.local) {
    return "local";
  }
  if (flags.notion) {
    return "notion";
  }

  // 2. Config default
  if (config.mode) {
    return config.mode;
  }

  // 3. Auto-detect with conflict check
  const hasSpecs = specsExist(cwd, config.local?.specsDir);
  const hasNotion = Boolean(config.notion.boardId);

  if (hasSpecs && hasNotion) {
    throw new ModeResolutionError(
      "Both specs/ folder and Notion are configured. Use --local or --notion flag, or set mode in config."
    );
  }

  if (hasSpecs) {
    return "local";
  }

  if (hasNotion) {
    return "notion";
  }

  throw new ModeResolutionError(
    "No mode configured. Run `notion-code setup` first, or create a specs/ folder."
  );
}

/**
 * Check if local mode is available (specs folder exists)
 */
export function isLocalModeAvailable(cwd: string, specsDir?: string): boolean {
  return specsExist(cwd, specsDir);
}

/**
 * Check if Notion mode is available (board configured)
 */
export function isNotionModeAvailable(config: Config): boolean {
  return Boolean(config.notion.boardId);
}

/**
 * Get a description of the current mode state
 */
export function describeModeState(config: Config, cwd: string): string {
  const hasSpecs = specsExist(cwd, config.local?.specsDir);
  const hasNotion = Boolean(config.notion.boardId);
  const configuredMode = config.mode;

  const parts: string[] = [];

  if (configuredMode) {
    parts.push(`Configured mode: ${configuredMode}`);
  }

  if (hasSpecs) {
    parts.push("Local specs/ folder: present");
  }

  if (hasNotion) {
    parts.push(`Notion board: ${config.notion.boardName || config.notion.boardId}`);
  }

  if (!hasSpecs && !hasNotion && !configuredMode) {
    parts.push("No mode configured");
  }

  return parts.join("\n");
}
