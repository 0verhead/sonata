import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
  type Event as OcEvent,
} from "@opencode-ai/sdk";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { OpenCodeResult } from "../types/index.js";

// Unique signal for PRD completion. Use a specific marker that's unlikely to be echoed in instructions.
// The regex match looks for this on its own line to avoid false positives when AI quotes the instruction.
const COMPLETE_SIGNAL = "PRD_COMPLETE_SIGNAL_7x9k2m";
const COMPLETE_SIGNAL_REGEX = /^\s*PRD_COMPLETE_SIGNAL_7x9k2m\s*$/m;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max session time
const HEALTH_CHECK_TIMEOUT_MS = 30_000; // 30 seconds to wait for server

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
 * OpenCode instance with client and server
 */
interface OpenCodeInstance {
  client: OpencodeClient;
  server: { close(): void; url: string };
  baseUrl: string;
}

// Track active instance for cleanup on process exit
let activeInstance: OpenCodeInstance | null = null;

// Cleanup on process exit
function setupCleanupHandlers(): void {
  const cleanup = () => {
    if (activeInstance) {
      console.log("\n[opencode] Cleaning up...");
      activeInstance.server.close();
      activeInstance = null;
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}

// Setup handlers once
setupCleanupHandlers();

/**
 * Wait for the OpenCode server to be ready
 * Uses a simple fetch to the root endpoint
 */
async function waitForReady(baseUrl: string, timeoutMs: number): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 200;

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Try to reach the server - any response means it's up
      const response = await fetch(baseUrl, {
        method: "GET",
        signal: AbortSignal.timeout(1000),
      });
      // Any response (even error) means server is running
      if (response) {
        return;
      }
    } catch (err) {
      // Connection refused or timeout - server not ready yet
      const error = err as Error;
      if (!error.message?.includes("ECONNREFUSED") && !error.name?.includes("AbortError")) {
        // Unexpected error, but let's keep trying
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Server failed to become ready within ${timeoutMs}ms`);
}

/**
 * Create an OpenCode instance programmatically
 * Retries with different ports if needed (like btca)
 */
async function createOpencodeInstance(cwd: string): Promise<OpenCodeInstance> {
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = Math.floor(Math.random() * 3000) + 3000;

    try {
      const created = await createOpencode({ port });

      if (created) {
        const baseUrl = `http://localhost:${port}`;

        // Wait for server to be ready
        await waitForReady(baseUrl, HEALTH_CHECK_TIMEOUT_MS);

        const instance: OpenCodeInstance = {
          client: createOpencodeClient({ baseUrl, directory: cwd }),
          server: created.server,
          baseUrl,
        };

        activeInstance = instance;
        return instance;
      }
    } catch (err: unknown) {
      // Check if it's a port conflict error
      const error = err as { cause?: Error };
      if (error?.cause instanceof Error && error.cause.stack?.includes("port")) {
        continue; // Try another port
      }
      throw new Error(`Failed to create OpenCode instance: ${String(err)}`);
    }
  }

  throw new Error("Failed to create OpenCode instance - all port attempts exhausted");
}

/**
 * Subscribe to session events and filter by session ID
 * With timeout support
 */
async function* sessionEvents(
  sessionID: string,
  client: OpencodeClient,
  abortSignal: AbortSignal
): AsyncGenerator<OcEvent> {
  const events = await client.event.subscribe();

  try {
    for await (const event of events.stream) {
      if (abortSignal.aborted) {
        return;
      }

      const props = event.properties as Record<string, unknown>;

      // Filter events to only this session
      if (props && "sessionID" in props && props.sessionID !== sessionID) {
        continue;
      }

      yield event;

      // Stop when session goes idle
      if (event.type === "session.idle" && props?.sessionID === sessionID) {
        return;
      }
    }
  } finally {
    // Cleanup
  }
}

/**
 * Run OpenCode with a prompt using the SDK
 * This is the btca-style implementation
 */
export async function runOpenCode(
  prompt: string,
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<OpenCodeResult> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? SESSION_TIMEOUT_MS;
  let output = "";
  let instance: OpenCodeInstance | null = null;

  // Create abort controller for timeout
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log("\n[opencode] Session timeout reached");
    abortController.abort();
  }, timeoutMs);

  try {
    // Create OpenCode instance
    console.log("[opencode] Starting server...");
    instance = await createOpencodeInstance(cwd);
    const { client, server, baseUrl } = instance;

    console.log(`[opencode] Server ready at ${baseUrl}`);

    // Create a session
    const session = await client.session.create();
    if (session.error || !session.data?.id) {
      throw new Error(`Failed to create session: ${JSON.stringify(session.error)}`);
    }

    const sessionID = session.data.id;
    console.log(`[opencode] Session created: ${sessionID.slice(0, 8)}...`);

    // Subscribe to events
    const eventStream = sessionEvents(sessionID, client, abortController.signal);

    // Send the prompt (fire and forget - events come via subscription)
    console.log("[opencode] Sending prompt...\n");
    void client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [{ type: "text", text: prompt }],
      },
    }).catch((err) => {
      console.error(`[opencode] Prompt error: ${err}`);
    });

    // Track text parts for accumulation
    const partText = new Map<string, string>();
    const toolStates = new Map<string, string>();

    // Process events
    for await (const event of eventStream) {
      if (abortController.signal.aborted) {
        break;
      }

      if (event.type === "message.part.updated") {
        const props = event.properties as {
          message?: { role?: string };
          part?: {
            id?: string;
            type?: string;
            text?: string;
            tool?: string;
            callID?: string;
            state?: { status?: string; output?: string; title?: string };
          };
        };

        // Skip user messages
        if (props?.message?.role === "user") continue;

        const part = props?.part;
        if (!part) continue;

        if (part.type === "text" && part.id && part.text !== undefined) {
          // Get delta from accumulated text
          const prevText = partText.get(part.id) ?? "";
          const newText = part.text;

          if (newText.length > prevText.length) {
            const delta = newText.slice(prevText.length);
            process.stdout.write(delta);
            output += delta;
          }

          partText.set(part.id, newText);
        } else if (part.type === "tool" && part.callID && part.tool) {
          const callID = part.callID;
          const tool = part.tool;
          const state = part.state;
          const prevStatus = toolStates.get(callID);

          if (state?.status === "running" && prevStatus !== "running") {
            const title = state.title ? `: ${state.title}` : "";
            process.stdout.write(`\n[${tool}${title}...]\n`);
            toolStates.set(callID, "running");
          } else if (state?.status === "completed" && prevStatus !== "completed") {
            const outputText = state.output ?? "";
            const truncated = outputText.length > 200
              ? outputText.slice(0, 200) + "..."
              : outputText;
            if (truncated) {
              process.stdout.write(`[${tool}] ${truncated}\n`);
            }
            toolStates.set(callID, "completed");
          }
        }
      } else if (event.type === "session.error") {
        const props = event.properties as { error?: { name?: string; message?: string } };
        const errorMsg = props?.error?.message ?? props?.error?.name ?? "Unknown error";
        console.error(`\n[ERROR] ${errorMsg}`);
        output += `\n[ERROR] ${errorMsg}`;
      }
    }

    // Clean up
    clearTimeout(timeoutId);
    server.close();
    activeInstance = null;
    console.log(`\n[opencode] Session complete`);

    // Extract task title from output
    const taskTitle = extractTaskTitle(output);

    return {
      success: true,
      output,
      isComplete: COMPLETE_SIGNAL_REGEX.test(output),
      taskTitle,
    };
  } catch (err) {
    clearTimeout(timeoutId);

    // Clean up on error
    if (instance) {
      instance.server.close();
      activeInstance = null;
    }

    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`\n[opencode] Error: ${errorMsg}`);

    return {
      success: false,
      output,
      isComplete: false,
      error: errorMsg,
    };
  }
}

/**
 * Check if opencode SDK is available
 */
export async function checkOpenCodeInstalled(): Promise<boolean> {
  try {
    // Try to create and immediately close an instance
    const instance = await createOpencodeInstance(process.cwd());
    instance.server.close();
    activeInstance = null;
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop server - properly closes the active instance
 */
export function stopServer(): void {
  if (activeInstance) {
    activeInstance.server.close();
    activeInstance = null;
  }
}

/**
 * Kill active process
 */
export function killActiveProcess(): void {
  stopServer();
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


