import * as p from "@clack/prompts";
import chalk from "chalk";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  loadConfig,
  configExists,
  getConfigPath,
} from "../lib/config.js";
import {
  progressExists,
  readProgress,
  getCurrentIteration,
  getProgressPath,
} from "../lib/progress.js";
import {
  isGitRepo,
  getCurrentBranch,
  hasChanges,
  getRemoteUrl,
} from "../lib/git.js";
import { checkOpenCodeInstalled } from "../lib/opencode.js";
import { checkGhInstalled } from "../lib/git.js";
import {
  isNotionMcpConfigured,
  openCodeConfigExists,
  getOpenCodeConfigPath,
} from "../lib/opencode-config.js";

const DEFAULT_TASK_FILE = "TASKS.md";

interface StatusOptions {
  taskFile?: string;
  cwd?: string;
}

export async function statusCommand(options: StatusOptions = {}): Promise<void> {
  const { taskFile = DEFAULT_TASK_FILE, cwd = process.cwd() } = options;

  p.intro(chalk.bgGreen.black(" notion-code status "));

  // Config status
  console.log();
  console.log(chalk.bold("Configuration:"));
  if (configExists()) {
    const config = loadConfig();
    console.log(`  ${chalk.green("✓")} Config file: ${getConfigPath()}`);
    console.log(
      `    Notion board: ${config.notion.boardName || config.notion.boardId || "Not configured"}`
    );
    console.log(`    Create branches: ${config.git.createBranch ? "Yes" : "No"}`);
    console.log(`    Create PRs: ${config.git.createPR ? "Yes" : "No"}`);
    console.log(`    Base branch: ${config.git.baseBranch}`);
    console.log(`    Max iterations: ${config.loop.maxIterations}`);
  } else {
    console.log(`  ${chalk.yellow("!")} No config found. Run \`notion-code setup\``);
  }

  // Task source status
  console.log();
  console.log(chalk.bold("Task Source:"));
  const taskFilePath = path.join(cwd, taskFile);
  const hasTaskFile = fs.existsSync(taskFilePath);
  const hasNotionConfig = configExists() && Boolean(loadConfig().notion.boardId);

  if (hasNotionConfig) {
    const config = loadConfig();
    console.log(`  ${chalk.green("✓")} Notion board: ${config.notion.boardName ?? config.notion.boardId}`);
    console.log(`    Status columns: ${config.notion.statusColumn.todo} → ${config.notion.statusColumn.inProgress} → ${config.notion.statusColumn.done}`);
  }

  if (hasTaskFile) {
    const content = fs.readFileSync(taskFilePath, "utf-8");
    const lines = content.split("\n").length;
    const todoMatches = content.match(/- \[ \]/g);
    const doneMatches = content.match(/- \[x\]/gi);
    console.log(`  ${chalk.green("✓")} Local file: ${taskFile} (${lines} lines)`);
    console.log(`    Pending: ${todoMatches?.length ?? 0} tasks`);
    console.log(`    Done: ${doneMatches?.length ?? 0} tasks`);
  }

  if (!hasNotionConfig && !hasTaskFile) {
    console.log(`  ${chalk.yellow("!")} No task source configured`);
    console.log(`    Run \`notion-code setup\` for Notion, or \`notion-code run\` to create ${taskFile}`);
  }

  // Progress status
  console.log();
  console.log(chalk.bold("Progress:"));
  if (progressExists(cwd)) {
    const iteration = getCurrentIteration(cwd);
    const content = readProgress(cwd);
    const isComplete = content.includes("ALL TASKS COMPLETE");
    console.log(`  ${chalk.green("✓")} progress.txt`);
    console.log(`    Iterations: ${iteration}`);
    console.log(
      `    Status: ${isComplete ? chalk.green("Complete") : chalk.blue("In progress")}`
    );

    // Show last few lines
    const lines = content.split("\n").filter((l) => l.trim());
    const lastLines = lines.slice(-5);
    if (lastLines.length > 0) {
      console.log(`    Recent:`);
      lastLines.forEach((line) => {
        console.log(`      ${chalk.dim(line.substring(0, 60))}`);
      });
    }
  } else {
    console.log(`  ${chalk.dim("-")} No progress.txt yet`);
  }

  // Git status
  console.log();
  console.log(chalk.bold("Git:"));
  const inGitRepo = await isGitRepo(cwd);
  if (inGitRepo) {
    const branch = await getCurrentBranch(cwd);
    const changes = await hasChanges(cwd);
    const remote = await getRemoteUrl(cwd);
    console.log(`  ${chalk.green("✓")} Git repository`);
    console.log(`    Branch: ${branch}`);
    console.log(`    Changes: ${changes ? chalk.yellow("Yes") : "No"}`);
    console.log(`    Remote: ${remote || "None"}`);
  } else {
    console.log(`  ${chalk.yellow("!")} Not a git repository`);
  }

  // OpenCode config status
  console.log();
  console.log(chalk.bold("OpenCode Config:"));
  if (openCodeConfigExists(cwd)) {
    const hasNotionMcp = isNotionMcpConfigured(cwd);
    console.log(`  ${chalk.green("✓")} ${getOpenCodeConfigPath(cwd)}`);
    console.log(
      `    Notion MCP: ${hasNotionMcp ? chalk.green("Configured") : chalk.yellow("Not configured")}`
    );
    if (hasNotionConfig && !hasNotionMcp) {
      console.log(
        chalk.yellow(`    Run \`notion-code setup\` to configure Notion MCP`)
      );
    }
  } else {
    console.log(`  ${chalk.dim("-")} opencode.json not found`);
    if (hasNotionConfig) {
      console.log(
        chalk.yellow(`    Run \`notion-code setup\` to create it`)
      );
    }
  }

  // Prerequisites
  console.log();
  console.log(chalk.bold("Prerequisites:"));
  const [hasOpenCode, hasGh] = await Promise.all([
    checkOpenCodeInstalled(),
    checkGhInstalled(),
  ]);
  console.log(
    `  ${hasOpenCode ? chalk.green("✓") : chalk.red("✗")} opencode CLI`
  );
  console.log(
    `  ${hasGh ? chalk.green("✓") : chalk.red("✗")} GitHub CLI (gh)`
  );

  console.log();
  p.outro("Run `notion-code run` to start or continue");
}
