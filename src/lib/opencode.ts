import { execa, type ResultPromise, type ExecaError } from "execa";
import type { OpenCodeResult } from "../types/index.js";

const COMPLETE_SIGNAL = "<promise>COMPLETE</promise>";

// Track active subprocess for cleanup
let activeSubprocess: ResultPromise | null = null;

/**
 * Kill the active opencode subprocess if running
 */
export function killActiveProcess(): void {
  if (activeSubprocess) {
    try {
      activeSubprocess.kill("SIGTERM");
      // Give it a moment, then force kill if needed
      setTimeout(() => {
        if (activeSubprocess && !activeSubprocess.killed) {
          activeSubprocess.kill("SIGKILL");
        }
      }, 2000);
    } catch {
      // Process may already be dead
    }
    activeSubprocess = null;
  }
}

/**
 * Setup signal handlers to cleanup subprocess on exit
 */
function setupCleanupHandlers(): void {
  const cleanup = () => {
    killActiveProcess();
  };

  // Remove existing listeners to avoid duplicates
  process.removeListener("SIGINT", cleanup);
  process.removeListener("SIGTERM", cleanup);
  process.removeListener("exit", cleanup);

  // Add cleanup handlers
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130); // Standard exit code for SIGINT
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143); // Standard exit code for SIGTERM
  });
  process.once("exit", cleanup);
}

// Setup handlers on module load
setupCleanupHandlers();

/**
 * Execute opencode with a prompt and capture the result
 * This is the core of the Ralph loop - it spawns opencode as a subprocess
 *
 * IMPORTANT: Properly manages the subprocess lifecycle to prevent port exhaustion
 */
export async function runOpenCode(
  prompt: string,
  options: {
    cwd?: string;
    stream?: boolean;
    timeout?: number; // Timeout in milliseconds
  } = {}
): Promise<OpenCodeResult> {
  const {
    cwd = process.cwd(),
    stream = true,
    timeout = 30 * 60 * 1000, // 30 minutes default
  } = options;

  // Kill any existing process before starting a new one
  killActiveProcess();

  try {
    let output = "";

    // Create subprocess with proper cleanup options
    const subprocess = execa("opencode", ["-p", prompt], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      // Cleanup options
      cleanup: true, // Kill subprocess when parent exits
      detached: false, // Don't detach - we want to control it
      timeout, // Timeout to prevent hanging
      // Ensure child processes are killed too
      killSignal: "SIGTERM",
      forceKillAfterDelay: 5000, // Force SIGKILL after 5s if SIGTERM doesn't work
    });

    // Track the active subprocess
    activeSubprocess = subprocess;

    if (stream) {
      // Stream output to console while capturing it
      subprocess.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        process.stdout.write(chunk);
      });

      subprocess.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        process.stderr.write(chunk);
      });
    }

    // Wait for subprocess to complete
    const result = await subprocess;

    // Clear active subprocess reference
    activeSubprocess = null;

    // Get output
    if (!stream) {
      output =
        (typeof result.stdout === "string" ? result.stdout : "") +
        (typeof result.stderr === "string" ? result.stderr : "");
    }

    const isComplete = output.includes(COMPLETE_SIGNAL);

    return {
      success: true,
      output,
      isComplete,
    };
  } catch (error) {
    // Clear active subprocess reference on error too
    activeSubprocess = null;

    const execaError = error as ExecaError;

    // Check if it was a timeout
    if ("timedOut" in execaError && execaError.timedOut) {
      return {
        success: false,
        output: "",
        isComplete: false,
        error: `opencode timed out after ${timeout / 1000} seconds`,
      };
    }

    // Check if it was killed by signal (user interrupt)
    if ("isTerminated" in execaError && execaError.isTerminated) {
      return {
        success: false,
        output: "",
        isComplete: false,
        error: "opencode was terminated",
      };
    }

    const errorOutput =
      typeof execaError.stdout === "string" ? execaError.stdout : "";

    return {
      success: false,
      output: errorOutput,
      isComplete: false,
      error: execaError.message,
    };
  }
}

/**
 * Check if opencode is installed and accessible
 */
export async function checkOpenCodeInstalled(): Promise<boolean> {
  try {
    await execa("opencode", ["--version"], {
      timeout: 5000, // 5 second timeout for version check
      cleanup: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Task source configuration
 */
export interface TaskSource {
  type: "file" | "notion";
  // For file source
  taskFile?: string;
  // For Notion source
  notionBoardId?: string;
  notionStatusColumn?: {
    todo: string;
    inProgress: string;
    done: string;
  };
}

/**
 * Build the Ralph-style prompt for opencode
 * This combines the task info, progress context, and loop instructions
 */
export function buildPrompt(options: {
  taskSource: TaskSource;
  progressFile?: string;
  customInstructions?: string;
}): string {
  const { taskSource, progressFile, customInstructions } = options;

  const parts: string[] = [];

  // Include progress file reference
  if (progressFile) {
    parts.push(`@${progressFile}`);
  }

  // Task source instructions
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

  // Core Ralph loop instructions
  parts.push(`
INSTRUCTIONS:
1. Decide which task to work on next.
   This should be the one YOU decide has the highest priority,
   - not necessarily the first in the list.
2. Check any feedback loops, such as types and tests.
3. Append your progress to the progress.txt file.
4. Make a git commit of that feature.

ONLY WORK ON A SINGLE FEATURE.

If, while implementing the feature, you notice that all work
is complete, output ${COMPLETE_SIGNAL}.
`);

  // Add custom instructions if provided
  if (customInstructions) {
    parts.push(customInstructions);
  }

  return parts.join("\n");
}
