import * as p from '@clack/prompts'
import chalk from 'chalk'

import {
  progressExists,
  deleteProgress,
  getProgressPath,
  getCurrentIteration,
} from '../lib/progress.js'

interface CleanOptions {
  cwd?: string
  yes?: boolean
}

export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  const { cwd = process.cwd(), yes = false } = options

  p.intro(chalk.bgYellow.black(' sonata clean '))

  // Check if progress file exists
  if (!progressExists(cwd)) {
    p.log.info('No progress.txt file found. Nothing to clean.')
    p.outro('Done')
    return
  }

  // Show current progress info
  const progressPath = getProgressPath(cwd)
  const iteration = getCurrentIteration(cwd)
  console.log()
  console.log(chalk.bold('Current progress file:'))
  console.log(`  Path: ${progressPath}`)
  console.log(`  Iterations: ${iteration}`)
  console.log()

  // Confirm deletion
  if (!yes) {
    const confirmed = await p.confirm({
      message: 'Delete progress.txt? This cannot be undone.',
      initialValue: false,
    })

    if (p.isCancel(confirmed) || !confirmed) {
      p.log.warn('Cancelled. Progress file was not deleted.')
      p.outro('Done')
      return
    }
  }

  // Delete the progress file
  deleteProgress(cwd)

  p.log.success('Progress file deleted successfully.')
  p.outro('Clean complete. Ready for a fresh start!')
}
