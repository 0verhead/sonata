import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ConfigSchema, type Config } from "../types/index.js";

const CONFIG_DIR = path.join(os.homedir(), ".notion-code");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/**
 * Default configuration
 */
export const defaultConfig: Config = {
  notion: {
    boardId: undefined,
    viewId: undefined,
    boardName: undefined,
    statusColumn: {
      todo: "To Do",
      inProgress: "In Progress",
      done: "Done",
    },
  },
  git: {
    createBranch: true,
    createPR: true,
    baseBranch: "main",
  },
  loop: {
    maxIterations: 10,
  },
};

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Check if config file exists
 */
export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

/**
 * Load configuration from file with zod validation
 */
export function loadConfig(): Config {
  if (!configExists()) {
    return { ...defaultConfig };
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content);

    // Merge with defaults first to ensure all fields exist
    const merged = {
      notion: {
        ...defaultConfig.notion,
        ...parsed.notion,
        statusColumn: {
          ...defaultConfig.notion.statusColumn,
          ...parsed.notion?.statusColumn,
        },
      },
      git: {
        ...defaultConfig.git,
        ...parsed.git,
      },
      loop: {
        ...defaultConfig.loop,
        ...parsed.loop,
      },
    };

    // Validate with zod
    const result = ConfigSchema.safeParse(merged);
    if (result.success) {
      return result.data;
    }

    // If validation fails, return defaults
    console.warn("Config validation failed, using defaults:", result.error.message);
    return { ...defaultConfig };
  } catch {
    return { ...defaultConfig };
  }
}

/**
 * Save configuration to file (validates before saving)
 */
export function saveConfig(config: Config): void {
  // Validate before saving
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid config: ${result.error.message}`);
  }

  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(result.data, null, 2), "utf-8");
}

/**
 * Update specific config values
 */
export function updateConfig(updates: Partial<Config>): Config {
  const current = loadConfig();

  const merged = {
    notion: {
      ...current.notion,
      ...updates.notion,
      statusColumn: {
        ...current.notion.statusColumn,
        ...updates.notion?.statusColumn,
      },
    },
    git: {
      ...current.git,
      ...updates.git,
    },
    loop: {
      ...current.loop,
      ...updates.loop,
    },
  };

  // Validate before saving
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid config update: ${result.error.message}`);
  }

  saveConfig(result.data);
  return result.data;
}

/**
 * Reset config to defaults
 */
export function resetConfig(): void {
  saveConfig(defaultConfig);
}

/**
 * Get the config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}
