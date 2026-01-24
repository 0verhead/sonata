import * as fs from 'node:fs';
import path from 'node:path';

import {
  SpecFrontmatterSchema,
  type Spec,
  type SpecFrontmatter,
  type SpecStatus,
  type CreateSpecData,
  type ListSpecsOptions,
} from '../types/specs.js';

const DEFAULT_SPECS_DIR = 'specs';

/**
 * Get the specs directory path
 */
export function specsDir(cwd: string, customDir?: string): string {
  return path.join(cwd, customDir ?? DEFAULT_SPECS_DIR);
}

/**
 * Check if specs folder exists
 */
export function specsExist(cwd: string, customDir?: string): boolean {
  return fs.existsSync(specsDir(cwd, customDir));
}

/**
 * Ensure specs directory exists
 */
export function ensureSpecsDir(cwd: string, customDir?: string): void {
  const dir = specsDir(cwd, customDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate a slug filename from title
 */
export function specFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, '')
      .slice(0, 60) + '.md'
  );
}

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];

  // Simple YAML parsing (handles basic key: value pairs)
  const frontmatter: Record<string, unknown> = {};
  const lines = yamlContent.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, Math.max(0, colonIndex)).trim();
      let value: string | undefined = line.slice(Math.max(0, colonIndex + 1)).trim();

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Serialize frontmatter to YAML string
 */
function serializeFrontmatter(frontmatter: SpecFrontmatter): string {
  const lines = [
    '---',
    `id: ${frontmatter.id}`,
    `title: ${frontmatter.title}`,
    `status: ${frontmatter.status}`,
  ];

  if (frontmatter.priority) {
    lines.push(`priority: ${frontmatter.priority}`);
  }

  lines.push(`created: ${frontmatter.created}`, `updated: ${frontmatter.updated}`, '---');

  return lines.join('\n');
}

/**
 * Parse a spec file
 */
function parseSpecFile(filepath: string): Spec | null {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);

    const result = SpecFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      console.warn(`Invalid spec frontmatter in ${filepath}: ${result.error.message}`);
      return null;
    }

    return {
      ...result.data,
      content: body.trim(),
      filepath,
    };
  } catch {
    return null;
  }
}

/**
 * List all specs in the specs folder
 */
export function listSpecs(cwd: string, options?: ListSpecsOptions): Spec[] {
  const dir = specsDir(cwd);

  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const specs: Spec[] = [];

  for (const file of files) {
    const filepath = path.join(dir, file);
    const spec = parseSpecFile(filepath);
    if (spec) {
      // Apply filters
      if (options?.status && spec.status !== options.status) {
        continue;
      }
      if (options?.priority && spec.priority !== options.priority) {
        continue;
      }
      specs.push(spec);
    }
  }

  // Sort by priority (high > medium > low), then by created date
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  specs.sort((a, b) => {
    const aPriority = a.priority ? priorityOrder[a.priority] : 999;
    const bPriority = b.priority ? priorityOrder[b.priority] : 999;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    return new Date(a.created).getTime() - new Date(b.created).getTime();
  });

  return specs;
}

/**
 * Get a single spec by ID
 */
export function getSpec(cwd: string, id: string): Spec | null {
  const specs = listSpecs(cwd);
  return specs.find((s) => s.id === id) ?? null;
}

/**
 * Get specs by status
 */
export function getSpecsByStatus(cwd: string, status: SpecStatus): Spec[] {
  return listSpecs(cwd, { status });
}

/**
 * Create a new spec file
 */
export function createSpec(cwd: string, data: CreateSpecData): Spec {
  ensureSpecsDir(cwd);

  const now = new Date().toISOString();
  const id = specFilename(data.title).replace('.md', '');

  const frontmatter: SpecFrontmatter = {
    id,
    title: data.title,
    status: data.status ?? 'todo',
    priority: data.priority,
    created: now,
    updated: now,
  };

  const content = `${serializeFrontmatter(frontmatter)}\n\n${data.content}`;
  const filename = specFilename(data.title);
  const filepath = path.join(specsDir(cwd), filename);

  // Check if file already exists
  if (fs.existsSync(filepath)) {
    throw new Error(`Spec file already exists: ${filepath}`);
  }

  fs.writeFileSync(filepath, content, 'utf8');

  return {
    ...frontmatter,
    content: data.content,
    filepath,
  };
}

/**
 * Update a spec's status
 */
export function updateSpecStatus(cwd: string, id: string, status: SpecStatus): Spec | null {
  const spec = getSpec(cwd, id);
  if (!spec) {
    return null;
  }

  const now = new Date().toISOString();
  const frontmatter: SpecFrontmatter = {
    id: spec.id,
    title: spec.title,
    status,
    priority: spec.priority,
    created: spec.created,
    updated: now,
  };

  const content = `${serializeFrontmatter(frontmatter)}\n\n${spec.content}`;
  fs.writeFileSync(spec.filepath, content, 'utf8');

  return {
    ...spec,
    status,
    updated: now,
  };
}

/**
 * Update a spec's content (body)
 */
export function updateSpecContent(cwd: string, id: string, newContent: string): Spec | null {
  const spec = getSpec(cwd, id);
  if (!spec) {
    return null;
  }

  const now = new Date().toISOString();
  const frontmatter: SpecFrontmatter = {
    id: spec.id,
    title: spec.title,
    status: spec.status,
    priority: spec.priority,
    created: spec.created,
    updated: now,
  };

  const content = `${serializeFrontmatter(frontmatter)}\n\n${newContent}`;
  fs.writeFileSync(spec.filepath, content, 'utf8');

  return {
    ...spec,
    content: newContent,
    updated: now,
  };
}

/**
 * Count tasks in a spec (looks for checkbox patterns)
 */
export function countSpecTasks(content: string): { total: number; completed: number } {
  const uncheckedPattern = /- \[ \]/g;
  const checkedPattern = /- \[x\]/gi;

  const unchecked = content.match(uncheckedPattern)?.length ?? 0;
  const checked = content.match(checkedPattern)?.length ?? 0;

  return {
    total: unchecked + checked,
    completed: checked,
  };
}

/**
 * Get spec statistics
 */
export function getSpecStats(cwd: string): {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
} {
  const specs = listSpecs(cwd);
  return {
    total: specs.length,
    todo: specs.filter((s) => s.status === 'todo').length,
    inProgress: specs.filter((s) => s.status === 'in-progress').length,
    done: specs.filter((s) => s.status === 'done').length,
  };
}

// =============================================================================
// Task Classification for Spec Ranking
// =============================================================================

/**
 * Keywords indicating high-risk/architectural work that should be done first ("fail fast")
 */
export const HIGH_RISK_KEYWORDS = [
  'architecture',
  'schema',
  'design',
  'integration',
  'api',
  'contract',
  'spike',
  'unknown',
  'core',
  'abstraction',
  'foundation',
  'refactor',
] as const;

/**
 * Keywords indicating low-risk/polish work that can be saved for later
 */
export const LOW_RISK_KEYWORDS = [
  'polish',
  'fix',
  'cleanup',
  'style',
  'typo',
  'docs',
  'ui',
  'button',
  'tweak',
] as const;

/**
 * Classification result for a task
 */
export type TaskRiskLevel = 'high' | 'low' | 'normal';

/**
 * Classify a task based on keyword matching
 *
 * @param taskText - The text of the task to classify
 * @returns 'high' if high-risk keywords found, 'low' if low-risk keywords found, 'normal' otherwise
 *
 * If both high and low risk keywords are found, high-risk takes precedence
 * to ensure we "fail fast" on risky work.
 */
export function classifyTask(taskText: string): TaskRiskLevel {
  const lowerText = taskText.toLowerCase();

  // Check for high-risk keywords first (they take precedence)
  for (const keyword of HIGH_RISK_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return 'high';
    }
  }

  // Check for low-risk keywords
  for (const keyword of LOW_RISK_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return 'low';
    }
  }

  return 'normal';
}

/**
 * Extract uncompleted tasks from spec content
 *
 * @param content - The markdown content of a spec
 * @returns Array of task text strings for uncompleted tasks
 */
export function getUncompletedTasks(content: string): string[] {
  // Match lines that start with "- [ ]" (uncompleted checkbox)
  const taskPattern = /^- \[ \] (.+)$/gm;
  const tasks: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = taskPattern.exec(content)) !== null) {
    tasks.push(match[1]);
  }

  return tasks;
}

/**
 * Calculate the risk ratio for a spec based on its uncompleted tasks
 *
 * The risk ratio is the proportion of uncompleted tasks that are classified
 * as high-risk (architectural, integration, unknown, etc.). This is used to
 * prioritize specs that have more risky work remaining ("fail fast").
 *
 * @param spec - The spec to analyze
 * @returns A number between 0 and 1 representing the ratio of high-risk tasks
 *          Returns 0 if there are no uncompleted tasks
 */
export function getSpecRiskRatio(spec: Spec): number {
  const uncompletedTasks = getUncompletedTasks(spec.content);

  if (uncompletedTasks.length === 0) {
    return 0;
  }

  const highRiskCount = uncompletedTasks.filter((task) => classifyTask(task) === 'high').length;

  return highRiskCount / uncompletedTasks.length;
}

/**
 * Calculate the completion progress for a spec
 *
 * @param spec - The spec to analyze
 * @returns A number between 0 and 100 representing the percentage of completed tasks
 *          Returns 100 if there are no tasks (spec is considered complete)
 */
export function getSpecProgress(spec: Spec): number {
  const { total, completed } = countSpecTasks(spec.content);

  if (total === 0) {
    return 100;
  }

  return Math.round((completed / total) * 100);
}

/**
 * Get the next spec to work on based on ranking algorithm
 *
 * Ranking priority (in order):
 * 1. In-progress specs first (status === 'in-progress')
 * 2. Higher risk ratio (more high-risk uncompleted tasks)
 * 3. Higher priority metadata (high > medium > low)
 * 4. Higher progress percentage (closer to completion)
 * 5. Older created date (first-come-first-served)
 *
 * Only considers specs with status 'todo' or 'in-progress'.
 * Returns null if no actionable specs are found.
 *
 * @param cwd - The current working directory
 * @returns The highest-ranked spec, or null if none available
 */
export function getNextSpec(cwd: string): Spec | null {
  const allSpecs = listSpecs(cwd);

  // Filter to only actionable specs (todo or in-progress)
  const actionableSpecs = allSpecs.filter(
    (spec) => spec.status === 'todo' || spec.status === 'in-progress'
  );

  if (actionableSpecs.length === 0) {
    return null;
  }

  // Priority value mapping (lower is better for sorting)
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

  // Sort specs by ranking criteria
  const rankedSpecs = actionableSpecs.toSorted((a, b) => {
    // 1. In-progress specs first
    const aInProgress = a.status === 'in-progress' ? 0 : 1;
    const bInProgress = b.status === 'in-progress' ? 0 : 1;
    if (aInProgress !== bInProgress) {
      return aInProgress - bInProgress;
    }

    // 2. Higher risk ratio first (descending)
    const aRiskRatio = getSpecRiskRatio(a);
    const bRiskRatio = getSpecRiskRatio(b);
    if (aRiskRatio !== bRiskRatio) {
      return bRiskRatio - aRiskRatio; // Higher risk first
    }

    // 3. Higher priority metadata (high > medium > low)
    const aPriority = a.priority ? priorityOrder[a.priority] : 999;
    const bPriority = b.priority ? priorityOrder[b.priority] : 999;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // 4. Higher progress percentage first (descending - closer to completion)
    const aProgress = getSpecProgress(a);
    const bProgress = getSpecProgress(b);
    if (aProgress !== bProgress) {
      return bProgress - aProgress; // Higher progress first
    }

    // 5. Older created date first (ascending)
    return new Date(a.created).getTime() - new Date(b.created).getTime();
  });

  return rankedSpecs[0];
}
