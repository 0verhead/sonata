import { z } from 'zod'

/**
 * Task from Notion kanban board
 */
export const NotionTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.string(),
  priority: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  url: z.string().optional(),
})

export type NotionTask = z.infer<typeof NotionTaskSchema>

/**
 * User configuration stored in ~/.sonata/config.json
 */
export const ConfigSchema = z.object({
  mode: z.enum(['local', 'notion']).optional(),
  notion: z.object({
    boardId: z.string().optional(),
    viewId: z.string().optional(), // View ID from ?v= parameter in Notion URL
    boardName: z.string().optional(),
    statusColumn: z.object({
      todo: z.string(),
      inProgress: z.string(),
      done: z.string(),
    }),
  }),
  local: z
    .object({
      specsDir: z.string(),
    })
    .optional(),
  git: z.object({
    createBranch: z.boolean(),
    createPR: z.boolean(),
    baseBranch: z.string(),
  }),
  loop: z.object({
    maxIterations: z.number().int().positive(),
  }),
})

export type Config = z.infer<typeof ConfigSchema>

/**
 * Progress entry for tracking work across iterations
 */
export const ProgressEntrySchema = z.object({
  timestamp: z.string(),
  iteration: z.number(),
  taskId: z.string(),
  taskTitle: z.string(),
  action: z.string(),
  notes: z.string().optional(),
})

export type ProgressEntry = z.infer<typeof ProgressEntrySchema>

/**
 * Result of running opencode
 */
export const OpenCodeResultSchema = z.object({
  success: z.boolean(),
  output: z.string(),
  isComplete: z.boolean(),
  error: z.string().optional(),
  taskTitle: z.string().optional(),
})

export type OpenCodeResult = z.infer<typeof OpenCodeResultSchema>

/**
 * Options for the loop command
 */
export const LoopOptionsSchema = z.object({
  iterations: z.number().int().positive(),
  hitl: z.boolean(),
})

export type LoopOptions = z.infer<typeof LoopOptionsSchema>

/**
 * Helper to check if a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Helper to check if a value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/**
 * Helper to check if clack was cancelled (returns symbol)
 */
export function isCancelled(value: unknown): boolean {
  return typeof value === 'symbol'
}
