import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { planCommand } from "./commands/plan.js";
import { runCommand } from "./commands/run.js";
import { loopCommand } from "./commands/loop.js";
import { statusCommand } from "./commands/status.js";
import { cleanCommand } from "./commands/clean.js";

const program = new Command();

program
  .name("sonata")
  .description(
    "CLI tool that implements the Ralph loop pattern using OpenCode and Notion kanban boards"
  )
  .version("0.1.0");

// Setup command
program
  .command("setup")
  .description("Configure sonata: Notion connection, git settings, etc.")
  .action(async () => {
    await setupCommand();
  });

// Plan command (Phase 1: collaborative PRD creation)
program
  .command("plan")
  .description("Create a PRD for a ticket (collaborative planning)")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .option("--ticket <id>", "Ticket ID to plan (skip selection)")
  .option("--local", "Use local specs/ folder instead of Notion")
  .option("--notion", "Use Notion board")
  .action(async (options) => {
    await planCommand({
      cwd: options.dir,
      ticketId: options.ticket,
      local: options.local,
      notion: options.notion,
    });
  });

// Run command (Phase 2: implement one step)
program
  .command("run")
  .description("Implement one PRD step (HITL mode)")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .option("-y, --yes", "Auto-confirm prompts", false)
  .option("--ticket <id>", "Ticket ID to work on (bypass status filter)")
  .option("--local", "Use local specs/ folder instead of Notion")
  .option("--notion", "Use Notion board")
  .action(async (options) => {
    await runCommand({
      cwd: options.dir,
      yes: options.yes,
      ticketId: options.ticket,
      local: options.local,
      notion: options.notion,
    });
  });

// Loop command (Phase 2: implement multiple steps autonomously)
program
  .command("loop [iterations]")
  .description("Implement PRD steps autonomously (AFK mode)")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .option("--hitl", "Human-in-the-loop mode (pause after each iteration)", false)
  .option("--ticket <id>", "Ticket ID to work on (bypass status filter)")
  .option("--local", "Use local specs/ folder instead of Notion")
  .option("--notion", "Use Notion board")
  .action(async (iterations, options) => {
    await loopCommand({
      iterations: iterations ? parseInt(iterations, 10) : undefined,
      cwd: options.dir,
      hitl: options.hitl,
      ticketId: options.ticket,
      local: options.local,
      notion: options.notion,
    });
  });

// Status command
program
  .command("status")
  .description("Show current status: config, progress, git state")
  .option("-t, --task-file <file>", "Task file path", "TASKS.md")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .option("--local", "Show local specs status")
  .action(async (options) => {
    await statusCommand({
      taskFile: options.taskFile,
      cwd: options.dir,
      local: options.local,
    });
  });

// Clean command
program
  .command("clean")
  .description("Delete progress.txt to start fresh")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .option("-y, --yes", "Skip confirmation prompt", false)
  .action(async (options) => {
    await cleanCommand({
      cwd: options.dir,
      yes: options.yes,
    });
  });

// Parse and execute
program.parse();
