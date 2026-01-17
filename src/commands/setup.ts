import * as p from '@clack/prompts';
import chalk from 'chalk';

import { loadConfig, saveConfig, configExists, defaultConfig } from '../lib/config.js';
import { checkGhInstalled, checkGhAuthenticated, isGitRepo } from '../lib/git.js';
import { configureNotionMcp, isNotionMcpConfigured } from '../lib/opencode-config.js';
import { checkOpenCodeInstalled } from '../lib/opencode.js';
import { type Config, isNonEmptyString, isBoolean, isCancelled } from '../types/index.js';

export async function setupCommand(): Promise<void> {
  p.intro(chalk.bgCyan.black(' sonata setup '));

  // Check prerequisites
  const s = p.spinner();
  s.start('Checking prerequisites...');

  const [hasOpenCode, hasGh, inGitRepo] = await Promise.all([
    checkOpenCodeInstalled(),
    checkGhInstalled(),
    isGitRepo(),
  ]);

  // Check gh auth only if gh is installed
  const ghAuthenticated = hasGh ? await checkGhAuthenticated() : false;

  s.stop('Prerequisites checked');

  // Show status
  console.log();
  console.log(
    `  ${hasOpenCode ? chalk.green('✓') : chalk.red('✗')} opencode CLI ${
      hasOpenCode ? 'installed' : 'not found'
    }`
  );
  console.log(
    `  ${hasGh ? chalk.green('✓') : chalk.red('✗')} GitHub CLI (gh) ${
      hasGh ? 'installed' : 'not found'
    }`
  );
  if (hasGh) {
    console.log(
      `  ${ghAuthenticated ? chalk.green('✓') : chalk.red('✗')} GitHub CLI ${
        ghAuthenticated ? 'authenticated' : 'not authenticated'
      }`
    );
  }
  console.log(
    `  ${inGitRepo ? chalk.green('✓') : chalk.yellow('!')} ${
      inGitRepo ? 'In a git repository' : 'Not in a git repository'
    }`
  );
  console.log();

  if (!hasOpenCode) {
    p.note(
      'Install opencode from https://opencode.ai\nRun: npm install -g @anthropic-ai/opencode',
      'Missing: opencode'
    );
  }

  if (!hasGh) {
    p.note(
      'Install GitHub CLI from https://cli.github.com\nRequired for creating PRs',
      'Missing: gh'
    );
  } else if (!ghAuthenticated) {
    p.note(
      `To authenticate with GitHub, run:

  gh auth login

This is a one-time setup to connect GitHub CLI to your account.`,
      'GitHub Authentication'
    );
  }

  // Load existing config or use defaults
  const existingConfig = configExists() ? loadConfig() : defaultConfig;

  // Notion configuration
  p.log.step('Notion Configuration');

  const useNotion = await p.confirm({
    message: 'Connect to Notion kanban board?',
    initialValue: true,
  });

  if (isCancelled(useNotion)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  let boardId: string | undefined;
  let viewId: string | undefined;
  let boardName: string | undefined;

  if (useNotion === true) {
    p.note(
      'Your Notion board URL looks like:\n' +
        'https://notion.so/workspace/62b46288e10f4c4abc4bd271e17ad796?v=256a0340...\n\n' +
        'The board ID is: 62b46288e10f4c4abc4bd271e17ad796\n' +
        'The view ID is: 256a0340... (after ?v=)',
      'Notion URL Format'
    );

    const boardIdResult = await p.text({
      message: 'Notion board/database ID (from the URL):',
      placeholder: '62b46288e10f4c4abc4bd271e17ad796',
      initialValue: existingConfig.notion.boardId ?? '',
      validate: (value) => {
        if (!value) return 'Board ID is required';
        return;
      },
    });

    if (isCancelled(boardIdResult)) {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    if (isNonEmptyString(boardIdResult)) {
      boardId = boardIdResult;
    }

    const viewIdResult = await p.text({
      message: 'View ID (optional, from ?v= in URL):',
      placeholder: '256a03406f158055834a000c9c73da80',
      initialValue: existingConfig.notion.viewId ?? '',
    });

    if (isCancelled(viewIdResult)) {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    if (isNonEmptyString(viewIdResult)) {
      viewId = viewIdResult;
    }

    const boardNameResult = await p.text({
      message: 'Board name (for display):',
      placeholder: 'Sprint Tasks',
      initialValue: existingConfig.notion.boardName ?? '',
    });

    if (isCancelled(boardNameResult)) {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    if (isNonEmptyString(boardNameResult)) {
      boardName = boardNameResult;
    }
  }

  // Status columns configuration
  let statusColumns = { ...existingConfig.notion.statusColumn };

  if (useNotion === true) {
    p.log.step('Status Column Names');
    p.note('Configure the column names in your Notion kanban board', 'Status Columns');

    const todoResult = await p.text({
      message: 'Column for "To Do" tasks:',
      initialValue: statusColumns.todo,
    });

    if (isCancelled(todoResult)) {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    const inProgressResult = await p.text({
      message: 'Column for "In Progress" tasks:',
      initialValue: statusColumns.inProgress,
    });

    if (isCancelled(inProgressResult)) {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    const doneResult = await p.text({
      message: 'Column for "Done" tasks:',
      initialValue: statusColumns.done,
    });

    if (isCancelled(doneResult)) {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    statusColumns = {
      todo: isNonEmptyString(todoResult) ? todoResult : statusColumns.todo,
      inProgress: isNonEmptyString(inProgressResult) ? inProgressResult : statusColumns.inProgress,
      done: isNonEmptyString(doneResult) ? doneResult : statusColumns.done,
    };
  }

  // Git configuration
  p.log.step('Git Configuration');

  const createBranchResult = await p.confirm({
    message: 'Create a new branch for each task?',
    initialValue: existingConfig.git.createBranch,
  });

  if (isCancelled(createBranchResult)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  const createPRResult = await p.confirm({
    message: 'Create a PR when task is complete?',
    initialValue: existingConfig.git.createPR,
  });

  if (isCancelled(createPRResult)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  const baseBranchResult = await p.text({
    message: 'Base branch for new branches/PRs:',
    initialValue: existingConfig.git.baseBranch,
  });

  if (isCancelled(baseBranchResult)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  // Loop configuration
  p.log.step('Loop Configuration');

  const maxIterationsResult = await p.text({
    message: 'Default max iterations for AFK mode:',
    initialValue: String(existingConfig.loop.maxIterations),
    validate: (value) => {
      const num = Number.parseInt(value, 10);
      if (Number.isNaN(num) || num < 1) return 'Must be a positive number';
      return;
    },
  });

  if (isCancelled(maxIterationsResult)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  // Mode configuration
  p.log.step('Mode Configuration');

  p.note(
    'sonata supports two modes:\n' +
      '- local: Store specs in a local specs/ folder\n' +
      '- notion: Use Notion kanban board for tasks\n\n' +
      'You can also use --local or --notion flags to override.',
    'Mode Selection'
  );

  const modeResult = await p.select({
    message: 'Default mode (or auto-detect):',
    options: [
      { value: 'auto', label: 'Auto-detect', hint: "Detect based on what's available" },
      { value: 'local', label: 'Local', hint: 'Use specs/ folder' },
      { value: 'notion', label: 'Notion', hint: 'Use Notion board' },
    ],
    initialValue: existingConfig.mode ?? 'auto',
  });

  if (isCancelled(modeResult)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  const selectedMode = modeResult === 'auto' ? undefined : (modeResult as 'local' | 'notion');

  // Local specs directory (only ask if local mode or auto)
  let specsDirectory = existingConfig.local?.specsDir ?? 'specs';
  if (selectedMode === 'local' || selectedMode === undefined) {
    const specsDirResult = await p.text({
      message: 'Specs directory (relative to project root):',
      initialValue: specsDirectory,
    });

    if (isCancelled(specsDirResult)) {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    if (isNonEmptyString(specsDirResult)) {
      specsDirectory = specsDirResult;
    }
  }

  // Build final config with validated values
  const config: Config = {
    mode: selectedMode,
    notion: {
      boardId,
      viewId,
      boardName,
      statusColumn: statusColumns,
    },
    local: {
      specsDir: specsDirectory,
    },
    git: {
      createBranch: isBoolean(createBranchResult) ? createBranchResult : true,
      createPR: isBoolean(createPRResult) ? createPRResult : true,
      baseBranch: isNonEmptyString(baseBranchResult) ? baseBranchResult : 'main',
    },
    loop: {
      maxIterations: isNonEmptyString(maxIterationsResult)
        ? Number.parseInt(maxIterationsResult, 10)
        : 10,
    },
  };

  // Save config (zod validation happens inside saveConfig)
  saveConfig(config);

  // Show summary
  p.note(
    `Mode: ${config.mode ?? 'auto-detect'}
Specs Directory: ${config.local?.specsDir ?? 'specs'}
Notion Board: ${config.notion.boardName ?? 'Not configured'}
Status Columns: ${statusColumns.todo} → ${statusColumns.inProgress} → ${statusColumns.done}
Create Branches: ${config.git.createBranch ? 'Yes' : 'No'}
Create PRs: ${config.git.createPR ? 'Yes' : 'No'}
Base Branch: ${config.git.baseBranch}
Max Iterations: ${config.loop.maxIterations}`,
    'Configuration saved'
  );

  // Configure Notion MCP in opencode.json
  if (useNotion === true) {
    const alreadyConfigured = isNotionMcpConfigured();

    if (alreadyConfigured) {
      p.log.info('Notion MCP already configured in opencode.json');
    } else {
      const setupMcp = await p.confirm({
        message: 'Configure Notion MCP in opencode.json?',
        initialValue: true,
      });

      if (!isCancelled(setupMcp) && setupMcp === true) {
        s.start('Configuring opencode.json...');
        const result = configureNotionMcp();
        s.stop(result.created ? `Created ${result.path}` : `Updated ${result.path}`);
      }
    }

    // Remind about authentication
    p.note(
      `To authenticate with Notion, run:

  opencode mcp auth notion

This will open a browser to connect your Notion workspace.`,
      'Notion Authentication'
    );
  }

  p.outro(chalk.green('Setup complete! Run `sonata run` to start.'));
}
