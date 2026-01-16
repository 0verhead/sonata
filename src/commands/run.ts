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
} from "../lib/git.js";
import {
  isNonEmptyString,
  isBoolean,
  isCancelled,
} from "../types/index.js";

const DEFAULT_TASK_FILE = "TASKS.md";

interface RunOptions {
  taskFile?: string;
  cwd?: string;
}

/**
 * Run a single iteration (HITL mode)
 * This is the core of the Ralph loop - one pass through the prompt
 */
export async function runCommand(options: RunOptions = {}): Promise<void> {
  const { taskFile = DEFAULT_TASK_FILE, cwd = process.cwd() } = options;

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

  // Check for task file
  const taskFilePath = path.join(cwd, taskFile);
  if (!fs.existsSync(taskFilePath)) {
    const createFile = await p.confirm({
      message: `Task file "${taskFile}" not found. Create it?`,
    });

    if (isCancelled(createFile)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    if (createFile === true) {
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
      p.note(
        `Edit ${taskFile} with your tasks, then run again.`,
        "Next Steps"
      );
      p.outro("Setup task file first");
      return;
    } else {
      p.cancel("Task file required to continue.");
      process.exit(1);
    }
  }

  // Initialize or continue progress
  const iteration = getCurrentIteration(cwd) + 1;

  if (!progressExists(cwd)) {
    initProgress(cwd, taskFile);
    p.log.info("Initialized progress.txt");
  }

  // Git branch handling
  if (inGitRepo && config.git.createBranch) {
    const currentBranch = await getCurrentBranch(cwd);

    if (currentBranch === config.git.baseBranch) {
      // On base branch, might need to create task branch
      const createNew = await p.confirm({
        message: `You're on ${config.git.baseBranch}. Create a new task branch?`,
        initialValue: true,
      });

      if (isCancelled(createNew)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      if (createNew === true) {
        const branchName = await p.text({
          message: "Branch name:",
          placeholder: "task/my-feature",
          validate: (v) => (!v ? "Branch name required" : undefined),
        });

        if (isCancelled(branchName)) {
          p.cancel("Setup cancelled");
          process.exit(0);
        }

        if (isNonEmptyString(branchName)) {
          s.start(`Creating branch ${branchName}...`);
          await createBranch(branchName, config.git.baseBranch, cwd);
          s.stop(`Switched to branch ${branchName}`);
        }
      }
    } else {
      p.log.info(`Working on branch: ${currentBranch}`);
    }
  }

  // Build the prompt
  p.log.step(`Starting iteration ${iteration}`);

  const progressFile = "progress.txt";
  const prompt = buildPrompt({
    taskFile,
    progressFile,
  });

  // Show what we're about to do
  p.note(
    `Task file: ${taskFile}
Progress file: ${progressFile}
Iteration: ${iteration}`,
    "Running opencode"
  );

  // Confirm before running
  const proceed = await p.confirm({
    message: "Ready to run opencode?",
    initialValue: true,
  });

  if (isCancelled(proceed) || proceed !== true) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  // Run opencode
  console.log();
  console.log(chalk.dim("─".repeat(60)));
  console.log(chalk.cyan("opencode output:"));
  console.log(chalk.dim("─".repeat(60)));
  console.log();

  const result = await runOpenCode(prompt, { cwd, stream: true });

  console.log();
  console.log(chalk.dim("─".repeat(60)));
  console.log();

  // Handle result
  if (!result.success) {
    p.log.error(`opencode failed: ${result.error}`);
    process.exit(1);
  }

  if (result.isComplete) {
    p.log.success("Task marked as COMPLETE!");
    markProgressComplete(cwd);

    // Create PR if configured
    if (inGitRepo && config.git.createPR) {
      const currentBranch = await getCurrentBranch(cwd);
      if (currentBranch !== config.git.baseBranch) {
        const shouldCreatePR = await p.confirm({
          message: "Create a pull request?",
          initialValue: true,
        });

        if (isCancelled(shouldCreatePR)) {
          p.cancel("Cancelled");
          process.exit(0);
        }

        if (shouldCreatePR === true) {
          const prTitle = await p.text({
            message: "PR title:",
            initialValue: currentBranch.replace("task/", "").replace(/-/g, " "),
          });

          if (isCancelled(prTitle)) {
            p.cancel("Cancelled");
            process.exit(0);
          }

          if (isNonEmptyString(prTitle)) {
            s.start("Creating pull request...");
            try {
              const prUrl = await createPR(
                prTitle,
                `Completed via notion-code\n\nSee progress.txt for details.`,
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
