import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
  type Event as OcEvent,
} from "@opencode-ai/sdk";
import type { OpenCodeResult } from "../types/index.js";

const COMPLETE_SIGNAL = "<promise>COMPLETE</promise>";
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
      isComplete: output.includes(COMPLETE_SIGNAL),
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
 * Task source configuration
 */
export interface TaskSource {
  type: "file" | "notion";
  taskFile?: string;
  notionBoardId?: string;
  notionStatusColumn?: {
    todo: string;
    inProgress: string;
    done: string;
  };
}

/**
 * Build the prompt for opencode
 */
export function buildPrompt(options: {
  taskSource: TaskSource;
  progressFile?: string;
  customInstructions?: string;
}): string {
  const { taskSource, progressFile, customInstructions } = options;
  const parts: string[] = [];

  if (progressFile) {
    parts.push(`@${progressFile}`);
  }

  if (taskSource.type === "notion" && taskSource.notionBoardId) {
    const statusCol = taskSource.notionStatusColumn;
    parts.push(`
TASK SOURCE: Notion Board
Use the Notion MCP tools to:
1. Fetch tasks from the Notion database with ID: ${taskSource.notionBoardId}
2. Look for tasks in the "${statusCol?.todo ?? "To Do"}" column
3. When you start a task, update its status to "${statusCol?.inProgress ?? "In Progress"}"
4. When you complete a task, update its status to "${statusCol?.done ?? "Done"}"
`);
  } else if (taskSource.taskFile) {
    parts.push(`@${taskSource.taskFile}`);
  }

  parts.push(`
INSTRUCTIONS:
1. Decide which task to work on next.
2. Check any feedback loops, such as types and tests.
3. Append your progress to the progress.txt file.
4. Make a git commit of that feature.

ONLY WORK ON A SINGLE FEATURE.

If all work is complete, output ${COMPLETE_SIGNAL}.
`);

  if (customInstructions) {
    parts.push(customInstructions);
  }

  return parts.join("\n");
}
