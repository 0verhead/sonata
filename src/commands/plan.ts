import * as p from '@clack/prompts';
import chalk from 'chalk';

import { loadConfig, configExists } from '../lib/config.js';
import { isGitRepo, getCurrentBranch, createBranch } from '../lib/git.js';
import { resolveMode, ModeResolutionError } from '../lib/mode.js';
import {
  fetchTicketsViaMcp,
  fetchMoreTicketsViaMcp,
  checkTicketHasPrd,
  type TicketInfo,
} from '../lib/notion-via-opencode.js';
import { isNotionMcpConfigured, configureNotionMcp } from '../lib/opencode-config.js';
import {
  buildPlanningPrompt,
  buildLocalPlanningPrompt,
  checkOpenCodeInstalled,
  spawnOpenCodeTui,
} from '../lib/opencode.js';
import {
  initSession,
  loadCurrentSession,
  hasActiveSession,
  updateSessionPrd,
} from '../lib/session.js';
import { ensureSpecsDir, specsDir, listSpecs } from '../lib/specs.js';
import { isCancelled } from '../types/index.js';

interface PlanOptions {
  cwd?: string;
  ticketId?: string; // Optionally specify ticket directly
  local?: boolean; // Use local specs mode
  notion?: boolean; // Use Notion mode
}

/**
 * Plan command - collaborative PRD creation with the developer
 *
 * This is Phase 1 of the True Ralph pattern:
 * - Select a ticket from Notion OR create local spec
 * - Collaboratively write the PRD with the developer
 * - Save the PRD to Notion as a child page OR to specs/ folder
 * - Human approves the plan before any execution
 */
export async function planCommand(options: PlanOptions = {}): Promise<void> {
  const { cwd = process.cwd(), local, notion } = options;

  // Load config (may not exist for local-only mode)
  const config = configExists() ? loadConfig() : null;

  // Resolve mode
  let mode: 'local' | 'notion';
  try {
    if (local) {
      mode = 'local';
    } else if (notion) {
      mode = 'notion';
    } else if (config) {
      mode = resolveMode({ local, notion }, config, cwd);
    } else {
      // No config, check if specs folder exists
      mode = 'local'; // Default to local if no config
    }
  } catch (error) {
    if (error instanceof ModeResolutionError) {
      p.cancel(error.message);
      process.exit(1);
    }
    throw error;
  }

  // Branch to local or Notion workflow
  if (mode === 'local') {
    await runLocalPlanCommand({ ...options, cwd });
    return;
  }

  // Notion mode - original workflow
  p.intro(chalk.bgCyan.black(' sonata plan (HITL, collaborative) '));

  // Check if Notion is configured
  if (!config) {
    p.cancel('No configuration found. Run `sonata setup` first.');
    process.exit(1);
  }

  if (!config.notion.boardId) {
    p.cancel('Notion board not configured. Run `sonata setup` first.');
    process.exit(1);
  }

  // Check prerequisites
  const s = p.spinner();
  s.start('Checking prerequisites...');

  const [hasOpenCode, inGitRepo] = await Promise.all([checkOpenCodeInstalled(), isGitRepo(cwd)]);

  s.stop('Prerequisites checked');

  if (!hasOpenCode) {
    p.cancel('opencode CLI not found. Please install it first.');
    process.exit(1);
  }

  // Auto-configure opencode.json if needed
  if (!isNotionMcpConfigured(cwd)) {
    s.start('Configuring opencode.json for this project...');
    configureNotionMcp(cwd);
    s.stop('Created opencode.json with Notion MCP');
  }

  // Check for existing session
  if (hasActiveSession(cwd)) {
    const session = loadCurrentSession(cwd);
    if (session) {
      p.note(
        `Currently working on: ${session.ticketTitle}\n` +
          `Branch: ${session.branch}\n` +
          `Iterations: ${session.iteration}`,
        'Active Session Found'
      );

      const continueOrNew = await p.select({
        message: 'What would you like to do?',
        options: [
          { value: 'continue', label: 'Continue planning for current ticket' },
          { value: 'new', label: 'Start planning for a different ticket' },
          { value: 'cancel', label: 'Cancel' },
        ],
      });

      if (isCancelled(continueOrNew) || continueOrNew === 'cancel') {
        p.cancel('Cancelled');
        process.exit(0);
      }

      if (continueOrNew === 'continue' && session) {
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

  // Handle --ticket flag: skip fetching and use directly
  let selectedTicket: TicketInfo;

  if (options.ticketId) {
    // Direct ticket ID provided - use it without fetching all tickets
    const ticketId = options.ticketId;
    p.log.info(`Using ticket: ${ticketId}`);

    selectedTicket = {
      id: ticketId,
      title: `Ticket ${ticketId.slice(0, 8)}...`, // Placeholder, will be fetched by opencode
      status: config.notion.statusColumn.todo,
      url: `https://notion.so/${ticketId.replaceAll('-', '')}`,
      hasPrd: false,
    };
  } else {
    // Fetch tickets from Notion
    s.start('Fetching tickets from Notion...');

    let tickets: TicketInfo[];
    try {
      tickets = await fetchTicketsViaMcp(
        config.notion.boardId,
        config.notion.statusColumn,
        cwd,
        false, // includeInProgress
        config.notion.viewId
      );
    } catch (error) {
      s.stop('Failed to fetch tickets');
      p.log.error(`Error: ${error}`);
      process.exit(1);
    }

    s.stop(`Found ${tickets.length} tickets in "${config.notion.statusColumn.todo}" status`);

    if (tickets.length === 0) {
      p.cancel(`No tickets found in "${config.notion.statusColumn.todo}" status.`);
      process.exit(0);
    }

    // Let user select a ticket or search for more
    let selectedTicketId: string | symbol | undefined;

    while (!selectedTicketId) {
      const ticketOptions = [
        ...tickets.map((t) => ({
          value: t.id,
          label: t.title,
          hint: t.url,
        })),
        {
          value: '__MORE__',
          label: '🔍 Search for more tickets...',
          hint: "If you don't see all tickets",
        },
      ];

      const selection = await p.select({
        message: `Select a ticket to plan (${tickets.length} found):`,
        options: ticketOptions,
      });

      if (isCancelled(selection)) {
        p.cancel('Cancelled');
        process.exit(0);
      }

      if (selection === '__MORE__') {
        // Fetch more tickets with a broader search
        s.start('Searching for more tickets...');
        try {
          const moreTickets = await fetchMoreTicketsViaMcp(
            config.notion.boardId!,
            config.notion.statusColumn,
            cwd,
            tickets.map((t) => t.id), // Exclude already found
            config.notion.viewId
          );

          if (moreTickets.length > 0) {
            // Add new tickets to the list (deduplicate)
            const existingIds = new Set(tickets.map((t) => t.id));
            for (const ticket of moreTickets) {
              if (!existingIds.has(ticket.id)) {
                tickets.push(ticket);
                existingIds.add(ticket.id);
              }
            }
            s.stop(`Found ${moreTickets.length} additional tickets (${tickets.length} total)`);
          } else {
            s.stop('No additional tickets found');
          }
        } catch (error) {
          s.stop('Search failed');
          p.log.warn(`Could not search for more: ${error}`);
        }
        continue; // Show selection again with updated list
      }

      selectedTicketId = selection;
    }

    const found = tickets.find((t) => t.id === selectedTicketId);
    if (!found) {
      p.cancel('Ticket not found');
      process.exit(1);
    }
    selectedTicket = found;
  }

  // Create git branch if needed
  let branch = '';
  if (inGitRepo && config.git.createBranch) {
    const currentBranch = await getCurrentBranch(cwd);
    if (currentBranch === config.git.baseBranch) {
      // Create branch from ticket title
      const safeBranchName = selectedTicket.title
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-|-$/g, '')
        .slice(0, 50);
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

  p.log.success('Session initialized');

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
      '1. AI fetches ticket details and explores codebase\n' +
      '2. AI asks you clarifying questions\n' +
      '3. AI proposes a PRD, you give feedback\n' +
      `4. When satisfied, say: ${chalk.cyan('"Approve"')} or ${chalk.cyan('"Save the PRD"')}\n` +
      '5. AI creates the PRD as a child page in Notion\n' +
      `6. Exit OpenCode (${chalk.dim('Ctrl+C')} or type ${chalk.dim('/quit')})\n\n` +
      chalk.yellow('Tip: Use Tab to switch to Plan mode for discussion-only.'),
    'Planning Session'
  );

  const confirm = await p.confirm({
    message: 'Launch OpenCode for planning?',
    initialValue: true,
  });

  if (isCancelled(confirm) || confirm !== true) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  // Build the planning prompt
  const prompt = buildPlanningPrompt({
    ticketId,
    ticketTitle,
    ticketUrl,
  });

  console.log();
  console.log(chalk.cyan('Launching OpenCode TUI...'));
  console.log(chalk.dim('(Exit with Ctrl+C or /quit when done)'));
  console.log();

  // Spawn OpenCode TUI with the prompt
  const result = spawnOpenCodeTui(prompt, { cwd });

  console.log();
  console.log(chalk.dim('-'.repeat(60)));

  // Check if user interrupted
  if (result.signal === 'SIGINT') {
    p.log.warn('Planning session interrupted');
  }

  // Check if PRD was created
  const s = p.spinner();
  s.start('Checking if PRD was created in Notion...');

  const prdStatus = await checkTicketHasPrd(ticketId, cwd);

  if (prdStatus.hasPrd && prdStatus.prdPageId) {
    s.stop('PRD found!');

    // Update session with PRD info
    updateSessionPrd(cwd, {
      prdPageId: prdStatus.prdPageId,
      prdContent: '', // Will be fetched when needed by run/loop
      totalTasks: undefined,
    });

    p.log.success('PRD created in Notion!');
    p.note(
      'The PRD has been saved as a child page under the ticket.\n' +
        'Run `sonata run` to start implementing the PRD.',
      'Next Steps'
    );
    p.outro(chalk.green('Planning session finished'));
  } else {
    s.stop('No PRD found in Notion');

    // Offer retry options
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'retry', label: 'Relaunch OpenCode', hint: 'continue the planning session' },
        { value: 'manual', label: "I'll create it manually", hint: 'exit for now' },
        { value: 'done', label: "I didn't want to save yet", hint: 'exit, plan again later' },
      ],
    });

    if (action === 'retry') {
      // Relaunch planning session
      await runPlanningSession(options);
      return;
    }

    if (action === 'manual') {
      p.note(
        'You can create the PRD manually in Notion as a child page under the ticket.\n' +
          "Make sure to title it 'PRD' so sonata can find it.\n" +
          'Then run `sonata run` to start implementing.',
        'Manual PRD Creation'
      );
    } else {
      p.note(
        "Run `sonata plan` again when you're ready to continue.\n" +
          'OpenCode will remember the context from your previous session.',
        'Next Steps'
      );
    }

    p.outro(chalk.yellow('Planning session ended without PRD'));
  }
}

/**
 * Run local planning command - create spec in specs/ folder
 */
async function runLocalPlanCommand(options: PlanOptions): Promise<void> {
  const { cwd = process.cwd() } = options;

  p.intro(chalk.bgGreen.black(' sonata plan --local (specs folder) '));

  // Load config for defaults (loadConfig returns sensible defaults if no config file exists)
  const config = loadConfig();
  const specsFolder = config.local?.specsDir ?? 'specs';

  // Check prerequisites
  const s = p.spinner();
  s.start('Checking prerequisites...');

  const [hasOpenCode, inGitRepo] = await Promise.all([checkOpenCodeInstalled(), isGitRepo(cwd)]);

  s.stop('Prerequisites checked');

  if (!hasOpenCode) {
    p.cancel('opencode CLI not found. Please install it first.');
    process.exit(1);
  }

  // Ensure specs directory exists
  ensureSpecsDir(cwd, specsFolder);
  p.log.info(`Specs directory: ${specsDir(cwd, specsFolder)}`);

  // Get title for the spec
  const title = await p.text({
    message: 'What would you like to build?',
    placeholder: 'Add user authentication',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Title is required';
      }
      return;
    },
  });

  if (isCancelled(title)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const specTitle = String(title).trim();

  // Create git branch if needed
  let branch = '';
  if (inGitRepo && config?.git.createBranch) {
    const currentBranch = await getCurrentBranch(cwd);
    if (currentBranch === config.git.baseBranch) {
      const safeBranchName = specTitle
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-|-$/g, '')
        .slice(0, 50);
      branch = `task/${safeBranchName}`;

      s.start(`Creating branch ${branch}...`);
      await createBranch(branch, config.git.baseBranch, cwd);
      s.stop(`Switched to branch ${branch}`);
    } else {
      branch = currentBranch;
      p.log.info(`Working on branch: ${branch}`);
    }
  }

  // Show planning session info
  p.note(
    `Title: ${specTitle}\n` +
      `Specs folder: ${specsFolder}/\n\n` +
      "OpenCode will help you create a spec. Here's the flow:\n\n" +
      '1. AI explores codebase and asks questions\n' +
      '2. AI proposes a spec, you give feedback\n' +
      `3. When satisfied, say: ${chalk.cyan('"Approve"')} or ${chalk.cyan('"Save the spec"')}\n` +
      `4. AI creates the spec file in ${specsFolder}/\n` +
      `5. Exit OpenCode (${chalk.dim('Ctrl+C')} or type ${chalk.dim('/quit')})\n\n` +
      chalk.yellow('Tip: Use Tab to switch to Plan mode for discussion-only.'),
    'Local Planning Session'
  );

  const confirm = await p.confirm({
    message: 'Launch OpenCode for planning?',
    initialValue: true,
  });

  if (isCancelled(confirm) || confirm !== true) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  // Build the local planning prompt
  const prompt = buildLocalPlanningPrompt({
    title: specTitle,
    specsDir: specsFolder,
    cwd,
  });

  console.log();
  console.log(chalk.cyan('Launching OpenCode TUI...'));
  console.log(chalk.dim('(Exit with Ctrl+C or /quit when done)'));
  console.log();

  // Spawn OpenCode TUI with the prompt
  const result = spawnOpenCodeTui(prompt, { cwd });

  console.log();
  console.log(chalk.dim('-'.repeat(60)));

  // Check if user interrupted
  if (result.signal === 'SIGINT') {
    p.log.warn('Planning session interrupted');
  }

  // Check if spec was created
  s.start('Checking if spec was created...');

  const specs = listSpecs(cwd);
  const newSpec = specs.find(
    (spec) =>
      spec.title.toLowerCase() === specTitle.toLowerCase() ||
      spec.id.includes(
        specTitle
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, '-')
          .replaceAll(/^-|-$/g, '')
      )
  );

  if (newSpec) {
    s.stop('Spec found!');

    p.log.success(`Spec created: ${newSpec.filepath}`);
    p.note(
      `The spec has been saved to ${newSpec.filepath}\n` +
        'Run `sonata run --local` to start implementing the spec.',
      'Next Steps'
    );
    p.outro(chalk.green('Planning session finished'));
  } else {
    s.stop('No new spec found');

    // Offer retry options
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'retry', label: 'Relaunch OpenCode', hint: 'continue the planning session' },
        { value: 'manual', label: "I'll create it manually", hint: 'exit for now' },
        { value: 'done', label: "I didn't want to save yet", hint: 'exit, plan again later' },
      ],
    });

    if (action === 'retry') {
      // Relaunch planning session (recursive call)
      await runLocalPlanCommand(options);
      return;
    }

    if (action === 'manual') {
      p.note(
        `You can create the spec manually in ${specsFolder}/\n` +
          'Use the format from templates/SPEC.example.md\n' +
          'Then run `sonata run --local` to start implementing.',
        'Manual Spec Creation'
      );
    } else {
      p.note("Run `sonata plan --local` again when you're ready to continue.", 'Next Steps');
    }

    p.outro(chalk.yellow('Planning session ended without spec'));
  }
}
