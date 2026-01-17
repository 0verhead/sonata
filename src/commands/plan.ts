import * as p from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, configExists } from "../lib/config.js";
import {
  buildPlanningPrompt,
  checkOpenCodeInstalled,
  spawnOpenCodeTui,
} from "../lib/opencode.js";
import {
  fetchTicketsViaMcp,
  checkTicketHasPrd,
  type TicketInfo,
} from "../lib/notion-via-opencode.js";
import {
  isGitRepo,
  getCurrentBranch,
  createBranch,
} from "../lib/git.js";
import { isCancelled } from "../types/index.js";
import {
  isNotionMcpConfigured,
  configureNotionMcp,
} from "../lib/opencode-config.js";
import {
  initSession,
  loadCurrentSession,
  hasActiveSession,
  updateSessionPrd,
} from "../lib/session.js";

interface PlanOptions {
  cwd?: string;
  ticketId?: string; // Optionally specify ticket directly
}

/**
 * Plan command - collaborative PRD creation with the developer
 *
 * This is Phase 1 of the True Ralph pattern:
 * - Select a ticket from Notion
 * - Collaboratively write the PRD with the developer
 * - Save the PRD to Notion as a child page
 * - Human approves the plan before any execution
 */
export async function planCommand(options: PlanOptions = {}): Promise<void> {
  const { cwd = process.cwd() } = options;

  p.intro(chalk.bgCyan.black(" notion-code plan (HITL, collaborative) "));

  // Check if Notion is configured
  if (!configExists()) {
    p.cancel("No configuration found. Run `notion-code setup` first.");
    process.exit(1);
  }

  const config = loadConfig();

  if (!config.notion.boardId) {
    p.cancel("Notion board not configured. Run `notion-code setup` first.");
    process.exit(1);
  }

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

  // Auto-configure opencode.json if needed
  if (!isNotionMcpConfigured(cwd)) {
    s.start("Configuring opencode.json for this project...");
    configureNotionMcp(cwd);
    s.stop("Created opencode.json with Notion MCP");
  }

  // Check for existing session
  if (hasActiveSession(cwd)) {
    const session = loadCurrentSession(cwd);
    if (session) {
      p.note(
        `Currently working on: ${session.ticketTitle}\n` +
        `Branch: ${session.branch}\n` +
        `Iterations: ${session.iteration}`,
        "Active Session Found"
      );

      const continueOrNew = await p.select({
        message: "What would you like to do?",
        options: [
          { value: "continue", label: "Continue planning for current ticket" },
          { value: "new", label: "Start planning for a different ticket" },
          { value: "cancel", label: "Cancel" },
        ],
      });

      if (isCancelled(continueOrNew) || continueOrNew === "cancel") {
        p.cancel("Cancelled");
        process.exit(0);
      }

      if (continueOrNew === "continue" && session) {
        // Continue with existing ticket
        await runPlanningSession({
          ticketId: session.ticketId,
          ticketTitle: session.ticketTitle,
          ticketUrl: session.ticketUrl,
          cwd,
        });
        return;
      }
      // Otherwise fall through to select new ticket
    }
  }

  // Fetch tickets from Notion
  s.start("Fetching tickets from Notion...");

  let tickets: TicketInfo[];
  try {
    tickets = await fetchTicketsViaMcp(
      config.notion.boardId,
      config.notion.statusColumn,
      cwd
    );
  } catch (err) {
    s.stop("Failed to fetch tickets");
    p.log.error(`Error: ${err}`);
    process.exit(1);
  }

  s.stop(`Found ${tickets.length} tickets in "${config.notion.statusColumn.todo}" status`);

  if (tickets.length === 0) {
    p.cancel(`No tickets found in "${config.notion.statusColumn.todo}" status.`);
    process.exit(0);
  }

  // Let user select a ticket
  const ticketOptions = tickets.map(t => ({
    value: t.id,
    label: t.title,
    hint: t.url,
  }));

  const selectedTicketId = options.ticketId ?? await p.select({
    message: "Select a ticket to plan:",
    options: ticketOptions,
  });

  if (isCancelled(selectedTicketId)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const selectedTicket = tickets.find(t => t.id === selectedTicketId);
  if (!selectedTicket) {
    p.cancel("Ticket not found");
    process.exit(1);
  }

  // Create git branch if needed
  let branch = "";
  if (inGitRepo && config.git.createBranch) {
    const currentBranch = await getCurrentBranch(cwd);
    if (currentBranch === config.git.baseBranch) {
      // Create branch from ticket title
      const safeBranchName = selectedTicket.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 50);
      branch = `task/${safeBranchName}`;

      s.start(`Creating branch ${branch}...`);
      await createBranch(branch, config.git.baseBranch, cwd);
      s.stop(`Switched to branch ${branch}`);
    } else {
      branch = currentBranch;
      p.log.info(`Working on branch: ${branch}`);
    }
  }

  // Initialize session
  initSession(cwd, {
    ticketId: selectedTicket.id,
    ticketTitle: selectedTicket.title,
    ticketUrl: selectedTicket.url,
    branch,
  });

  p.log.success("Session initialized");

  // Run the planning session
  await runPlanningSession({
    ticketId: selectedTicket.id,
    ticketTitle: selectedTicket.title,
    ticketUrl: selectedTicket.url,
    cwd,
  });
}

/**
 * Run the interactive planning session with OpenCode TUI
 * 
 * This launches OpenCode's native terminal UI which provides:
 * - Syntax highlighting
 * - Markdown rendering
 * - Plan mode (Tab key)
 * - All OpenCode features (/undo, images, etc.)
 */
async function runPlanningSession(options: {
  ticketId: string;
  ticketTitle: string;
  ticketUrl: string;
  cwd: string;
}): Promise<void> {
  const { ticketId, ticketTitle, ticketUrl, cwd } = options;

  p.note(
    `Ticket: ${ticketTitle}\n` +
    `URL: ${ticketUrl}\n\n` +
    "OpenCode will help you create a PRD. Here's the flow:\n\n" +
    "1. AI fetches ticket details and explores codebase\n" +
    "2. AI asks you clarifying questions\n" +
    "3. AI proposes a PRD, you give feedback\n" +
    `4. When satisfied, say: ${chalk.cyan('"Approve"')} or ${chalk.cyan('"Save the PRD"')}\n` +
    "5. AI creates the PRD as a child page in Notion\n" +
    `6. Exit OpenCode (${chalk.dim("Ctrl+C")} or type ${chalk.dim("/quit")})\n\n` +
    chalk.yellow("Tip: Use Tab to switch to Plan mode for discussion-only."),
    "Planning Session"
  );

  const confirm = await p.confirm({
    message: "Launch OpenCode for planning?",
    initialValue: true,
  });

  if (isCancelled(confirm) || confirm !== true) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  // Build the planning prompt
  const prompt = buildPlanningPrompt({
    ticketId,
    ticketTitle,
    ticketUrl,
  });

  console.log();
  console.log(chalk.cyan("Launching OpenCode TUI..."));
  console.log(chalk.dim("(Exit with Ctrl+C or /quit when done)"));
  console.log();

  // Spawn OpenCode TUI with the prompt
  const result = spawnOpenCodeTui(prompt, { cwd });

  console.log();
  console.log(chalk.dim("-".repeat(60)));

  // Check if user interrupted
  if (result.signal === "SIGINT") {
    p.log.warn("Planning session interrupted");
  }

  // Check if PRD was created
  const s = p.spinner();
  s.start("Checking if PRD was created in Notion...");

  const prdStatus = await checkTicketHasPrd(ticketId, cwd);

  if (prdStatus.hasPrd && prdStatus.prdPageId) {
    s.stop("PRD found!");

    // Update session with PRD info
    updateSessionPrd(cwd, {
      prdPageId: prdStatus.prdPageId,
      prdContent: "", // Will be fetched when needed by run/loop
      totalSteps: undefined,
    });

    p.log.success("PRD created in Notion!");
    p.note(
      "The PRD has been saved as a child page under the ticket.\n" +
      "Run `notion-code run` to start implementing the PRD.",
      "Next Steps"
    );
    p.outro(chalk.green("Planning session finished"));
  } else {
    s.stop("No PRD found in Notion");

    // Offer retry options
    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "retry", label: "Relaunch OpenCode", hint: "continue the planning session" },
        { value: "manual", label: "I'll create it manually", hint: "exit for now" },
        { value: "done", label: "I didn't want to save yet", hint: "exit, plan again later" },
      ],
    });

    if (action === "retry") {
      // Relaunch planning session
      await runPlanningSession(options);
      return;
    }

    if (action === "manual") {
      p.note(
        "You can create the PRD manually in Notion as a child page under the ticket.\n" +
        "Make sure to title it 'PRD' so notion-code can find it.\n" +
        "Then run `notion-code run` to start implementing.",
        "Manual PRD Creation"
      );
    } else {
      p.note(
        "Run `notion-code plan` again when you're ready to continue.\n" +
        "OpenCode will remember the context from your previous session.",
        "Next Steps"
      );
    }

    p.outro(chalk.yellow("Planning session ended without PRD"));
  }
}
