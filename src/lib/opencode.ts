import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { OpenCodeResult } from "../types/index.js";

// Unique signal for PRD completion. Use a specific marker that's unlikely to be echoed in instructions.
// The regex match looks for this on its own line to avoid false positives when AI quotes the instruction.
const COMPLETE_SIGNAL = "PRD_COMPLETE_SIGNAL_7x9k2m";
const COMPLETE_SIGNAL_REGEX = /^\s*PRD_COMPLETE_SIGNAL_7x9k2m\s*$/m;

/**
 * Extract task title from opencode output
 * Looks for patterns like:
 * - Task: "Title here"
 * - **Task:** Title here
 * - Working on: Title here
 */
function extractTaskTitle(output: string): string | undefined {
  // Try various patterns that opencode might use
  const patterns = [
    /- Task: [""]([^""]+)[""]/i,
    /- Task: (.+?)(?:\n|$)/i,
    /\*\*Task:\*\* (.+?)(?:\n|$)/i,
    /Working on[: ]+[""]?([^""\n]+)[""]?/i,
    /Task[: ]+[""]([^""]+)[""]/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

/**
 * Run OpenCode CLI with a prompt
 * 
 * Uses `opencode run` command which provides:
 * - Pretty formatted output (like Claude Code)
 * - Syntax highlighting
 * - Native tool formatting
 * 
 * Each invocation is a fresh session - context persistence
 * happens through files (progress.txt, PRD) not session memory.
 */
export async function runOpenCodeCli(
  prompt: string,
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<OpenCodeResult> {
  const cwd = options.cwd ?? process.cwd();
  
  return new Promise((resolve) => {
    const proc = spawn("opencode", ["run", prompt], {
      cwd,
      stdio: ["inherit", "pipe", "inherit"],
    });
    
    let output = "";
    
    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(chunk);
      output += text;
    });
    
    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        output,
        isComplete: COMPLETE_SIGNAL_REGEX.test(output),
        taskTitle: extractTaskTitle(output),
      });
    });
    
    proc.on("error", (err) => {
      resolve({
        success: false,
        output,
        isComplete: false,
        error: err.message,
      });
    });
  });
}

// Alias for backwards compatibility
export const runOpenCode = runOpenCodeCli;

/**
 * Check if opencode CLI is available
 */
export async function checkOpenCodeInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("opencode", ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    
    proc.on("close", (code) => {
      resolve(code === 0);
    });
    
    proc.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Stop server - no-op since we no longer manage servers
 */
export function stopServer(): void {
  // No-op - we use CLI subprocess, not SDK server
}

/**
 * Kill active process - no-op since we no longer track instances
 */
export function killActiveProcess(): void {
  // No-op - each CLI invocation is independent
}

/**
 * Build the planning prompt for collaborative PRD creation
 */
export function buildPlanningPrompt(options: {
  ticketId: string;
  ticketTitle: string;
  ticketUrl: string;
}): string {
  const { ticketId, ticketTitle, ticketUrl } = options;

  return `
You are helping create a PRD (Product Requirements Document) for a Notion ticket.

## Ticket Info
- **ID:** ${ticketId}
- **Title:** ${ticketTitle}
- **URL:** ${ticketUrl}

## Your Task

1. **FETCH** the ticket content using notion-fetch with page ID: ${ticketId}

2. **EXPLORE** the codebase to understand what changes are needed

3. **ASK** clarifying questions - don't assume, verify with the developer

4. **PROPOSE** a detailed PRD with:
   - Summary (1-2 sentences)
   - Implementation steps (checkboxes, small and atomic)
   - Files likely to be modified
   - Acceptance criteria
   - Definition of done

5. **REFINE** based on developer feedback

6. **SAVE TO NOTION** when the developer approves:
   - Use notion-create-pages
   - Parent: { "page_id": "${ticketId}" }
   - Title: "PRD"
   - Content: the finalized PRD in markdown

## PRD Format

Use this structure:
\`\`\`markdown
## Summary
Brief description of what this PRD accomplishes.

## Steps
- [ ] Step 1: Description
- [ ] Step 2: Description
- [ ] Step 3: Description

## Files
- path/to/file1.ts
- path/to/file2.ts

## Acceptance Criteria
- Criterion 1
- Criterion 2

## Definition of Done
When X, Y, and Z are complete and tests pass.
\`\`\`

## IMPORTANT REMINDERS

- This is an **interactive session** - ask questions, don't assume
- When the developer says something like "approve", "looks good, save it", "lgtm", or "create the PRD":
  → Immediately use notion-create-pages to save the PRD to Notion
- After saving, confirm with this EXACT message: "PRD saved to Notion! You can now exit and run \`notion-code run\` to start implementation."
  (NOTE: The command is \`notion-code run\`, NOT \`opencode run\`)
- If you're unsure whether to save, ask: "Would you like me to save this PRD to Notion now?"
`.trim();
}

/**
 * Build the implementation prompt for PRD-based execution
 */
export function buildImplementationPrompt(options: {
  ticketTitle: string;
  ticketUrl: string;
  prdContent: string;
  prdPageId?: string;
  progressFile?: string;
}): string {
  const { ticketTitle, ticketUrl, prdContent, prdPageId, progressFile = "progress.txt" } = options;

  // Add PRD update instruction if we have the page ID
  const prdUpdateInstruction = prdPageId
    ? `
6. UPDATE the PRD in Notion to mark the step as done:
   - Use notion-update-page with page ID: ${prdPageId}
   - Change the checkbox from \`- [ ]\` to \`- [x]\` for the completed step
   - Use the replace_content_range command to update just that line`
    : "";

  return `
@${progressFile}

PRD for: ${ticketTitle}
Source: ${ticketUrl}

---
${prdContent}
---

INSTRUCTIONS:
You are implementing this PRD step by step.

1. READ the PRD and ${progressFile} to understand:
   - What steps exist
   - What has already been completed
   - What remains

2. CHOOSE the next step based on:
   - Dependencies (prerequisites first)
   - Risk (tackle unknowns early)
   - Architectural importance

3. IMPLEMENT only ONE step:
   - Make focused, small changes
   - Run feedback loops: types, tests, lint
   - Fix any issues before continuing

4. UPDATE ${progressFile} with:
   - Which step you completed
   - Key decisions made
   - Files changed
   - Any blockers or notes for next iteration

5. COMMIT the changes with a descriptive message
${prdUpdateInstruction}

If ALL steps in the PRD are complete and feedback loops pass:
  Output EXACTLY this signal on its own line: ${COMPLETE_SIGNAL}

IMPORTANT: Only work on ONE step per session.
`.trim();
}

/**
 * Result from spawning OpenCode TUI
 */
export interface SpawnTuiResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Spawn OpenCode TUI with a prompt
 * 
 * This launches the full OpenCode terminal UI with syntax highlighting,
 * markdown rendering, and all interactive features.
 * 
 * The prompt is written to a temp file to avoid shell argument length limits.
 * 
 * @param prompt - The initial prompt to send to OpenCode
 * @param options - Configuration options
 * @returns Exit code and signal from the spawned process
 */
export function spawnOpenCodeTui(
  prompt: string,
  options: { cwd?: string; sessionId?: string } = {}
): SpawnTuiResult {
  const cwd = options.cwd ?? process.cwd();
  
  // Write prompt to temp file to avoid shell argument length limits
  const promptDir = path.join(cwd, ".notion-code");
  if (!fs.existsSync(promptDir)) {
    fs.mkdirSync(promptDir, { recursive: true });
  }
  const promptFile = path.join(promptDir, "plan-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf-8");
  
  try {
    // Read prompt from file using shell redirection
    const args: string[] = [];
    
    // Continue existing session if provided
    if (options.sessionId) {
      args.push("--session", options.sessionId);
    }
    
    // Use --prompt with the content (opencode handles long prompts)
    args.push("--prompt", prompt);
    
    const result = spawnSync("opencode", args, {
      cwd,
      stdio: "inherit", // Full TUI passthrough
    });
    
    return {
      exitCode: result.status,
      signal: result.signal,
    };
  } finally {
    // Clean up temp file
    if (fs.existsSync(promptFile)) {
      fs.unlinkSync(promptFile);
    }
  }
}

/**
 * Build the planning prompt for local spec creation
 */
export function buildLocalPlanningPrompt(options: {
  title: string;
  specsDir: string;
  cwd: string;
}): string {
  const { title, specsDir } = options;

  return `
You are helping create a spec (PRD) for a local project task.

## Task Info
- **Title:** ${title}
- **Specs Directory:** ${specsDir}/

## Your Task

1. **EXPLORE** the codebase to understand what changes are needed

2. **ASK** clarifying questions - don't assume, verify with the developer

3. **PROPOSE** a detailed spec/PRD with:
   - Summary (1-2 sentences)
   - Implementation steps (checkboxes, small and atomic)
   - Files likely to be modified
   - Acceptance criteria
   - Definition of done

4. **REFINE** based on developer feedback

5. **SAVE THE SPEC** when the developer approves:
   - Create a markdown file in the ${specsDir}/ folder
   - Use this EXACT format with YAML frontmatter:

\`\`\`markdown
---
id: <slug-from-title>
title: ${title}
status: todo
priority: high
created: <ISO timestamp>
updated: <ISO timestamp>
---

## Summary
Brief description of what this spec accomplishes.

## Steps
- [ ] Step 1: Description
- [ ] Step 2: Description
- [ ] Step 3: Description

## Files
- path/to/file1.ts
- path/to/file2.ts

## Acceptance Criteria
- Criterion 1
- Criterion 2

## Definition of Done
When X, Y, and Z are complete and tests pass.
\`\`\`

## IMPORTANT REMINDERS

- This is an **interactive session** - ask questions, don't assume
- When the developer says something like "approve", "looks good, save it", "lgtm", or "create the spec":
  → Immediately write the spec file to ${specsDir}/<slug>.md
- After saving, confirm with this EXACT message: "Spec saved to ${specsDir}/! You can now exit and run \`notion-code run --local\` to start implementation."
  (NOTE: The command is \`notion-code run --local\`, NOT \`opencode run\`)
- If you're unsure whether to save, ask: "Would you like me to save this spec now?"
`.trim();
}

/**
 * Build the implementation prompt for local spec-based execution
 */
export function buildLocalImplementationPrompt(options: {
  specTitle: string;
  specContent: string;
  specFilepath: string;
  progressFile?: string;
}): string {
  const { specTitle, specContent, specFilepath, progressFile = "progress.txt" } = options;

  return `
@${progressFile}

Spec for: ${specTitle}
Source: ${specFilepath}

---
${specContent}
---

INSTRUCTIONS:
You are implementing this spec step by step.

1. READ the spec and ${progressFile} to understand:
   - What steps exist
   - What has already been completed
   - What remains

2. CHOOSE the next step based on:
   - Dependencies (prerequisites first)
   - Risk (tackle unknowns early)
   - Architectural importance

3. IMPLEMENT only ONE step:
   - Make focused, small changes
   - Run feedback loops: types, tests, lint
   - Fix any issues before continuing

4. UPDATE ${progressFile} with:
   - Which step you completed
   - Key decisions made
   - Files changed
   - Any blockers or notes for next iteration

5. COMMIT the changes with a descriptive message

6. UPDATE the spec file to mark the step as done:
   - Change the checkbox from \`- [ ]\` to \`- [x]\` for the completed step
   - Update the frontmatter: set status to "in-progress" if not already
   - Update the "updated" timestamp in the frontmatter

If ALL steps in the spec are complete and feedback loops pass:
  - Update the spec status to "done" in the frontmatter
  - Output EXACTLY this signal on its own line: ${COMPLETE_SIGNAL}

IMPORTANT: Only work on ONE step per session.
`.trim();
}
