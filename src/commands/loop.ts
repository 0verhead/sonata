import * as p from '@clack/prompts';
import chalk from 'chalk';

import { loadConfig, configExists } from '../lib/config.js';
import {
  isGitRepo,
  getCurrentBranch,
  createBranch,
  createPR,
  ticketMatchesBranch,
  stageAll,
  commit,
  hasChanges,
  switchBranch,
} from '../lib/git.js';
import { resolveMode, ModeResolutionError } from '../lib/mode.js';
import {
  fetchReadyTicketsViaMcp,
  fetchPrdContentViaMcp,
  updateTicketStatusViaMcp,
  type TicketInfo,
} from '../lib/notion-via-opencode.js';
import { isNotionMcpConfigured, configureNotionMcp } from '../lib/opencode-config.js';
import {
  runOpenCodeCli,
  buildImplementationPrompt,
  buildLocalImplementationPrompt,
  checkOpenCodeInstalled,
  killActiveProcess,
} from '../lib/opencode.js';
import {
  progressExists,
  initProgress,
  getCurrentIteration,
  markProgressComplete,
  deleteProgress,
  appendHumanFeedback,
} from '../lib/progress.js';
import {
  loadCurrentSession,
  incrementIteration,
  updateSessionPrd,
  countPrdTasks,
  clearSession,
  initSession,
} from '../lib/session.js';
import {
  getSpec,
  getSpecsByStatus,
  updateSpecStatus,
  countSpecTasks,
  getNextSpec,
} from '../lib/specs.js';
import { isCancelled } from '../types/index.js';

interface LoopOptions {
  iterations?: number;
  cwd?: string;
  hitl?: boolean;
  ticketId?: string;
  local?: boolean; // Use local specs mode
  notion?: boolean; // Use Notion mode
  auto?: boolean; // Skip initial spec selection (use smart ranking)
}

/**
 * Loop command - implement multiple PRD tasks autonomously
 *
 * True Ralph pattern:
 * - Only works on tickets that have a completed PRD
 * - Executes multiple iterations autonomously up to a max limit
 * - One task per iteration
 */
export async function loopCommand(options: LoopOptions = {}): Promise<void> {
  const { local, notion } = options;

  // Load config (may not exist for local-only mode)
  const configData = configExists() ? loadConfig() : null;
  const defaultIterations = configData?.loop.maxIterations ?? 10;

  const {
    iterations = defaultIterations,
    cwd = process.cwd(),
    hitl = false,
    ticketId: directTicketId,
  } = options;

  // Resolve mode
  let resolvedMode: 'local' | 'notion';
  try {
    if (local) {
      resolvedMode = 'local';
    } else if (notion) {
      resolvedMode = 'notion';
    } else if (configData) {
      resolvedMode = resolveMode({ local, notion }, configData, cwd);
    } else {
      // No config, default to local
      resolvedMode = 'local';
    }
  } catch (error) {
    if (error instanceof ModeResolutionError) {
      p.cancel(error.message);
      process.exit(1);
    }
    throw error;
  }

  // Branch to local or Notion workflow
  if (resolvedMode === 'local') {
    await runLocalLoopCommand({ ...options, cwd, iterations, hitl, auto: options.auto });
    return;
  }

  // Notion mode - original workflow
  const config = configData!;
  const modeLabel = hitl ? 'HITL' : 'AFK';
  p.intro(chalk.bgMagenta.white(` sonata loop (${modeLabel} mode, max ${iterations} iterations) `));

  // Check if Notion is configured
  if (!configExists()) {
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

  // Check for existing session with PRD, or select a new ticket
  let session = loadCurrentSession(cwd);
  let prdContent = session?.prdContent ?? null;

  // Handle --ticket flag: bypass selection and use specific ticket
  if (directTicketId && (!session || session.ticketId !== directTicketId)) {
    p.log.info(`Using ticket: ${directTicketId}`);

    s.start('Fetching PRD for ticket...');
    const prd = await fetchPrdContentViaMcp(directTicketId, cwd);
    s.stop(prd ? 'PRD fetched' : 'No PRD found');

    if (!prd) {
      p.cancel('Ticket has no PRD. Run `sonata plan --ticket <id>` first.');
      process.exit(1);
    }

    // Get current branch
    let branch = '';
    if (inGitRepo) {
      branch = await getCurrentBranch(cwd);
    }

    // Initialize session for this ticket
    initSession(cwd, {
      ticketId: directTicketId,
      ticketTitle: prd.title || 'Direct ticket',
      ticketUrl: `https://notion.so/${directTicketId.replaceAll('-', '')}`,
      branch,
    });

    const tasks = countPrdTasks(prd.content);
    updateSessionPrd(cwd, {
      prdPageId: prd.pageId,
      prdContent: prd.content,
      totalTasks: tasks.total,
    });

    session = loadCurrentSession(cwd);
    prdContent = prd.content;

    p.log.success('Session initialized with PRD');
  }

  if (session) {
    // TRUE RALPH PATTERN: Always fetch PRD fresh each iteration
    // Don't use cached prdContent - it could be stale or garbage
    p.log.info(`Continuing session: ${session.ticketTitle}`);
    p.log.info(`Branch: ${session.branch}`);

    s.start('Fetching PRD content (fresh)...');
    const prd = await fetchPrdContentViaMcp(session.ticketId, cwd);
    s.stop(prd ? 'PRD fetched' : 'No PRD found');

    if (prd) {
      const tasks = countPrdTasks(prd.content);
      updateSessionPrd(cwd, {
        prdPageId: prd.pageId,
        prdContent: prd.content,
        totalTasks: tasks.total,
      });
      prdContent = prd.content;
      session = loadCurrentSession(cwd);
    } else {
      p.note(
        "This ticket doesn't have a PRD yet.\n" + 'Run `sonata plan` to create one first.',
        'No PRD Found'
      );
      p.outro('Create a PRD with `sonata plan`');
      return;
    }
  } else {
    // No session - need to select a ticket with PRD
    // Fetch both "Planned" and "In Progress" tickets (to allow resuming)
    s.start('Fetching tickets with PRDs...');

    let readyTickets: TicketInfo[];
    try {
      readyTickets = await fetchReadyTicketsViaMcp(
        config.notion.boardId!,
        config.notion.statusColumn,
        cwd,
        true, // Include "In Progress" tickets for resume capability
        config.notion.viewId
      );
    } catch (error) {
      s.stop('Failed to fetch tickets');
      p.log.error(`Error: ${error}`);
      killActiveProcess();
      process.exit(1);
    }

    s.stop(`Found ${readyTickets.length} tickets with PRDs`);

    if (readyTickets.length === 0) {
      p.note(
        'No tickets have PRDs yet.\n' + 'Run `sonata plan` to create a PRD for a ticket first.',
        'No Ready Tickets'
      );
      p.outro('Create a PRD with `sonata plan`');
      return;
    }

    // Check if current branch matches any ticket (auto-detect)
    let selectedTicket: TicketInfo | undefined;
    if (inGitRepo) {
      const currentBranch = await getCurrentBranch(cwd);
      const matchingTicket = readyTickets.find((t) => ticketMatchesBranch(t.title, currentBranch));

      if (matchingTicket) {
        const useMatch = await p.confirm({
          message: `Found matching ticket for branch "${currentBranch}":\n  ${matchingTicket.title}\n\nResume this ticket?`,
          initialValue: true,
        });

        if (isCancelled(useMatch)) {
          p.cancel('Cancelled');
          process.exit(0);
        }

        if (useMatch) {
          selectedTicket = matchingTicket;
          p.log.info(`Resuming: ${selectedTicket.title}`);
        }
      }
    }

    // If no auto-detected ticket, let user select
    if (!selectedTicket) {
      // Sort: In Progress first (for resume), then Planned (new work)
      const sortedTickets = readyTickets.toSorted((a, b) => {
        const aInProgress = a.status === config.notion.statusColumn.inProgress;
        const bInProgress = b.status === config.notion.statusColumn.inProgress;
        if (aInProgress && !bInProgress) return -1;
        if (bInProgress && !aInProgress) return 1;
        return 0;
      });

      // Create options with labels indicating resume vs new
      const ticketOptions = sortedTickets.map((t) => {
        const isInProgress = t.status === config.notion.statusColumn.inProgress;
        return {
          value: t.id,
          label: isInProgress ? `[RESUME] ${t.title}` : `[NEW] ${t.title}`,
          hint: 'Has PRD',
        };
      });

      const selectedTicketId = await p.select({
        message: 'Select a ticket to implement:',
        options: ticketOptions,
      });

      if (isCancelled(selectedTicketId)) {
        p.cancel('Cancelled');
        process.exit(0);
      }

      selectedTicket = readyTickets.find((t) => t.id === selectedTicketId);
    }

    if (!selectedTicket) {
      p.cancel('Ticket not found');
      process.exit(1);
    }

    // Fetch the PRD content
    s.start('Fetching PRD content...');
    const prd = await fetchPrdContentViaMcp(selectedTicket.id, cwd);
    s.stop(prd ? 'PRD fetched' : 'Failed to fetch PRD');

    if (!prd) {
      p.cancel('Could not fetch PRD content from Notion');
      process.exit(1);
    }

    prdContent = prd.content;

    // Create git branch if needed
    let branch = '';
    if (inGitRepo && config.git.createBranch) {
      const currentBranch = await getCurrentBranch(cwd);
      if (currentBranch === config.git.baseBranch) {
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
      }
    }

    // Initialize session with PRD
    const tasks = countPrdTasks(prd.content);
    initSession(cwd, {
      ticketId: selectedTicket.id,
      ticketTitle: selectedTicket.title,
      ticketUrl: selectedTicket.url,
      branch,
    });

    updateSessionPrd(cwd, {
      prdPageId: prd.pageId,
      prdContent: prd.content,
      totalTasks: tasks.total,
    });

    session = loadCurrentSession(cwd);

    // Update ticket status to "In Progress"
    await updateTicketStatusViaMcp(
      selectedTicket.id,
      config.notion.statusColumn.inProgress,
      'Status',
      cwd
    );

    p.log.success('Session initialized with PRD');
  }

  if (!session || !prdContent) {
    p.cancel('Session setup failed');
    process.exit(1);
  }

  // Initialize progress if needed
  const startIteration = getCurrentIteration(cwd);
  if (!progressExists(cwd)) {
    initProgress(cwd, `PRD: ${session.ticketTitle}`);
    p.log.info('Initialized progress.txt');
  }

  // Confirm before starting AFK mode
  if (!hitl) {
    p.note(
      `Ticket: ${session.ticketTitle}\n` +
        `PRD tasks: ${session.totalTasks ?? '?'}\n` +
        `Max iterations: ${iterations}\n` +
        `Branch: ${session.branch || 'N/A'}\n\n` +
        'The loop will run autonomously until:\n' +
        '- All PRD tasks are complete (AI outputs completion signal)\n' +
        '- Max iterations reached\n' +
        '- An error occurs',
      'AFK Mode'
    );

    const confirm = await p.confirm({
      message: 'Start the Ralph loop?',
      initialValue: true,
    });

    if (isCancelled(confirm) || confirm !== true) {
      p.cancel('Cancelled');
      process.exit(0);
    }
  }

  // The Ralph Loop
  console.log();
  p.log.step(chalk.bold('Starting Ralph loop...'));
  console.log();

  for (let i = 1; i <= iterations; i++) {
    // Refresh session in case PRD was updated
    session = loadCurrentSession(cwd);
    prdContent = session?.prdContent ?? prdContent;

    const currentIteration = startIteration + i;

    console.log(chalk.cyan(`\n${'='.repeat(60)}`));
    console.log(chalk.cyan.bold(`  Iteration ${i}/${iterations} (total: ${currentIteration})`));
    console.log(chalk.cyan(`${'='.repeat(60)}\n`));

    // HITL mode: confirm before each iteration
    if (hitl && i > 1) {
      const continueLoop = await p.confirm({
        message: 'Continue to next iteration?',
        initialValue: true,
      });

      if (isCancelled(continueLoop) || continueLoop !== true) {
        p.log.info('Loop paused by user');
        break;
      }
    }

    // Build implementation prompt
    const prompt = buildImplementationPrompt({
      ticketTitle: session!.ticketTitle,
      ticketUrl: session!.ticketUrl,
      prdContent: prdContent!,
      prdPageId: session!.prdPageId,
      progressFile: 'progress.txt',
    });

    // Run opencode
    incrementIteration(cwd);
    const result = await runOpenCodeCli(prompt, { cwd });

    console.log();

    // Check for errors
    if (!result.success) {
      p.log.error(`opencode failed: ${result.error}`);
      p.log.info(`Stopped at iteration ${i}`);
      break;
    }

    // Check for awaiting human (manual testing checkpoint)
    if (result.awaitingHuman) {
      console.log();
      p.log.warn(chalk.yellow.bold('Agent is awaiting human action'));
      p.log.message(chalk.dim(`Checkpoint: ${result.awaitingHuman.description}`));
      console.log();

      const feedback = await p.text({
        message: 'Enter feedback (or press Enter to continue with no feedback):',
        placeholder: 'e.g., "Tested successfully, formatting preserved"',
      });

      if (isCancelled(feedback)) {
        p.log.info('Loop paused by user');
        break;
      }

      // Record feedback in progress file for next iteration
      const feedbackText =
        typeof feedback === 'string' && feedback.trim()
          ? feedback.trim()
          : 'Acknowledged, continue.';
      appendHumanFeedback(result.awaitingHuman.description, feedbackText, cwd);

      p.log.info('Feedback recorded, continuing to next iteration...');
      continue; // Don't count this as a completed iteration - the task isn't done yet
    }

    // Check for completion
    if (result.isComplete) {
      console.log();
      p.log.success(chalk.green.bold('All PRD tasks complete!'));
      markProgressComplete(cwd);

      // Update ticket status to "Done"
      await updateTicketStatusViaMcp(
        session!.ticketId,
        config.notion.statusColumn.done,
        'Status',
        cwd
      );

      // Create PR
      if (inGitRepo && config.git.createPR && session!.branch !== config.git.baseBranch) {
        s.start('Creating pull request...');
        try {
          const prTitle = session!.ticketTitle;
          const prUrl = await createPR(
            prTitle,
            `Completed via sonata Ralph loop\n\nIterations: ${i}\nSee progress.txt for details.`,
            config.git.baseBranch,
            cwd
          );
          s.stop(`PR created: ${prUrl}`);
          await switchBranch(config.git.baseBranch, cwd);
          p.log.info(`Switched back to ${config.git.baseBranch}`);
        } catch (error) {
          s.stop('Failed to create PR');
          p.log.warn(`Could not create PR: ${error}`);
        }
      }

      // Clear session and progress
      clearSession(cwd);
      deleteProgress(cwd);

      // Ensure cleanup before exit
      killActiveProcess();

      p.outro(chalk.green(`Completed in ${i} iteration${i === 1 ? '' : 's'}!`));
      return;
    }

    p.log.info(`Iteration ${i} complete, continuing...`);
  }

  // Max iterations reached
  console.log();
  p.log.warn(`Max iterations (${iterations}) reached`);
  p.note(
    'The PRD is not yet complete. You can:\n' +
      '- Run `sonata loop` again to continue\n' +
      '- Run `sonata run` for manual control\n' +
      '- Check progress.txt for current state',
    'Max Iterations Reached'
  );

  // Ensure cleanup
  killActiveProcess();

  p.outro(chalk.yellow(`Stopped after ${iterations} iterations`));
}

/**
 * Run local loop command - implement multiple spec steps autonomously
 *
 * After completing a spec and creating a PR, automatically selects the next
 * spec using the ranking algorithm and continues the loop.
 *
 * With --auto flag, skips the initial spec selection prompt and uses
 * smart ranking to pick the best spec to work on.
 */
async function runLocalLoopCommand(
  options: LoopOptions & { iterations: number; auto?: boolean }
): Promise<void> {
  const { iterations, cwd = process.cwd(), hitl = false, auto = false } = options;

  // Load config for defaults (loadConfig returns sensible defaults if no config file exists)
  const config = loadConfig();

  const modeLabel = hitl ? 'HITL' : 'AFK';
  p.intro(
    chalk.bgGreen.white(` sonata loop --local (${modeLabel} mode, max ${iterations} iterations) `)
  );

  // Check prerequisites
  const s = p.spinner();
  s.start('Checking prerequisites...');

  const [hasOpenCode, inGitRepo] = await Promise.all([checkOpenCodeInstalled(), isGitRepo(cwd)]);

  s.stop('Prerequisites checked');

  if (!hasOpenCode) {
    p.cancel('opencode CLI not found. Please install it first.');
    process.exit(1);
  }

  // Get available specs (todo + in-progress)
  const todoSpecs = getSpecsByStatus(cwd, 'todo');
  const inProgressSpecs = getSpecsByStatus(cwd, 'in-progress');
  const availableSpecs = [...inProgressSpecs, ...todoSpecs];

  if (availableSpecs.length === 0) {
    p.note(
      'No specs found in todo or in-progress status.\n' +
        'Run `sonata plan --local` to create a spec first.',
      'No Ready Specs'
    );
    p.outro('Create a spec with `sonata plan --local`');
    return;
  }

  // Select spec: use smart ranking with --auto, otherwise let user choose
  let selectedSpec: NonNullable<ReturnType<typeof getSpec>>;

  if (auto) {
    // Use smart ranking to automatically select the best spec
    const rankedSpec = getNextSpec(cwd);
    if (!rankedSpec) {
      p.note(
        'No actionable specs found.\n' + 'Run `sonata plan --local` to create a spec first.',
        'No Ready Specs'
      );
      p.outro('Create a spec with `sonata plan --local`');
      return;
    }
    selectedSpec = rankedSpec;
    p.log.info(`Auto-selected spec: ${selectedSpec.title}`);
  } else {
    // Let user select a spec (prioritize in-progress)
    const specOptions = availableSpecs.map((spec) => ({
      value: spec.id,
      label: spec.status === 'in-progress' ? `[IN PROGRESS] ${spec.title}` : `[TODO] ${spec.title}`,
      hint: spec.priority ? `Priority: ${spec.priority}` : undefined,
    }));

    const selectedSpecId = await p.select({
      message: 'Select a spec to implement:',
      options: specOptions,
    });

    if (isCancelled(selectedSpecId)) {
      p.cancel('Cancelled');
      process.exit(0);
    }

    const spec = getSpec(cwd, String(selectedSpecId));
    if (!spec) {
      p.cancel('Spec not found');
      process.exit(1);
    }
    selectedSpec = spec;
  }

  // Confirm before starting AFK mode
  if (!hitl) {
    const tasks = countSpecTasks(selectedSpec.content);
    p.note(
      `Spec: ${selectedSpec.title}\n` +
        `Tasks: ${tasks.completed}/${tasks.total} complete\n` +
        `Max iterations: ${iterations}\n\n` +
        'The loop will run autonomously until:\n' +
        '- All specs are complete\n' +
        '- Max iterations reached\n' +
        '- An error occurs\n\n' +
        'After completing a spec, the next spec will be selected automatically.',
      'AFK Mode'
    );

    const confirm = await p.confirm({
      message: 'Start the Ralph loop?',
      initialValue: true,
    });

    if (isCancelled(confirm) || confirm !== true) {
      p.cancel('Cancelled');
      process.exit(0);
    }
  }

  // Run the spec loop
  // This loop iterates over specs, not iterations. It exits when:
  // - Max iterations across all specs is reached
  // - No more specs to work on
  // - An error occurs
  const result = await runSpecLoop({
    initialSpec: selectedSpec,
    iterations,
    cwd,
    hitl,
    inGitRepo,
    config,
    spinner: s,
  });

  // Handle final state
  switch (result.reason) {
    case 'all_specs_complete': {
      p.outro(chalk.green(`All specs complete! Total iterations: ${result.totalIterations}`));
      break;
    }
    case 'max_iterations': {
      console.log();
      p.log.warn(`Max iterations (${iterations}) reached`);
      p.note(
        'The spec is not yet complete. You can:\n' +
          '- Run `sonata loop --local` again to continue\n' +
          '- Run `sonata run --local` for manual control\n' +
          '- Check progress.txt for current state',
        'Max Iterations Reached'
      );
      p.outro(chalk.yellow(`Stopped after ${result.totalIterations} iterations`));
      break;
    }
    case 'error': {
      p.outro(chalk.red(`Stopped due to error after ${result.totalIterations} iterations`));
      break;
    }
    case 'user_cancelled': {
      p.outro(chalk.yellow(`Loop paused by user after ${result.totalIterations} iterations`));
      break;
    }
  }
}

interface SpecLoopOptions {
  initialSpec: NonNullable<ReturnType<typeof getSpec>>;
  iterations: number;
  cwd: string;
  hitl: boolean;
  inGitRepo: boolean;
  config: ReturnType<typeof loadConfig>;
  spinner: ReturnType<typeof p.spinner>;
}

interface SpecLoopResult {
  reason: 'all_specs_complete' | 'max_iterations' | 'error' | 'user_cancelled';
  totalIterations: number;
}

/**
 * Run the spec loop - processes specs one at a time, continuing to next spec after completion
 */
async function runSpecLoop(options: SpecLoopOptions): Promise<SpecLoopResult> {
  const { iterations, cwd, hitl, inGitRepo, config, spinner: s } = options;
  let selectedSpec = options.initialSpec;

  // Track total iterations across all specs
  let totalIterationsUsed = 0;

  // Outer loop: iterate over specs
  while (totalIterationsUsed < iterations) {
    // Create git branch if needed (for new spec)
    let branch = '';
    if (inGitRepo && config.git.createBranch) {
      const currentBranch = await getCurrentBranch(cwd);
      if (currentBranch === config.git.baseBranch) {
        const safeBranchName = selectedSpec.title
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
      }
    }

    // Initialize session for this spec
    initSession(cwd, {
      ticketId: selectedSpec.id,
      ticketTitle: selectedSpec.title,
      ticketUrl: selectedSpec.filepath,
      branch,
    });
    p.log.info(`Session initialized for: ${selectedSpec.title}`);

    // Update spec status to in-progress if it was todo
    if (selectedSpec.status === 'todo') {
      updateSpecStatus(cwd, selectedSpec.id, 'in-progress');
      selectedSpec = getSpec(cwd, selectedSpec.id)!;
    }

    // Initialize progress if needed
    if (!progressExists(cwd)) {
      initProgress(cwd, `Spec: ${selectedSpec.title}`);
      p.log.info('Initialized progress.txt');
    }

    // The Ralph Loop for this spec
    console.log();
    p.log.step(chalk.bold(`Starting Ralph loop for: ${selectedSpec.title}`));
    console.log();

    const remainingIterations = iterations - totalIterationsUsed;
    let specCompleted = false;
    let loopError = false;
    let userCancelled = false;

    for (let i = 1; i <= remainingIterations; i++) {
      // Refresh spec to get latest content
      selectedSpec = getSpec(cwd, selectedSpec.id)!;
      const tasks = countSpecTasks(selectedSpec.content);

      totalIterationsUsed++;

      console.log(chalk.cyan(`\n${'='.repeat(60)}`));
      console.log(chalk.cyan.bold(`  Iteration ${totalIterationsUsed}/${iterations} (spec: ${i})`));
      console.log(chalk.cyan(`  Spec: ${selectedSpec.title} (${tasks.completed}/${tasks.total})`));
      console.log(chalk.cyan(`${'='.repeat(60)}\n`));

      // HITL mode: confirm before each iteration
      if (hitl && (totalIterationsUsed > 1 || i > 1)) {
        const continueLoop = await p.confirm({
          message: 'Continue to next iteration?',
          initialValue: true,
        });

        if (isCancelled(continueLoop) || continueLoop !== true) {
          p.log.info('Loop paused by user');
          userCancelled = true;
          break;
        }
      }

      // Build implementation prompt
      const prompt = buildLocalImplementationPrompt({
        specTitle: selectedSpec.title,
        specContent: selectedSpec.content,
        specFilepath: selectedSpec.filepath,
        progressFile: 'progress.txt',
      });

      // Run opencode
      incrementIteration(cwd);
      const result = await runOpenCodeCli(prompt, { cwd });

      console.log();

      // Check for errors
      if (!result.success) {
        p.log.error(`opencode failed: ${result.error}`);
        p.log.info(`Stopped at iteration ${totalIterationsUsed}`);
        loopError = true;
        break;
      }

      // Check for awaiting human (manual testing checkpoint)
      if (result.awaitingHuman) {
        console.log();
        p.log.warn(chalk.yellow.bold('Agent is awaiting human action'));
        p.log.message(chalk.dim(`Checkpoint: ${result.awaitingHuman.description}`));
        console.log();

        const feedback = await p.text({
          message: 'Enter feedback (or press Enter to continue with no feedback):',
          placeholder: 'e.g., "Tested successfully, formatting preserved"',
        });

        if (isCancelled(feedback)) {
          p.log.info('Loop paused by user');
          userCancelled = true;
          break;
        }

        // Record feedback in progress file for next iteration
        const feedbackText =
          typeof feedback === 'string' && feedback.trim()
            ? feedback.trim()
            : 'Acknowledged, continue.';
        appendHumanFeedback(result.awaitingHuman.description, feedbackText, cwd);

        p.log.info('Feedback recorded, continuing to next iteration...');
        // Don't count this as a completed iteration - decrement to retry
        totalIterationsUsed--;
        continue;
      }

      // Check for completion
      if (result.isComplete) {
        console.log();
        p.log.success(chalk.green.bold(`Spec complete: ${selectedSpec.title}`));
        markProgressComplete(cwd);

        // Update spec status to done
        updateSpecStatus(cwd, selectedSpec.id, 'done');

        // Commit the spec status change
        if (inGitRepo && (await hasChanges(cwd))) {
          await stageAll(cwd);
          await commit('docs: mark spec as done', cwd);
        }

        // Create PR
        if (inGitRepo && config.git.createPR && branch !== config.git.baseBranch) {
          s.start('Creating pull request...');
          try {
            const prTitle = selectedSpec.title;
            const prUrl = await createPR(
              prTitle,
              `Completed via sonata Ralph loop (local mode)\n\nIterations: ${i}\nSee progress.txt for details.`,
              config.git.baseBranch,
              cwd
            );
            s.stop(`PR created: ${prUrl}`);
            await switchBranch(config.git.baseBranch, cwd);
            p.log.info(`Switched back to ${config.git.baseBranch}`);
          } catch (error) {
            s.stop('Failed to create PR');
            p.log.warn(`Could not create PR: ${error}`);
          }
        }

        // Clear session and progress for this spec
        clearSession(cwd);
        deleteProgress(cwd);

        specCompleted = true;
        break;
      }

      p.log.info(`Iteration ${totalIterationsUsed} complete, continuing...`);
    }

    // If user cancelled or error occurred, exit the outer loop
    if (userCancelled) {
      killActiveProcess();
      return { reason: 'user_cancelled', totalIterations: totalIterationsUsed };
    }

    if (loopError) {
      killActiveProcess();
      return { reason: 'error', totalIterations: totalIterationsUsed };
    }

    // If spec was completed, try to get the next spec
    if (specCompleted) {
      const nextSpec = getNextSpec(cwd);

      if (!nextSpec) {
        // No more specs to work on
        p.log.success(chalk.green.bold('All actionable specs are complete!'));
        killActiveProcess();
        return { reason: 'all_specs_complete', totalIterations: totalIterationsUsed };
      }

      // Continue with the next spec - a new session and branch will be initialized
      // at the top of the while loop
      console.log();
      console.log(chalk.magenta(`\n${'─'.repeat(60)}`));
      p.log.step(chalk.magenta.bold(`Auto-selecting next spec: ${nextSpec.title}`));
      console.log(chalk.magenta(`${'─'.repeat(60)}\n`));
      selectedSpec = nextSpec;
      continue;
    }

    // If we get here, max iterations for this spec was reached without completion
    break;
  }

  // Max iterations reached
  killActiveProcess();
  return { reason: 'max_iterations', totalIterations: totalIterationsUsed };
}
