import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

const OPENCODE_CONFIG_FILE = 'opencode.json';

/**
 * Schema for opencode.json MCP server config
 */
const McpServerSchema = z.object({
  type: z.enum(['local', 'remote']),
  url: z.string().optional(),
  command: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  environment: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: z.union([z.object({}), z.literal(false)]).optional(),
});

/**
 * Valid reasoning effort levels for Claude models
 */
export const ReasoningEffortLevels = ['low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof ReasoningEffortLevels)[number];

const OpenCodeConfigSchema = z
  .object({
    $schema: z.string().optional(),
    mcp: z.record(z.string(), McpServerSchema).optional(),
    model: z.string().optional(),
    reasoningEffort: z.enum(ReasoningEffortLevels).optional(),
  })
  .passthrough(); // Allow other fields we don't know about

type OpenCodeConfig = z.infer<typeof OpenCodeConfigSchema>;

/**
 * Get the path to opencode.json in the given directory
 */
export function getOpenCodeConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, OPENCODE_CONFIG_FILE);
}

/**
 * Check if opencode.json exists
 */
export function openCodeConfigExists(cwd: string = process.cwd()): boolean {
  return fs.existsSync(getOpenCodeConfigPath(cwd));
}

/**
 * Load opencode.json, returns empty config if doesn't exist
 */
export function loadOpenCodeConfig(cwd: string = process.cwd()): OpenCodeConfig {
  const configPath = getOpenCodeConfigPath(cwd);

  if (!fs.existsSync(configPath)) {
    return {
      $schema: 'https://opencode.ai/config.json',
    };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    const result = OpenCodeConfigSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    // If validation fails, return what we parsed but add schema
    return {
      $schema: 'https://opencode.ai/config.json',
      ...parsed,
    };
  } catch {
    return {
      $schema: 'https://opencode.ai/config.json',
    };
  }
}

/**
 * Save opencode.json
 */
export function saveOpenCodeConfig(config: OpenCodeConfig, cwd: string = process.cwd()): void {
  const configPath = getOpenCodeConfigPath(cwd);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Add or update the Notion MCP server in opencode.json
 */
export function configureNotionMcp(cwd: string = process.cwd()): {
  created: boolean;
  updated: boolean;
  path: string;
} {
  const configPath = getOpenCodeConfigPath(cwd);
  const existed = openCodeConfigExists(cwd);
  const config = loadOpenCodeConfig(cwd);

  // Check if Notion MCP already configured
  const hadNotion = config.mcp?.notion !== undefined;

  // Ensure mcp object exists
  if (!config.mcp) {
    config.mcp = {};
  }

  // Add/update Notion MCP
  config.mcp.notion = {
    type: 'remote',
    url: 'https://mcp.notion.com/mcp',
    enabled: true,
  };

  // Ensure schema is set
  if (!config.$schema) {
    config.$schema = 'https://opencode.ai/config.json';
  }

  saveOpenCodeConfig(config, cwd);

  return {
    created: !existed,
    updated: existed && !hadNotion,
    path: configPath,
  };
}

/**
 * Check if Notion MCP is configured in opencode.json
 */
export function isNotionMcpConfigured(cwd: string = process.cwd()): boolean {
  if (!openCodeConfigExists(cwd)) {
    return false;
  }

  const config = loadOpenCodeConfig(cwd);
  const notion = config.mcp?.notion;

  if (!notion) {
    return false;
  }

  return notion.type === 'remote' && notion.url === 'https://mcp.notion.com/mcp';
}

/**
 * Get the currently configured model from opencode.json
 * Returns undefined if no model is set
 */
export function getModel(cwd: string = process.cwd()): string | undefined {
  const config = loadOpenCodeConfig(cwd);
  return config.model;
}

/**
 * Set the model in opencode.json
 * Creates the config file if it doesn't exist
 */
export function setModel(model: string, cwd: string = process.cwd()): void {
  const config = loadOpenCodeConfig(cwd);
  config.model = model;

  // Ensure schema is set
  if (!config.$schema) {
    config.$schema = 'https://opencode.ai/config.json';
  }

  saveOpenCodeConfig(config, cwd);
}

/**
 * Get the currently configured reasoning effort from opencode.json
 * Returns undefined if no reasoning effort is set
 */
export function getReasoningEffort(cwd: string = process.cwd()): ReasoningEffort | undefined {
  const config = loadOpenCodeConfig(cwd);
  return config.reasoningEffort;
}

/**
 * Set the reasoning effort in opencode.json
 * Creates the config file if it doesn't exist
 */
export function setReasoningEffort(effort: ReasoningEffort, cwd: string = process.cwd()): void {
  const config = loadOpenCodeConfig(cwd);
  config.reasoningEffort = effort;

  // Ensure schema is set
  if (!config.$schema) {
    config.$schema = 'https://opencode.ai/config.json';
  }

  saveOpenCodeConfig(config, cwd);
}

/**
 * Represents a model available in OpenCode
 */
export interface AvailableModel {
  /** Full model identifier (e.g., "anthropic/claude-sonnet-4-5") */
  id: string;
  /** Provider name (e.g., "anthropic", "openai", "openrouter") */
  provider: string;
  /** Model name without provider prefix (e.g., "claude-sonnet-4-5") */
  name: string;
}

/**
 * Get all available models by running `opencode models` and parsing the output
 * Returns an array of AvailableModel objects sorted by provider then name
 * @throws Error if the opencode command fails
 */
export function getAvailableModels(): AvailableModel[] {
  try {
    const output = execSync('opencode models', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = output.trim().split('\n').filter(Boolean);
    const models: AvailableModel[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Parse provider/model-name format
      const slashIndex = trimmed.indexOf('/');
      if (slashIndex === -1) {
        // No provider prefix, use the whole string as both
        models.push({
          id: trimmed,
          provider: '',
          name: trimmed,
        });
      } else {
        models.push({
          id: trimmed,
          provider: trimmed.slice(0, slashIndex),
          name: trimmed.slice(slashIndex + 1),
        });
      }
    }

    return models;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get available models: ${message}`);
  }
}
