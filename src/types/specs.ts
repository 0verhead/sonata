import { z } from "zod";

/**
 * Spec frontmatter schema
 * Parsed from YAML at the top of spec files
 */
export const SpecFrontmatterSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["todo", "in-progress", "done"]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  created: z.string(),
  updated: z.string(),
});

export type SpecFrontmatter = z.infer<typeof SpecFrontmatterSchema>;

/**
 * Full spec schema (frontmatter + content)
 */
export const SpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["todo", "in-progress", "done"]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  created: z.string(),
  updated: z.string(),
  content: z.string(), // The markdown body (PRD)
  filepath: z.string(), // Full path to the file
});

export type Spec = z.infer<typeof SpecSchema>;

/**
 * Spec status type
 */
export type SpecStatus = "todo" | "in-progress" | "done";

/**
 * Spec priority type
 */
export type SpecPriority = "high" | "medium" | "low";

/**
 * Data for creating a new spec
 */
export interface CreateSpecData {
  title: string;
  content: string;
  status?: SpecStatus;
  priority?: SpecPriority;
}

/**
 * Options for listing specs
 */
export interface ListSpecsOptions {
  status?: SpecStatus;
  priority?: SpecPriority;
}
