import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { runCommand } from "./commands/run.js";
import { loopCommand } from "./commands/loop.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("notion-code")
  .description(
    "CLI tool that implements the Ralph loop pattern using OpenCode and Notion kanban boards"
  )
  .version("0.1.0");

// Setup command
program
  .command("setup")
  .description("Configure notion-code: Notion connection, git settings, etc.")
  .action(async () => {
    await setupCommand();
  });

// Run command (HITL - single iteration)
program
  .command("run")
  .description("Run a single iteration (HITL mode)")
  .option("-t, --task-file <file>", "Task file path", "TASKS.md")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .action(async (options) => {
    await runCommand({
      taskFile: options.taskFile,
      cwd: options.dir,
    });
  });

// Loop command (AFK mode)
program
  .command("loop [iterations]")
  .description("Run the Ralph loop (AFK mode)")
  .option("-t, --task-file <file>", "Task file path", "TASKS.md")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .option("--hitl", "Human-in-the-loop mode (pause after each iteration)", false)
  .action(async (iterations, options) => {
    await loopCommand({
      iterations: iterations ? parseInt(iterations, 10) : undefined,
      taskFile: options.taskFile,
      cwd: options.dir,
      hitl: options.hitl,
    });
  });

// Status command
program
  .command("status")
  .description("Show current status: config, progress, git state")
  .option("-t, --task-file <file>", "Task file path", "TASKS.md")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .action(async (options) => {
    await statusCommand({
      taskFile: options.taskFile,
      cwd: options.dir,
    });
  });

// Parse and execute
program.parse();
