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

const OpenCodeConfigSchema = z
  .object({
    $schema: z.string().optional(),
    mcp: z.record(z.string(), McpServerSchema).optional(),
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
