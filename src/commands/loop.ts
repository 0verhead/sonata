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
} from "../lib/git.js";
import {
  isNonEmptyString,
  isCancelled,
} from "../types/index.js";

const DEFAULT_TASK_FILE = "TASKS.md";

interface LoopOptions {
  iterations?: number;
  taskFile?: string;
  cwd?: string;
  hitl?: boolean; // Pause after each iteration for confirmation
}

/**
 * Run the Ralph loop - multiple iterations until complete or max reached
 *
 * This implements the core Ralph pattern:
 * ```bash
 * for ((i=1; i<=$1; i++)); do
 *   result=$(opencode -p "@TASKS.md @progress.txt ...")
 *   if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
 *     echo "Complete!"
 *     exit 0
 *   fi
 * done
 * ```
 */
export async function loopCommand(options: LoopOptions = {}): Promise<void> {
  const config = loadConfig();
  const {
    iterations = config.loop.maxIterations,
    taskFile = DEFAULT_TASK_FILE,
    cwd = process.cwd(),
    hitl = false,
  } = options;

  const mode = hitl ? "HITL" : "AFK";
  p.intro(
    chalk.bgMagenta.white(
      ` notion-code loop (${mode} mode, max ${iterations} iterations) `
    )
  );

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
  const hasNotionConfig = Boolean(config.notion.boardId);
  const taskFilePath = path.join(cwd, taskFile);
  const hasTaskFile = fs.existsSync(taskFilePath);

  let taskSource: TaskSource;

  if (hasNotionConfig && !hasTaskFile) {
    // Notion configured, no local file - use Notion
    taskSource = {
      type: "notion",
      notionBoardId: config.notion.boardId,
      notionStatusColumn: config.notion.statusColumn,
    };
    p.log.info(`Using Notion board: ${config.notion.boardName ?? config.notion.boardId}`);
  } else if (hasNotionConfig && hasTaskFile) {
    // Both available - ask user
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
  } else if (hasTaskFile) {
    // Only file available
    taskSource = {
      type: "file",
      taskFile,
    };
  } else {
    // No task source
    p.cancel(
      `No task source found. Either create ${taskFile} or run \`notion-code setup\` to configure Notion.`
    );
    process.exit(1);
  }

  // Initialize progress if needed
  const startIteration = getCurrentIteration(cwd);
  const taskSourceLabel = taskSource.type === "notion"
    ? `Notion: ${config.notion.boardName ?? config.notion.boardId}`
    : taskFile;

  if (!progressExists(cwd)) {
    initProgress(cwd, taskSourceLabel);
    p.log.info("Initialized progress.txt");
  }

  // Git branch handling
  let currentBranch = "";
  if (inGitRepo) {
    currentBranch = await getCurrentBranch(cwd);
    if (currentBranch === config.git.baseBranch && config.git.createBranch) {
      const createNew = await p.confirm({
        message: `You're on ${config.git.baseBranch}. Create a new task branch?`,
        initialValue: true,
      });

      if (isCancelled(createNew)) {
        p.cancel("Cancelled");
        process.exit(0);
      }

      if (createNew === true) {
        const branchName = await p.text({
          message: "Branch name:",
          placeholder: "task/my-feature",
          validate: (v) => (!v ? "Branch name required" : undefined),
        });

        if (isCancelled(branchName)) {
          p.cancel("Cancelled");
          process.exit(0);
        }

        if (isNonEmptyString(branchName)) {
          s.start(`Creating branch ${branchName}...`);
          await createBranch(branchName, config.git.baseBranch, cwd);
          s.stop(`Switched to branch ${branchName}`);
          currentBranch = branchName;
        }
      }
    }
  }

  // Confirm before starting AFK mode
  if (!hitl) {
    const taskSourceDisplay = taskSource.type === "notion"
      ? `Notion board: ${config.notion.boardName ?? config.notion.boardId}`
      : `Task file: ${taskFile}`;

    p.note(
      `${taskSourceDisplay}
Max iterations: ${iterations}
Branch: ${currentBranch || "N/A"}

The loop will run autonomously until:
- All tasks are complete (<promise>COMPLETE</promise>)
- Max iterations reached
- An error occurs`,
      "AFK Mode"
    );

    const confirm = await p.confirm({
      message: "Start the Ralph loop?",
      initialValue: true,
    });

    if (isCancelled(confirm) || confirm !== true) {
      p.cancel("Cancelled");
      process.exit(0);
    }
  }

  // Build base prompt
  const progressFile = "progress.txt";
  const prompt = buildPrompt({
    taskSource,
    progressFile,
  });

  // The Ralph Loop
  console.log();
  p.log.step(chalk.bold("Starting Ralph loop..."));
  console.log();

  for (let i = 1; i <= iterations; i++) {
    const currentIteration = startIteration + i;

    console.log(chalk.cyan(`\n${"═".repeat(60)}`));
    console.log(
      chalk.cyan.bold(`  Iteration ${i}/${iterations} (total: ${currentIteration})`)
    );
    console.log(chalk.cyan(`${"═".repeat(60)}\n`));

    // HITL mode: confirm before each iteration
    if (hitl && i > 1) {
      const continueLoop = await p.confirm({
        message: "Continue to next iteration?",
        initialValue: true,
      });

      if (isCancelled(continueLoop) || continueLoop !== true) {
        p.log.info("Loop paused by user");
        break;
      }
    }

    // Run opencode
    const result = await runOpenCode(prompt, { cwd, stream: true });

    console.log();

    // Check for errors
    if (!result.success) {
      p.log.error(`opencode failed: ${result.error}`);
      p.log.info(`Stopped at iteration ${i}`);
      break;
    }

    // Check for completion
    if (result.isComplete) {
      console.log();
      p.log.success(
        chalk.green.bold("🎉 <promise>COMPLETE</promise> detected!")
      );
      p.log.success("All tasks complete!");
      markProgressComplete(cwd);

      // Create PR
      if (
        inGitRepo &&
        config.git.createPR &&
        currentBranch !== config.git.baseBranch
      ) {
        s.start("Creating pull request...");
        try {
          const prTitle = currentBranch.replace("task/", "").replace(/-/g, " ");
          const prUrl = await createPR(
            prTitle,
            `Completed via notion-code Ralph loop\n\nIterations: ${i}\nSee progress.txt for details.`,
            config.git.baseBranch,
            cwd
          );
          s.stop(`PR created: ${prUrl}`);
        } catch (error) {
          s.stop("Failed to create PR");
          p.log.warn(`Could not create PR: ${error}`);
        }
      }

      // Ensure cleanup before exit
      killActiveProcess();

      p.outro(chalk.green(`Completed in ${i} iteration${i === 1 ? "" : "s"}!`));
      return;
    }

    p.log.info(`Iteration ${i} complete, task not yet finished`);
  }

  // Max iterations reached
  console.log();
  p.log.warn(`Max iterations (${iterations}) reached`);
  p.note(
    "The task is not yet complete. You can:\n" +
      "- Run `notion-code loop` again to continue\n" +
      "- Run `notion-code run` for manual control\n" +
      "- Check progress.txt for current state",
    "Max Iterations Reached"
  );

  // Ensure cleanup
  killActiveProcess();

  p.outro(chalk.yellow(`Stopped after ${iterations} iterations`));
}
