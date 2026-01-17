import * as fs from 'node:fs'
import path from 'node:path'

import * as p from '@clack/prompts'
import chalk from 'chalk'

import { loadConfig, configExists, getConfigPath } from '../lib/config.js'
import {
  isGitRepo,
  getCurrentBranch,
  hasChanges,
  getRemoteUrl,
  checkGhInstalled,
} from '../lib/git.js'
import { describeModeState } from '../lib/mode.js'
import {
  isNotionMcpConfigured,
  openCodeConfigExists,
  getOpenCodeConfigPath,
} from '../lib/opencode-config.js'
import { checkOpenCodeInstalled } from '../lib/opencode.js'
import { progressExists, readProgress, getCurrentIteration } from '../lib/progress.js'
import { loadCurrentSession, hasActiveSession, countPrdTasks } from '../lib/session.js'
import { specsExist, specsDir, getSpecStats, listSpecs } from '../lib/specs.js'

const DEFAULT_TASK_FILE = 'TASKS.md'

interface StatusOptions {
  taskFile?: string
  cwd?: string
  local?: boolean // Show local specs status
}

export async function statusCommand(options: StatusOptions = {}): Promise<void> {
  const { taskFile = DEFAULT_TASK_FILE, cwd = process.cwd() } = options

  p.intro(chalk.bgGreen.black(' sonata status '))

  // Config status
  console.log()
  console.log(chalk.bold('Configuration:'))
  if (configExists()) {
    const config = loadConfig()
    console.log(`  ${chalk.green('✓')} Config file: ${getConfigPath()}`)
    console.log(`    Mode: ${config.mode || 'auto-detect'}`)
    console.log(
      `    Notion board: ${config.notion.boardName || config.notion.boardId || 'Not configured'}`
    )
    console.log(`    Specs dir: ${config.local?.specsDir || 'specs'}`)
    console.log(`    Create branches: ${config.git.createBranch ? 'Yes' : 'No'}`)
    console.log(`    Create PRs: ${config.git.createPR ? 'Yes' : 'No'}`)
    console.log(`    Base branch: ${config.git.baseBranch}`)
    console.log(`    Max iterations: ${config.loop.maxIterations}`)
  } else {
    console.log(`  ${chalk.yellow('!')} No config found. Run \`sonata setup\``)
  }

  // Local Specs status
  console.log()
  console.log(chalk.bold('Local Specs (specs/):'))
  if (specsExist(cwd)) {
    const stats = getSpecStats(cwd)
    const specs = listSpecs(cwd)
    console.log(`  ${chalk.green('✓')} Specs folder: ${specsDir(cwd)}`)
    console.log(`    Total specs: ${stats.total}`)
    console.log(`    Todo: ${stats.todo}`)
    console.log(`    In Progress: ${stats.inProgress}`)
    console.log(`    Done: ${stats.done}`)

    // Show recent specs
    if (specs.length > 0) {
      console.log(`    Recent:`)
      for (const spec of specs.slice(0, 3)) {
        const statusIcon = spec.status === 'done' ? '✓' : spec.status === 'in-progress' ? '→' : '○'
        console.log(`      ${chalk.dim(statusIcon)} ${spec.title} [${spec.status}]`)
      }
    }
  } else {
    console.log(`  ${chalk.dim('-')} No specs/ folder found`)
    console.log(`    Run \`sonata plan --local\` to create a spec`)
  }

  // Active Session status (PRD-based workflow)
  console.log()
  console.log(chalk.bold('Active Session:'))
  if (hasActiveSession(cwd)) {
    const session = loadCurrentSession(cwd)
    if (session) {
      console.log(`  ${chalk.green('✓')} Working on: ${session.ticketTitle}`)
      console.log(`    Ticket ID: ${session.ticketId}`)
      console.log(`    URL: ${session.ticketUrl}`)
      console.log(`    Branch: ${session.branch || 'N/A'}`)
      console.log(`    Started: ${session.startedAt}`)
      console.log(`    Iterations: ${session.iteration}`)

      // PRD status
      if (session.prdContent) {
        const tasks = countPrdTasks(session.prdContent)
        console.log(
          `    ${chalk.cyan('PRD loaded:')} ${tasks.completed}/${tasks.total} tasks complete`
        )
        if (session.prdFetchedAt) {
          console.log(`    PRD fetched: ${session.prdFetchedAt}`)
        }
      } else {
        console.log(`    ${chalk.yellow('PRD:')} Not loaded (run \`sonata run\` to fetch)`)
      }
    }
  } else {
    console.log(`  ${chalk.dim('-')} No active session`)
    console.log(`    Run \`sonata plan\` to create a PRD for a ticket`)
    console.log(`    Run \`sonata run\` to start implementing a PRD`)
  }

  // Task source status
  console.log()
  console.log(chalk.bold('Task Source:'))
  const taskFilePath = path.join(cwd, taskFile)
  const hasTaskFile = fs.existsSync(taskFilePath)
  const hasNotionConfig = configExists() && Boolean(loadConfig().notion.boardId)

  if (hasNotionConfig) {
    const config = loadConfig()
    console.log(
      `  ${chalk.green('✓')} Notion board: ${config.notion.boardName ?? config.notion.boardId}`
    )
    console.log(
      `    Status columns: ${config.notion.statusColumn.todo} → ${config.notion.statusColumn.inProgress} → ${config.notion.statusColumn.done}`
    )
  }

  if (hasTaskFile) {
    const content = fs.readFileSync(taskFilePath, 'utf8')
    const lines = content.split('\n').length
    const todoMatches = content.match(/- \[ \]/g)
    const doneMatches = content.match(/- \[x\]/gi)
    console.log(`  ${chalk.green('✓')} Local file: ${taskFile} (${lines} lines)`)
    console.log(`    Pending: ${todoMatches?.length ?? 0} tasks`)
    console.log(`    Done: ${doneMatches?.length ?? 0} tasks`)
  }

  if (!hasNotionConfig && !hasTaskFile) {
    console.log(`  ${chalk.yellow('!')} No task source configured`)
    console.log(`    Run \`sonata setup\` for Notion, or \`sonata run\` to create ${taskFile}`)
  }

  // Progress status
  console.log()
  console.log(chalk.bold('Progress:'))
  if (progressExists(cwd)) {
    const iteration = getCurrentIteration(cwd)
    const content = readProgress(cwd)
    const isComplete = content.includes('ALL TASKS COMPLETE')
    console.log(`  ${chalk.green('✓')} progress.txt`)
    console.log(`    Iterations: ${iteration}`)
    console.log(`    Status: ${isComplete ? chalk.green('Complete') : chalk.blue('In progress')}`)

    // Show last few lines
    const lines = content.split('\n').filter((l) => l.trim())
    const lastLines = lines.slice(-5)
    if (lastLines.length > 0) {
      console.log(`    Recent:`)
      for (const line of lastLines) {
        console.log(`      ${chalk.dim(line.slice(0, 60))}`)
      }
    }
  } else {
    console.log(`  ${chalk.dim('-')} No progress.txt yet`)
  }

  // Git status
  console.log()
  console.log(chalk.bold('Git:'))
  const inGitRepo = await isGitRepo(cwd)
  if (inGitRepo) {
    const branch = await getCurrentBranch(cwd)
    const changes = await hasChanges(cwd)
    const remote = await getRemoteUrl(cwd)
    console.log(`  ${chalk.green('✓')} Git repository`)
    console.log(`    Branch: ${branch}`)
    console.log(`    Changes: ${changes ? chalk.yellow('Yes') : 'No'}`)
    console.log(`    Remote: ${remote || 'None'}`)
  } else {
    console.log(`  ${chalk.yellow('!')} Not a git repository`)
  }

  // OpenCode config status
  console.log()
  console.log(chalk.bold('OpenCode Config:'))
  if (openCodeConfigExists(cwd)) {
    const hasNotionMcp = isNotionMcpConfigured(cwd)
    console.log(`  ${chalk.green('✓')} ${getOpenCodeConfigPath(cwd)}`)
    console.log(
      `    Notion MCP: ${hasNotionMcp ? chalk.green('Configured') : chalk.yellow('Not configured')}`
    )
    if (hasNotionConfig && !hasNotionMcp) {
      console.log(chalk.yellow(`    Run \`sonata setup\` to configure Notion MCP`))
    }
  } else {
    console.log(`  ${chalk.dim('-')} opencode.json not found`)
    if (hasNotionConfig) {
      console.log(chalk.yellow(`    Run \`sonata setup\` to create it`))
    }
  }

  // Prerequisites
  console.log()
  console.log(chalk.bold('Prerequisites:'))
  const [hasOpenCode, hasGh] = await Promise.all([checkOpenCodeInstalled(), checkGhInstalled()])
  console.log(`  ${hasOpenCode ? chalk.green('✓') : chalk.red('✗')} opencode CLI`)
  console.log(`  ${hasGh ? chalk.green('✓') : chalk.red('✗')} GitHub CLI (gh)`)

  // Mode state
  console.log()
  console.log(chalk.bold('Mode State:'))
  if (configExists()) {
    const config = loadConfig()
    console.log(`  ${describeModeState(config, cwd).split('\n').join('\n  ')}`)
  } else if (specsExist(cwd)) {
    console.log(`  Local specs/ folder available (will use local mode)`)
  } else {
    console.log(`  No mode configured. Run \`sonata setup\` or create specs/ folder.`)
  }

  // Next steps
  console.log()
  console.log(chalk.bold('Workflow:'))
  console.log(`  ${chalk.bold('Notion mode:')}`)
  console.log(`  1. ${chalk.cyan('sonata plan')}         Create PRD for a ticket (collaborative)`)
  console.log(`  2. ${chalk.cyan('sonata run')}          Implement one PRD step`)
  console.log(`  3. ${chalk.cyan('sonata loop')}         Implement steps autonomously (AFK)`)
  console.log()
  console.log(`  ${chalk.bold('Local mode:')}`)
  console.log(`  1. ${chalk.cyan('sonata plan --local')}  Create spec in specs/ folder`)
  console.log(`  2. ${chalk.cyan('sonata run --local')}   Implement one spec step`)
  console.log(`  3. ${chalk.cyan('sonata loop --local')}  Implement steps autonomously (AFK)`)

  console.log()
  p.outro('Run `sonata plan` to start planning or `sonata run` to implement')
}
