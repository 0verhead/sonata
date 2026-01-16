import * as p from "@clack/prompts";
import chalk from "chalk";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../lib/config.js";
import {
  runOpenCode,
  buildPrompt,
  checkOpenCodeInstalled,
  killActiveProcess,
  type TaskSource,
} from "../lib/opencode.js";
import {
  progressExists,
  initProgress,
  getCurrentIteration,
  markProgressComplete,
} from "../lib/progress.js";
import {
  isGitRepo,
  getCurrentBranch,
  createBranch,
  createPR,
  getCommitsSinceBase,
  generatePRTitle,
  generatePRBody,
} from "../lib/git.js";
import {
  isNonEmptyString,
  isCancelled,
} from "../types/index.js";
import {
  isNotionMcpConfigured,
  configureNotionMcp,
} from "../lib/opencode-config.js";

const DEFAULT_TASK_FILE = "TASKS.md";

interface RunOptions {
  taskFile?: string;
  cwd?: string;
  useNotion?: boolean; // Override to force Notion or file
  yes?: boolean; // Auto-confirm prompts
}

/**
 * Run a single iteration (HITL mode)
 * This is the core of the Ralph loop - one pass through the prompt
 */
export async function runCommand(options: RunOptions = {}): Promise<void> {
  const { taskFile = DEFAULT_TASK_FILE, cwd = process.cwd(), yes = false } = options;

  p.intro(chalk.bgBlue.white(" notion-code run (HITL) "));

  // Load config
  const config = loadConfig();

  // Check prerequisites
  const s = p.spinner();
  s.start("Checking prerequisites...");

  const [hasOpenCode, inGitRepo] = await Promise.all([
    checkOpenCodeInstalled(),
    isGitRepo(cwd),
  ]);

  s.stop("Prerequisites checked");

  if (!hasOpenCode) {
    p.cancel("opencode CLI not found. Please install it first.");
    process.exit(1);
  }

  // Determine task source: Notion or file
  const taskFilePath = path.join(cwd, taskFile);
  const hasTaskFile = fs.existsSync(taskFilePath);

  // If --file flag is set, force file-based task source
  const forceFile = options.useNotion === false;

  // Auto-configure opencode.json if Notion is set up globally but not in this project
  // (skip if --file flag is set)
  const hasNotionConfig = Boolean(config.notion.boardId);
  if (hasNotionConfig && !isNotionMcpConfigured(cwd) && !forceFile) {
    s.start("Configuring opencode.json for this project...");
    configureNotionMcp(cwd);
    s.stop("Created opencode.json with Notion MCP");
  }

  let taskSource: TaskSource;

  if (forceFile && hasTaskFile) {
    // Force file mode via --file flag
    taskSource = {
      type: "file",
      taskFile,
    };
    p.log.info(`Using local file: ${taskFile}`);
  } else if (hasNotionConfig && !hasTaskFile) {
    // Notion configured, no local file - use Notion
    taskSource = {
      type: "notion",
      notionBoardId: config.notion.boardId,
      notionStatusColumn: config.notion.statusColumn,
    };
    p.log.info(`Using Notion board: ${config.notion.boardName ?? config.notion.boardId}`);
  } else if (hasNotionConfig && hasTaskFile && !forceFile) {
    // Both available - ask user (unless --yes flag, then default to file)
    if (yes) {
      taskSource = {
        type: "file",
        taskFile,
      };
      p.log.info(`Using local file: ${taskFile} (auto-selected)`);
    } else {
      const source = await p.select({
        message: "Task source:",
        options: [
          {
            value: "notion",
            label: `Notion board (${config.notion.boardName ?? config.notion.boardId})`,
          },
          {
            value: "file",
            label: `Local file (${taskFile})`,
          },
        ],
      });

      if (isCancelled(source)) {
        p.cancel("Cancelled");
        process.exit(0);
      }

      if (source === "notion") {
        taskSource = {
          type: "notion",
          notionBoardId: config.notion.boardId,
          notionStatusColumn: config.notion.statusColumn,
        };
      } else {
        taskSource = {
          type: "file",
          taskFile,
        };
      }
    }
  } else if (hasTaskFile) {
    // Only file available
    taskSource = {
      type: "file",
      taskFile,
    };
  } else {
    // No task source - offer to create file or setup Notion
    const choice = await p.select({
      message: "No task source found. What would you like to do?",
      options: [
        { value: "create", label: `Create ${taskFile}` },
        { value: "setup", label: "Run setup to configure Notion" },
        { value: "cancel", label: "Cancel" },
      ],
    });

    if (isCancelled(choice) || choice === "cancel") {
      p.cancel("Cancelled");
      process.exit(0);
    }

    if (choice === "setup") {
      p.note("Run `notion-code setup` to configure Notion", "Next Steps");
      process.exit(0);
    }

    // Create task file
    const template = `# Tasks

## To Do

- [ ] Task 1: Description
- [ ] Task 2: Description

## In Progress

## Done

---

## Notes

Add any notes or context for the AI here.
`;
    fs.writeFileSync(taskFilePath, template, "utf-8");
    p.log.success(`Created ${taskFile}`);
    p.note(`Edit ${taskFile} with your tasks, then run again.`, "Next Steps");
    p.outro("Setup task file first");
    return;
  }

  // Initialize or continue progress
  const iteration = getCurrentIteration(cwd) + 1;
  const taskSourceLabel = taskSource.type === "notion"
    ? `Notion: ${config.notion.boardName ?? config.notion.boardId}`
    : taskFile;

  if (!progressExists(cwd)) {
    initProgress(cwd, taskSourceLabel);
    p.log.info("Initialized progress.txt");
  }

  // Git branch handling
  if (inGitRepo && config.git.createBranch) {
    const currentBranch = await getCurrentBranch(cwd);

    if (currentBranch === config.git.baseBranch) {
      // Auto-generate branch name based on timestamp
      const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const shortId = Math.random().toString(36).substring(2, 8);
      const branchName = `task/${timestamp}-${shortId}`;

      s.start(`Creating branch ${branchName}...`);
      await createBranch(branchName, config.git.baseBranch, cwd);
      s.stop(`Switched to branch ${branchName}`);
    } else {
      p.log.info(`Working on branch: ${currentBranch}`);
    }
  }

  // Build the prompt
  p.log.step(`Starting iteration ${iteration}`);

  const progressFile = "progress.txt";
  const prompt = buildPrompt({
    taskSource,
    progressFile,
  });

  // Show what we're about to do
  p.note(
    `Task source: ${taskSource.type === "notion" ? "Notion board" : taskFile}
Progress file: ${progressFile}
Iteration: ${iteration}`,
    "Running opencode"
  );

  // Confirm before running (skip if --yes flag)
  if (!yes) {
    const proceed = await p.confirm({
      message: "Ready to run opencode?",
      initialValue: true,
    });

    if (isCancelled(proceed) || proceed !== true) {
      p.cancel("Cancelled");
      process.exit(0);
    }
  }

  // NOTE: Server mode disabled - --attach breaks --format json output
  // TODO: Implement HTTP API interaction for proper server mode

  // Run opencode
  console.log();
  console.log(chalk.dim("─".repeat(60)));
  console.log(chalk.cyan("opencode output:"));
  console.log(chalk.dim("─".repeat(60)));
  console.log();

  const result = await runOpenCode(prompt, { cwd });

  console.log();
  console.log(chalk.dim("─".repeat(60)));
  console.log();

  // Handle result
  if (!result.success) {
    p.log.error(`opencode failed: ${result.error}`);
    killActiveProcess();
    process.exit(1);
  }

  if (result.isComplete) {
    p.log.success("Task marked as COMPLETE!");
    markProgressComplete(cwd);

    // Create PR if configured
    if (inGitRepo && config.git.createPR) {
      const currentBranch = await getCurrentBranch(cwd);
      if (currentBranch !== config.git.baseBranch) {
        // Get commits for PR body
        const commits = await getCommitsSinceBase(config.git.baseBranch, cwd);
        
        // PR title priority: task title from Notion > first commit message > fallback
        const prTitle = result.taskTitle ?? generatePRTitle(commits);
        const prBody = generatePRBody(commits, result.taskTitle);

        let shouldCreatePR: boolean | symbol = true;

        if (!yes) {
          // Only ask if user wants to create PR, not for the title
          shouldCreatePR = await p.confirm({
            message: `Create PR: "${prTitle}"?`,
            initialValue: true,
          });

          if (isCancelled(shouldCreatePR)) {
            p.cancel("Cancelled");
            process.exit(0);
          }
        }

        if (shouldCreatePR === true) {
          s.start(`Creating PR: "${prTitle}"...`);
          try {
            const prUrl = await createPR(
              prTitle,
              prBody,
              config.git.baseBranch,
              cwd
            );
            s.stop(`PR created: ${prUrl}`);
          } catch (error) {
            s.stop("Failed to create PR");
            p.log.error(String(error));
          }
        }
      }
    }
  } else {
    p.log.info("Iteration complete. Task not yet finished.");
    p.note(
      "Run `notion-code run` again to continue, or `notion-code loop` for AFK mode.",
      "Next Steps"
    );
  }

  // Ensure cleanup
  killActiveProcess();

  p.outro(
    result.isComplete
      ? chalk.green("All done!")
      : chalk.blue(`Iteration ${iteration} complete`)
  );
}
