import * as p from '@clack/prompts';
import chalk from 'chalk';

import {
  getModel,
  setModel,
  getReasoningEffort,
  setReasoningEffort,
  getAvailableModels,
  type ReasoningEffort,
  type AvailableModel,
} from '../lib/opencode-config.js';

export interface ModelCommandOptions {
  cwd?: string;
  effort?: ReasoningEffort;
}

/**
 * Display current model and reasoning effort
 */
async function showCurrentModel(options: ModelCommandOptions): Promise<void> {
  const { cwd = process.cwd() } = options;

  const model = getModel(cwd);
  const effort = getReasoningEffort(cwd);

  p.intro(chalk.bgBlue.black(' sonata model '));

  console.log();
  console.log(chalk.bold('Current Configuration:'));
  console.log(`  Model: ${model ? chalk.green(model) : chalk.dim('Not set (using default)')}`);
  console.log(
    `  Reasoning Effort: ${effort ? chalk.green(effort) : chalk.dim('Not set (using default)')}`
  );
  console.log();

  p.outro('Use `sonata model set` to change the model');
}

/**
 * List available models, optionally filtered by provider
 */
async function listModels(provider?: string, options: ModelCommandOptions = {}): Promise<void> {
  const { cwd = process.cwd() } = options;

  p.intro(chalk.bgBlue.black(' sonata model list '));

  const spinner = p.spinner();
  spinner.start('Fetching available models...');

  let models: AvailableModel[];
  try {
    models = getAvailableModels();
  } catch (error) {
    spinner.stop('Failed to fetch models');
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(message);
    return;
  }

  // Filter by provider if specified
  if (provider) {
    models = models.filter((m) => m.provider.toLowerCase() === provider.toLowerCase());
    if (models.length === 0) {
      spinner.stop(`No models found for provider: ${provider}`);
      return;
    }
  }

  spinner.stop(`Found ${models.length} models`);

  // Group by provider for display
  const byProvider = new Map<string, AvailableModel[]>();
  for (const model of models) {
    const key = model.provider || 'other';
    if (!byProvider.has(key)) {
      byProvider.set(key, []);
    }
    byProvider.get(key)!.push(model);
  }

  // Show current model for reference
  const currentModel = getModel(cwd);
  if (currentModel) {
    console.log();
    console.log(chalk.dim(`Current model: ${currentModel}`));
  }

  console.log();

  // Display grouped models
  for (const [providerName, providerModels] of byProvider) {
    console.log(chalk.bold(`${providerName}:`));
    for (const model of providerModels) {
      const isCurrent = model.id === currentModel;
      const marker = isCurrent ? chalk.green('→') : ' ';
      console.log(`  ${marker} ${model.id}`);
    }
    console.log();
  }

  p.outro(`Use \`sonata model set <model>\` to set a model`);
}

/**
 * Set the model, either directly or via interactive picker
 */
async function setModelCommand(
  modelArg?: string,
  options: ModelCommandOptions = {}
): Promise<void> {
  const { cwd = process.cwd(), effort } = options;

  p.intro(chalk.bgBlue.black(' sonata model set '));

  let selectedModel: string;

  if (modelArg) {
    // Direct model specification
    selectedModel = modelArg;

    // Validate model exists
    const spinner = p.spinner();
    spinner.start('Validating model...');

    let models: AvailableModel[];
    try {
      models = getAvailableModels();
    } catch (error) {
      spinner.stop('Failed to fetch models');
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(message);
      return;
    }

    const modelExists = models.some((m) => m.id === selectedModel);
    if (!modelExists) {
      spinner.stop('Invalid model');

      // Find similar models for suggestions
      const suggestions = models
        .filter(
          (m) =>
            m.id.toLowerCase().includes(selectedModel.toLowerCase()) ||
            m.name.toLowerCase().includes(selectedModel.toLowerCase())
        )
        .slice(0, 5);

      p.log.error(`Model "${selectedModel}" not found.`);
      if (suggestions.length > 0) {
        console.log();
        console.log(chalk.dim('Did you mean one of these?'));
        for (const s of suggestions) {
          console.log(`  ${s.id}`);
        }
      }
      console.log();
      p.outro('Use `sonata model list` to see all available models');
      return;
    }

    spinner.stop('Model validated');
  } else {
    // Interactive mode with @inquirer/search
    const spinner = p.spinner();
    spinner.start('Fetching available models...');

    let models: AvailableModel[];
    try {
      models = getAvailableModels();
    } catch (error) {
      spinner.stop('Failed to fetch models');
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(message);
      return;
    }

    spinner.stop(`Found ${models.length} models`);

    // Import search dynamically to avoid issues if not installed
    const { default: search } = await import('@inquirer/search');

    const result = await search({
      message: 'Select a model:',
      source: async (term) => {
        if (!term) {
          // Show all models grouped by provider (limited for display)
          return models.slice(0, 50).map((m) => ({
            name: m.id,
            value: m.id,
            description: m.provider ? `Provider: ${m.provider}` : undefined,
          }));
        }

        // Filter by search term
        const filtered = models.filter(
          (m) =>
            m.id.toLowerCase().includes(term.toLowerCase()) ||
            m.name.toLowerCase().includes(term.toLowerCase()) ||
            m.provider.toLowerCase().includes(term.toLowerCase())
        );

        return filtered.map((m) => ({
          name: m.id,
          value: m.id,
          description: m.provider ? `Provider: ${m.provider}` : undefined,
        }));
      },
    });

    selectedModel = result;
  }

  // Set the model
  setModel(selectedModel, cwd);
  p.log.success(`Model set to: ${chalk.green(selectedModel)}`);

  // Set reasoning effort if specified
  if (effort) {
    setReasoningEffort(effort, cwd);
    p.log.success(`Reasoning effort set to: ${chalk.green(effort)}`);
  }

  p.outro('Configuration saved to opencode.json');
}

/**
 * Main model command handler
 */
export async function modelCommand(
  action?: string,
  arg?: string,
  options: ModelCommandOptions = {}
): Promise<void> {
  // Handle --effort flag without action (apply to current model)
  if (!action && options.effort) {
    const { cwd = process.cwd() } = options;
    setReasoningEffort(options.effort, cwd);
    p.intro(chalk.bgBlue.black(' sonata model '));
    p.log.success(`Reasoning effort set to: ${chalk.green(options.effort)}`);
    p.outro('Configuration saved to opencode.json');
    return;
  }

  switch (action) {
    case undefined: {
      await showCurrentModel(options);
      break;
    }
    case 'list': {
      await listModels(arg, options);
      break;
    }
    case 'set': {
      await setModelCommand(arg, options);
      break;
    }
    default: {
      // Treat unknown action as a model to set (convenience shorthand)
      await setModelCommand(action, options);
      break;
    }
  }
}
