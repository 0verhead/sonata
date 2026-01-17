import * as p from '@clack/prompts'
import chalk from 'chalk'

import { loadConfig, configExists } from '../lib/config.js'
import {
  isGitRepo,
  getCurrentBranch,
  createBranch,
  createPR,
  getCommitsSinceBase,
  generatePRBody,
  ticketMatchesBranch,
} from '../lib/git.js'
import { resolveMode, ModeResolutionError } from '../lib/mode.js'
import {
  fetchReadyTicketsViaMcp,
  fetchPrdContentViaMcp,
  updateTicketStatusViaMcp,
  type TicketInfo,
} from '../lib/notion-via-opencode.js'
import { isNotionMcpConfigured, configureNotionMcp } from '../lib/opencode-config.js'
import {
  runOpenCodeCli,
  buildImplementationPrompt,
  buildLocalImplementationPrompt,
  checkOpenCodeInstalled,
  killActiveProcess,
} from '../lib/opencode.js'
import {
  progressExists,
  initProgress,
  markProgressComplete,
  deleteProgress,
} from '../lib/progress.js'
import {
  loadCurrentSession,
  incrementIteration,
  updateSessionPrd,
  countPrdTasks,
  clearSession,
  initSession,
} from '../lib/session.js'
import { getSpec, getSpecsByStatus, updateSpecStatus, countSpecTasks } from '../lib/specs.js'
import { isCancelled } from '../types/index.js'

interface RunOptions {
  cwd?: string
  yes?: boolean
  ticketId?: string
  local?: boolean // Use local specs mode
  notion?: boolean // Use Notion mode
}

/**
 * Run command - implement one PRD task
 *
 * True Ralph pattern:
 * - Only works on tickets that have a completed PRD
 * - AI autonomously implements tasks from the PRD
 * - One task per iteration, AI chooses priority
 */
export async function runCommand(options: RunOptions = {}): Promise<void> {
  const { cwd = process.cwd(), yes = false, ticketId: directTicketId, local, notion } = options

  // Load config (may not exist for local-only mode)
  const config = configExists() ? loadConfig() : null

  // Resolve mode
  let mode: 'local' | 'notion'
  try {
    if (local) {
      mode = 'local'
    } else if (notion) {
      mode = 'notion'
    } else if (config) {
      mode = resolveMode({ local, notion }, config, cwd)
    } else {
      // No config, check if specs folder exists
      mode = 'local' // Default to local if no config
    }
  } catch (error) {
    if (error instanceof ModeResolutionError) {
      p.cancel(error.message)
      process.exit(1)
    }
    throw error
  }

  // Branch to local or Notion workflow
  if (mode === 'local') {
    await runLocalCommand({ ...options, cwd, yes })
    return
  }

  // Notion mode - original workflow
  p.intro(chalk.bgBlue.white(' sonata run '))

  // Check if Notion is configured
  if (!config) {
    p.cancel('No configuration found. Run `sonata setup` first.')
    process.exit(1)
  }

  if (!config.notion.boardId) {
    p.cancel('Notion board not configured. Run `sonata setup` first.')
    process.exit(1)
  }

  // Check prerequisites
  const s = p.spinner()
  s.start('Checking prerequisites...')

  const [hasOpenCode, inGitRepo] = await Promise.all([checkOpenCodeInstalled(), isGitRepo(cwd)])

  s.stop('Prerequisites checked')

  if (!hasOpenCode) {
    p.cancel('opencode CLI not found. Please install it first.')
    process.exit(1)
  }

  // Auto-configure opencode.json if needed
  if (!isNotionMcpConfigured(cwd)) {
    s.start('Configuring opencode.json for this project...')
    configureNotionMcp(cwd)
    s.stop('Created opencode.json with Notion MCP')
  }

  // Check for existing session with PRD
  let session = loadCurrentSession(cwd)
  let prdContent = session?.prdContent ?? null

  // Handle --ticket flag: bypass selection and use specific ticket
  if (directTicketId && (!session || session.ticketId !== directTicketId)) {
    p.log.info(`Using ticket: ${directTicketId}`)

    s.start('Fetching PRD for ticket...')
    const prd = await fetchPrdContentViaMcp(directTicketId, cwd)
    s.stop(prd ? 'PRD fetched' : 'No PRD found')

    if (!prd) {
      p.cancel('Ticket has no PRD. Run `sonata plan --ticket <id>` first.')
      process.exit(1)
    }

    // Get current branch
    let branch = ''
    if (inGitRepo) {
      branch = await getCurrentBranch(cwd)
    }

    // Initialize session for this ticket
    initSession(cwd, {
      ticketId: directTicketId,
      ticketTitle: prd.title || 'Direct ticket',
      ticketUrl: `https://notion.so/${directTicketId.replaceAll('-', '')}`,
      branch,
    })

    const tasks = countPrdTasks(prd.content)
    updateSessionPrd(cwd, {
      prdPageId: prd.pageId,
      prdContent: prd.content,
      totalTasks: tasks.total,
    })

    session = loadCurrentSession(cwd)
    prdContent = prd.content

    p.log.success('Session initialized with PRD')
  }

  if (session) {
    // TRUE RALPH PATTERN: Always fetch PRD fresh each iteration
    // Don't use cached prdContent - it could be stale or garbage
    p.log.info(`Continuing session: ${session.ticketTitle}`)
    p.log.info(`Branch: ${session.branch}`)
    p.log.info(`Iterations: ${session.iteration}`)

    s.start('Fetching PRD content (fresh)...')
    const prd = await fetchPrdContentViaMcp(session.ticketId, cwd)
    s.stop(prd ? 'PRD fetched' : 'No PRD found')

    if (prd) {
      const tasks = countPrdTasks(prd.content)
      updateSessionPrd(cwd, {
        prdPageId: prd.pageId,
        prdContent: prd.content,
        totalTasks: tasks.total,
      })
      prdContent = prd.content
      session = loadCurrentSession(cwd)

      if (session?.totalTasks && session.completedTasks !== undefined) {
        p.log.info(`Progress: ${session.completedTasks}/${session.totalTasks} tasks`)
      }
    } else {
      p.note(
        "This ticket doesn't have a PRD yet.\n" + 'Run `sonata plan` to create one first.',
        'No PRD Found'
      )
      p.outro('Create a PRD with `sonata plan`')
      return
    }
  } else {
    // No session - need to select a ticket with PRD
    // Fetch both "Planned" and "In Progress" tickets (to allow resuming)
    s.start('Fetching tickets with PRDs...')

    let readyTickets: TicketInfo[]
    try {
      readyTickets = await fetchReadyTicketsViaMcp(
        config.notion.boardId!,
        config.notion.statusColumn,
        cwd,
        true, // Include "In Progress" tickets for resume capability
        config.notion.viewId
      )
    } catch (error) {
      s.stop('Failed to fetch tickets')
      p.log.error(`Error: ${error}`)
      killActiveProcess()
      process.exit(1)
    }

    s.stop(`Found ${readyTickets.length} tickets with PRDs`)

    if (readyTickets.length === 0) {
      p.note(
        'No tickets have PRDs yet.\n' + 'Run `sonata plan` to create a PRD for a ticket first.',
        'No Ready Tickets'
      )
      p.outro('Create a PRD with `sonata plan`')
      return
    }

    // Check if current branch matches any ticket (auto-detect)
    let selectedTicket: TicketInfo | undefined
    if (inGitRepo) {
      const currentBranch = await getCurrentBranch(cwd)
      const matchingTicket = readyTickets.find((t) => ticketMatchesBranch(t.title, currentBranch))

      if (matchingTicket) {
        const useMatch = await p.confirm({
          message: `Found matching ticket for branch "${currentBranch}":\n  ${matchingTicket.title}\n\nResume this ticket?`,
          initialValue: true,
        })

        if (isCancelled(useMatch)) {
          p.cancel('Cancelled')
          process.exit(0)
        }

        if (useMatch) {
          selectedTicket = matchingTicket
          p.log.info(`Resuming: ${selectedTicket.title}`)
        }
      }
    }

    // If no auto-detected ticket, let user select
    if (!selectedTicket) {
      // Sort: In Progress first (for resume), then Planned (new work)
      const sortedTickets = readyTickets.toSorted((a, b) => {
        const aInProgress = a.status === config.notion.statusColumn.inProgress
        const bInProgress = b.status === config.notion.statusColumn.inProgress
        if (aInProgress && !bInProgress) return -1
        if (bInProgress && !aInProgress) return 1
        return 0
      })

      // Create options with labels indicating resume vs new
      const ticketOptions = sortedTickets.map((t) => {
        const isInProgress = t.status === config.notion.statusColumn.inProgress
        return {
          value: t.id,
          label: isInProgress ? `[RESUME] ${t.title}` : `[NEW] ${t.title}`,
          hint: 'Has PRD',
        }
      })

      const selectedTicketId = await p.select({
        message: 'Select a ticket to implement:',
        options: ticketOptions,
      })

      if (isCancelled(selectedTicketId)) {
        p.cancel('Cancelled')
        process.exit(0)
      }

      selectedTicket = readyTickets.find((t) => t.id === selectedTicketId)
    }

    if (!selectedTicket) {
      p.cancel('Ticket not found')
      process.exit(1)
    }

    // Fetch the PRD content
    s.start('Fetching PRD content...')
    const prd = await fetchPrdContentViaMcp(selectedTicket.id, cwd)
    s.stop(prd ? 'PRD fetched' : 'Failed to fetch PRD')

    if (!prd) {
      p.cancel('Could not fetch PRD content from Notion')
      process.exit(1)
    }

    prdContent = prd.content

    // Create git branch if needed
    let branch = ''
    if (inGitRepo && config.git.createBranch) {
      const currentBranch = await getCurrentBranch(cwd)
      if (currentBranch === config.git.baseBranch) {
        const safeBranchName = selectedTicket.title
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, '-')
          .replaceAll(/^-|-$/g, '')
          .slice(0, 50)
        branch = `task/${safeBranchName}`

        s.start(`Creating branch ${branch}...`)
        await createBranch(branch, config.git.baseBranch, cwd)
        s.stop(`Switched to branch ${branch}`)
      } else {
        branch = currentBranch
      }
    }

    // Initialize session with PRD
    const tasks = countPrdTasks(prd.content)
    initSession(cwd, {
      ticketId: selectedTicket.id,
      ticketTitle: selectedTicket.title,
      ticketUrl: selectedTicket.url,
      branch,
    })

    updateSessionPrd(cwd, {
      prdPageId: prd.pageId,
      prdContent: prd.content,
      totalTasks: tasks.total,
    })

    session = loadCurrentSession(cwd)

    // Update ticket status to "In Progress"
    await updateTicketStatusViaMcp(
      selectedTicket.id,
      config.notion.statusColumn.inProgress,
      'Status',
      cwd
    )

    p.log.success('Session initialized with PRD')
  }

  // At this point we have a session with PRD content
  if (!session || !prdContent) {
    p.cancel('Session setup failed')
    process.exit(1)
  }

  // Initialize progress file if needed
  if (!progressExists(cwd)) {
    initProgress(cwd, `PRD: ${session.ticketTitle}`)
    p.log.info('Initialized progress.txt')
  }

  // Increment iteration
  const iteration = incrementIteration(cwd)

  // Build the implementation prompt
  const prompt = buildImplementationPrompt({
    ticketTitle: session.ticketTitle,
    ticketUrl: session.ticketUrl,
    prdContent,
    prdPageId: session.prdPageId,
    progressFile: 'progress.txt',
  })

  // Show what we're about to do
  p.note(
    `Ticket: ${session.ticketTitle}\n` +
      `PRD tasks: ${session.totalTasks ?? '?'}\n` +
      `Iteration: ${iteration}`,
    'Implementing PRD'
  )

  // Confirm before running (skip if --yes flag)
  if (!yes) {
    const proceed = await p.confirm({
      message: 'Ready to implement one task?',
      initialValue: true,
    })

    if (isCancelled(proceed) || proceed !== true) {
      p.cancel('Cancelled')
      process.exit(0)
    }
  }

  // Run opencode
  console.log()
  console.log(chalk.dim('-'.repeat(60)))
  console.log(chalk.cyan('opencode output:'))
  console.log(chalk.dim('-'.repeat(60)))
  console.log()

  const result = await runOpenCodeCli(prompt, { cwd })

  console.log()
  console.log(chalk.dim('-'.repeat(60)))
  console.log()

  // Handle result
  if (!result.success) {
    p.log.error(`opencode failed: ${result.error}`)
    killActiveProcess()
    process.exit(1)
  }

  if (result.isComplete) {
    p.log.success('All PRD tasks complete!')
    markProgressComplete(cwd)

    // Update ticket status to "Done"
    await updateTicketStatusViaMcp(session.ticketId, config.notion.statusColumn.done, 'Status', cwd)

    // Create PR if configured
    if (inGitRepo && config.git.createPR) {
      const currentBranch = await getCurrentBranch(cwd)
      if (currentBranch !== config.git.baseBranch) {
        const commits = await getCommitsSinceBase(config.git.baseBranch, cwd)
        const prTitle = session.ticketTitle
        const prBody = generatePRBody(commits, session.ticketTitle)

        let shouldCreatePR: boolean | symbol = true

        if (!yes) {
          shouldCreatePR = await p.confirm({
            message: `Create PR: "${prTitle}"?`,
            initialValue: true,
          })

          if (isCancelled(shouldCreatePR)) {
            p.cancel('Cancelled')
            process.exit(0)
          }
        }

        if (shouldCreatePR === true) {
          s.start(`Creating PR: "${prTitle}"...`)
          try {
            const prUrl = await createPR(prTitle, prBody, config.git.baseBranch, cwd)
            s.stop(`PR created: ${prUrl}`)
          } catch (error) {
            s.stop('Failed to create PR')
            p.log.error(String(error))
          }
        }
      }
    }

    // Clear session and progress file
    clearSession(cwd)
    deleteProgress(cwd)
  } else {
    p.log.info('Task complete. Spec not yet finished.')
    p.note(
      'Run `sonata run` again to continue, or\n' + '`sonata loop` for autonomous mode.',
      'Next Steps'
    )
  }

  // Ensure cleanup
  killActiveProcess()

  p.outro(
    result.isComplete ? chalk.green('All done!') : chalk.blue(`Iteration ${iteration} complete`)
  )
}

/**
 * Run local command - implement one spec step from specs/ folder
 */
async function runLocalCommand(options: RunOptions): Promise<void> {
  const { cwd = process.cwd(), yes = false } = options

  p.intro(chalk.bgGreen.white(' sonata run --local '))

  // Load config for defaults (loadConfig() returns sensible defaults if no config file exists)
  const config = loadConfig()

  // Check prerequisites
  const s = p.spinner()
  s.start('Checking prerequisites...')

  const [hasOpenCode, inGitRepo] = await Promise.all([checkOpenCodeInstalled(), isGitRepo(cwd)])

  s.stop('Prerequisites checked')

  if (!hasOpenCode) {
    p.cancel('opencode CLI not found. Please install it first.')
    process.exit(1)
  }

  // Get available specs (todo + in-progress)
  const todoSpecs = getSpecsByStatus(cwd, 'todo')
  const inProgressSpecs = getSpecsByStatus(cwd, 'in-progress')
  const availableSpecs = [...inProgressSpecs, ...todoSpecs]

  if (availableSpecs.length === 0) {
    p.note(
      'No specs found in todo or in-progress status.\n' +
        'Run `sonata plan --local` to create a spec first.',
      'No Ready Specs'
    )
    p.outro('Create a spec with `sonata plan --local`')
    return
  }

  // Let user select a spec (prioritize in-progress)
  const specOptions = availableSpecs.map((spec) => ({
    value: spec.id,
    label: spec.status === 'in-progress' ? `[IN PROGRESS] ${spec.title}` : `[TODO] ${spec.title}`,
    hint: spec.priority ? `Priority: ${spec.priority}` : undefined,
  }))

  const selectedSpecId = await p.select({
    message: 'Select a spec to implement:',
    options: specOptions,
  })

  if (isCancelled(selectedSpecId)) {
    p.cancel('Cancelled')
    process.exit(0)
  }

  const selectedSpec = getSpec(cwd, String(selectedSpecId))
  if (!selectedSpec) {
    p.cancel('Spec not found')
    process.exit(1)
  }

  // Create git branch if needed
  let branch = ''
  if (inGitRepo && config.git.createBranch) {
    const currentBranch = await getCurrentBranch(cwd)
    if (currentBranch === config.git.baseBranch) {
      const safeBranchName = selectedSpec.title
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-|-$/g, '')
        .slice(0, 50)
      branch = `task/${safeBranchName}`

      s.start(`Creating branch ${branch}...`)
      await createBranch(branch, config.git.baseBranch, cwd)
      s.stop(`Switched to branch ${branch}`)
    } else {
      branch = currentBranch
    }
  }

  // Initialize or update session
  initSession(cwd, {
    ticketId: selectedSpec.id,
    ticketTitle: selectedSpec.title,
    ticketUrl: selectedSpec.filepath,
    branch,
  })

  // Update spec status to in-progress if it was todo
  if (selectedSpec.status === 'todo') {
    updateSpecStatus(cwd, selectedSpec.id, 'in-progress')
    p.log.info('Spec status updated to in-progress')
  }

  // Initialize progress file if needed
  if (!progressExists(cwd)) {
    initProgress(cwd, `Spec: ${selectedSpec.title}`)
    p.log.info('Initialized progress.txt')
  }

  // Increment iteration
  const iteration = incrementIteration(cwd)

  // Build the implementation prompt
  const prompt = buildLocalImplementationPrompt({
    specTitle: selectedSpec.title,
    specContent: selectedSpec.content,
    specFilepath: selectedSpec.filepath,
    progressFile: 'progress.txt',
  })

  // Get task counts
  const tasks = countSpecTasks(selectedSpec.content)

  // Show what we're about to do
  p.note(
    `Spec: ${selectedSpec.title}\n` +
      `File: ${selectedSpec.filepath}\n` +
      `Tasks: ${tasks.completed}/${tasks.total} complete\n` +
      `Iteration: ${iteration}`,
    'Implementing Spec'
  )

  // Confirm before running (skip if --yes flag)
  if (!yes) {
    const proceed = await p.confirm({
      message: 'Ready to implement one task?',
      initialValue: true,
    })

    if (isCancelled(proceed) || proceed !== true) {
      p.cancel('Cancelled')
      process.exit(0)
    }
  }

  // Run opencode
  console.log()
  console.log(chalk.dim('-'.repeat(60)))
  console.log(chalk.cyan('opencode output:'))
  console.log(chalk.dim('-'.repeat(60)))
  console.log()

  const result = await runOpenCodeCli(prompt, { cwd })

  console.log()
  console.log(chalk.dim('-'.repeat(60)))
  console.log()

  // Handle result
  if (!result.success) {
    p.log.error(`opencode failed: ${result.error}`)
    killActiveProcess()
    process.exit(1)
  }

  if (result.isComplete) {
    p.log.success('All spec tasks complete!')
    markProgressComplete(cwd)

    // Update spec status to done
    updateSpecStatus(cwd, selectedSpec.id, 'done')
    p.log.info('Spec status updated to done')

    // Create PR if configured
    if (inGitRepo && config.git.createPR) {
      const currentBranch = await getCurrentBranch(cwd)
      if (currentBranch !== config.git.baseBranch) {
        const commits = await getCommitsSinceBase(config.git.baseBranch, cwd)
        const prTitle = selectedSpec.title
        const prBody = generatePRBody(commits, selectedSpec.title)

        let shouldCreatePR: boolean | symbol = true

        if (!yes) {
          shouldCreatePR = await p.confirm({
            message: `Create PR: "${prTitle}"?`,
            initialValue: true,
          })

          if (isCancelled(shouldCreatePR)) {
            p.cancel('Cancelled')
            process.exit(0)
          }
        }

        if (shouldCreatePR === true) {
          s.start(`Creating PR: "${prTitle}"...`)
          try {
            const prUrl = await createPR(prTitle, prBody, config.git.baseBranch, cwd)
            s.stop(`PR created: ${prUrl}`)
          } catch (error) {
            s.stop('Failed to create PR')
            p.log.error(String(error))
          }
        }
      }
    }

    // Clear session and progress file
    clearSession(cwd)
    deleteProgress(cwd)
  } else {
    p.log.info('Task complete. Spec not yet finished.')
    p.note(
      'Run `sonata run --local` again to continue, or\n' +
        '`sonata loop --local` for autonomous mode.',
      'Next Steps'
    )
  }

  // Ensure cleanup
  killActiveProcess()

  p.outro(
    result.isComplete ? chalk.green('All done!') : chalk.blue(`Iteration ${iteration} complete`)
  )
}
