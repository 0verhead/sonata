import * as fs from "node:fs";
import * as path from "node:path";
import {
  SpecFrontmatterSchema,
  type Spec,
  type SpecFrontmatter,
  type SpecStatus,
  type CreateSpecData,
  type ListSpecsOptions,
} from "../types/specs.js";

const DEFAULT_SPECS_DIR = "specs";

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
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 60) + ".md"
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
  const lines = yamlContent.split("\n");

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let value: string | undefined = line.substring(colonIndex + 1).trim();

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
    "---",
    `id: ${frontmatter.id}`,
    `title: ${frontmatter.title}`,
    `status: ${frontmatter.status}`,
  ];

  if (frontmatter.priority) {
    lines.push(`priority: ${frontmatter.priority}`);
  }

  lines.push(`created: ${frontmatter.created}`);
  lines.push(`updated: ${frontmatter.updated}`);
  lines.push("---");

  return lines.join("\n");
}

/**
 * Parse a spec file
 */
function parseSpecFile(filepath: string): Spec | null {
  try {
    const content = fs.readFileSync(filepath, "utf-8");
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

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
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
  const id = specFilename(data.title).replace(".md", "");

  const frontmatter: SpecFrontmatter = {
    id,
    title: data.title,
    status: data.status ?? "todo",
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

  fs.writeFileSync(filepath, content, "utf-8");

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
  fs.writeFileSync(spec.filepath, content, "utf-8");

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
  fs.writeFileSync(spec.filepath, content, "utf-8");

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
    todo: specs.filter((s) => s.status === "todo").length,
    inProgress: specs.filter((s) => s.status === "in-progress").length,
    done: specs.filter((s) => s.status === "done").length,
  };
}
