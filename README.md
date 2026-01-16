# notion-code

A CLI tool that implements the **Ralph loop** pattern using [OpenCode](https://opencode.ai) and Notion kanban boards.

## What is Ralph?

Ralph is a technique for autonomous AI coding. In its purest form, it's a loop:

```bash
while :; do cat PROMPT.md | opencode ; done
```

The key insight: **the agent chooses the task, not you**. You define the end state in a task file, and Ralph figures out how to get there.

This tool wraps that concept with:
- Beautiful CLI interface using [clack](https://github.com/bombshell-dev/clack)
- Notion kanban integration via MCP
- Git branch management and automatic PRs
- Progress tracking across iterations

Read more about Ralph:
- [Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)
- [11 Tips For AI Coding With Ralph Wiggum](https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum)

## Installation

```bash
npm install -g notion-code
```

Or run directly:

```bash
npx notion-code
```

### Prerequisites

- [OpenCode](https://opencode.ai) CLI installed
- [GitHub CLI](https://cli.github.com) (for creating PRs)
- Node.js 18+

## Quick Start

```bash
# 1. Setup (configure Notion, git settings)
notion-code setup

# 2. Create your task file
# Edit TASKS.md with your tasks

# 3. Run single iteration (HITL mode)
notion-code run

# 4. Or run autonomously (AFK mode)
notion-code loop 10
```

## Commands

### `notion-code setup`

Interactive configuration wizard. Configures:
- Notion board connection (via MCP OAuth)
- Status column names (To Do, In Progress, Done)
- Git settings (create branches, create PRs, base branch)
- Default max iterations for AFK mode

Config is stored in `~/.notion-code/config.json`.

### `notion-code run`

**HITL (Human-in-the-Loop) mode** - Run a single iteration.

```bash
notion-code run
notion-code run --task-file MY_TASKS.md
```

This is the safest way to use Ralph. You watch the output and can intervene if needed.

### `notion-code loop [iterations]`

**AFK (Away From Keyboard) mode** - Run multiple iterations autonomously.

```bash
notion-code loop          # Use default max iterations
notion-code loop 20       # Run up to 20 iterations
notion-code loop --hitl   # Pause after each iteration for confirmation
```

The loop continues until:
- All tasks complete (`<promise>COMPLETE</promise>` detected)
- Max iterations reached
- An error occurs

### `notion-code status`

Show current state: config, task file, progress, git status.

```bash
notion-code status
```

## How It Works

### The Ralph Loop

Each iteration:

1. **Read context** - Load `TASKS.md` and `progress.txt`
2. **Choose task** - Agent decides the highest priority task
3. **Implement** - Write code, run feedback loops (types, tests, lint)
4. **Track progress** - Append to `progress.txt`
5. **Commit** - Git commit the changes
6. **Check completion** - If all done, output `<promise>COMPLETE</promise>`

### Task File (TASKS.md)

Structure your task file for best results:

```markdown
# Tasks

## High Priority
- [ ] Critical bug fix: describe the issue
- [ ] Core feature: what needs to be built

## Medium Priority  
- [ ] Enhancement: improve existing feature

## Done
- [x] Completed task 1

---

## Context
Add any important context here for the AI.
```

### Progress Tracking

`progress.txt` persists context across iterations:

```
# Progress Log
# Started: 2025-01-16T10:00:00.000Z

---

## Iteration 1 - 2025-01-16T10:05:00.000Z
**Task:** Add user authentication
**Action:** Implemented login form component
**Notes:** Using existing auth library

---
```

### Git Workflow

When configured, notion-code will:
1. Create a new branch from base (e.g., `task/add-auth-abc123`)
2. Commit changes during iterations
3. Create a PR when the task is complete

## Notion Integration

### Setup

1. Add the Notion MCP server to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "notion": {
      "type": "remote",
      "url": "https://mcp.notion.com/mcp",
      "enabled": true
    }
  }
}
```

2. Authenticate:

```bash
opencode mcp auth notion
```

3. Run setup to configure your board:

```bash
notion-code setup
```

## Options

### Global Options

| Option | Description |
|--------|-------------|
| `-t, --task-file <file>` | Task file path (default: `TASKS.md`) |
| `-d, --dir <directory>` | Working directory |

### Loop Options

| Option | Description |
|--------|-------------|
| `--hitl` | Pause after each iteration for confirmation |

## Philosophy

The Ralph approach follows these principles:

1. **Small steps** - One feature per iteration
2. **Feedback loops** - Types, tests, linting as guardrails
3. **Progress tracking** - Document what was done
4. **Git commits** - Save progress after each change
5. **Clear stop condition** - `<promise>COMPLETE</promise>` when done

## Development

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Type check
npm run typecheck
```

## License

MIT
