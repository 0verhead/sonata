# notion-code

A CLI tool that implements the **Ralph loop** pattern for autonomous AI-powered coding, bridging [OpenCode](https://opencode.ai) with Notion kanban boards.

## What is Ralph?

Ralph is a technique for autonomous AI coding. In its purest form, it's a loop:

```bash
while :; do cat PROMPT.md | opencode ; done
```

The key insight: **the agent chooses the task, not you**. You define the end state in a task file, and Ralph figures out how to get there.

This tool wraps that concept with:
- Beautiful CLI interface using [clack](https://github.com/bombshell-dev/clack)
- Notion kanban integration via MCP (Model Context Protocol)
- Two-phase workflow: collaborative planning + autonomous execution
- Git branch management and automatic PRs
- Progress tracking across iterations
- Session state persistence

Read more about Ralph:
- [Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)
- [11 Tips For AI Coding With Ralph Wiggum](https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum)

## Architecture

```
notion-code/
├── src/
│   ├── index.ts              # CLI entry point (Commander.js)
│   ├── commands/             # CLI commands: setup, plan, run, loop, status
│   │   ├── setup.ts          # Interactive configuration wizard
│   │   ├── plan.ts           # PRD creation (Phase 1)
│   │   ├── run.ts            # Single iteration (HITL mode)
│   │   ├── loop.ts           # Multiple iterations (AFK mode)
│   │   └── status.ts         # Show current state
│   ├── lib/                  # Core utilities
│   │   ├── config.ts         # ~/.notion-code/config.json management
│   │   ├── session.ts        # .notion-code/session.json (per-project)
│   │   ├── progress.ts       # progress.txt tracking
│   │   ├── git.ts            # Git/GitHub operations
│   │   ├── opencode.ts       # OpenCode SDK integration
│   │   └── notion-via-opencode.ts  # Notion MCP integration
│   └── types/                # TypeScript types and Zod schemas
└── templates/                # Prompt templates
```

### Integration Flow

```
[Notion Board] <--MCP--> [OpenCode] <--SDK--> [notion-code CLI]
```

The tool doesn't call the Notion API directly. Instead:
1. OpenCode has a Notion MCP server configured (`https://mcp.notion.com/mcp`)
2. notion-code sends prompts to OpenCode asking it to use Notion tools
3. OpenCode executes MCP tools (`notion-fetch`, `notion-create-pages`, etc.)
4. notion-code parses the structured output

## Installation

### From npm (when published)

```bash
npm install -g notion-code
```

Or run directly:

```bash
npx notion-code
```

### From source

```bash
# Clone the repository
git clone https://github.com/0verhead/notion-code.git
cd notion-code

# Install dependencies
npm install

# Build the project
npm run build

# Link globally so you can use `notion-code` anywhere
npm link
```

After linking, you can use `notion-code` from any directory.

To unlink later:

```bash
npm unlink -g notion-code
```

### Prerequisites

- [OpenCode](https://opencode.ai) CLI installed
- [GitHub CLI](https://cli.github.com) (for creating PRs)
- Node.js 18+

## Quick Start

### With Notion (recommended)

```bash
# One-time global setup
notion-code setup          # Configure Notion board, git settings
opencode mcp auth notion   # Authenticate with Notion

# Then for any project:
cd ~/projects/my-project

# Phase 1: Create PRD collaboratively with AI
notion-code plan

# Phase 2: Implement the PRD
notion-code run            # One step at a time (HITL)
notion-code loop 10        # Or run autonomously (AFK)
```

### With local TASKS.md

```bash
# One-time setup (skip Notion)
notion-code setup

# Per project
cd ~/projects/my-project
notion-code run            # Creates TASKS.md template, you edit it
notion-code run            # Runs with your tasks
```

## Two-Phase Workflow

notion-code uses a **two-phase workflow** for safer, more effective AI coding:

| Phase | Command | Mode | Description |
|-------|---------|------|-------------|
| **Planning** | `plan` | Interactive | Human + AI collaboratively create a PRD |
| **Execution** | `run` | HITL | Implement one PRD step at a time |
| **Execution** | `loop` | AFK | Autonomous implementation until complete |

### Phase 1: Planning (`plan`)

The planning phase ensures the AI understands what to build before writing code:

1. Fetches tickets from Notion (status = "To Do")
2. You select a ticket to work on
3. Creates a git branch for the work
4. Launches OpenCode TUI for interactive PRD creation
5. AI fetches ticket details, explores codebase, asks clarifying questions
6. AI creates a PRD (Product Requirements Document) as a child page in Notion
7. You review and approve before any code changes

### Phase 2: Execution (`run` / `loop`)

Once the PRD is approved, the AI implements it step by step:

1. Loads PRD from Notion (or local session)
2. Reads `progress.txt` to understand what's been done
3. Chooses the highest-priority incomplete step
4. Implements the step (writes code)
5. Runs feedback loops (types, tests, lint)
6. Updates `progress.txt`
7. Commits changes
8. Repeats until all steps complete, then creates PR

## Commands

### `notion-code setup`

Interactive configuration wizard. Configures:
- Notion board connection (database ID, status columns)
- Git settings (create branches, create PRs, base branch)
- Default max iterations for AFK mode

Config is stored in `~/.notion-code/config.json`.

```bash
notion-code setup
```

### `notion-code plan`

**Phase 1: Collaborative Planning** - Create a PRD with AI assistance.

```bash
notion-code plan                    # Interactive ticket selection
notion-code plan --ticket abc123    # Specific ticket
notion-code plan -d ./my-project    # Different directory
```

This opens an interactive session where you and the AI collaborate to create a detailed implementation plan before any code is written.

### `notion-code run`

**HITL (Human-in-the-Loop) mode** - Run a single iteration.

```bash
notion-code run                     # Normal run
notion-code run -y                  # Skip confirmations
notion-code run --ticket abc123     # Specific ticket
notion-code run -d ./my-project     # Different directory
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
- All tasks complete (completion signal detected)
- Max iterations reached
- An error occurs

### `notion-code status`

Show comprehensive current state:
- Configuration status
- Active session info
- Task source (Notion/local file)
- Progress tracking
- Git status
- Prerequisites check

```bash
notion-code status
notion-code status -d ./my-project
```

## How It Works

### The Ralph Loop

Each iteration:

1. **Read context** - Load PRD/tasks and `progress.txt`
2. **Choose task** - Agent decides the highest priority incomplete step
3. **Implement** - Write code, run feedback loops (types, tests, lint)
4. **Track progress** - Append to `progress.txt`
5. **Commit** - Git commit the changes
6. **Check completion** - If all done, output completion signal

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

### Session Management

Session state is stored in `.notion-code/session.json` per project:
- Ticket ID being worked on
- Current branch
- Iteration count
- PRD content (cached)

This enables resuming work across CLI invocations and auto-detecting matching branches.

### Git Workflow

When configured, notion-code will:
1. Create a new branch from base (e.g., `task/add-auth-abc123`)
2. Commit changes during each iteration
3. Create a PR when all tasks are complete

## Notion Integration

Use a Notion kanban board as your task source.

### One-time Setup

```bash
# 1. Configure notion-code with your Notion board
notion-code setup
# - Select "Yes" to connect Notion
# - Enter your database ID (from the Notion board URL)
# - Configure status column names to match your board

# 2. Authenticate with Notion (only needed once)
opencode mcp auth notion
```

### Configuration

The tool stores Notion settings in `~/.notion-code/config.json`:

```json
{
  "notion": {
    "boardId": "abc123...",
    "boardName": "Sprint Tasks",
    "statusColumn": {
      "todo": "To Do",
      "inProgress": "In Progress",
      "done": "Done"
    }
  },
  "git": {
    "createBranch": true,
    "createPr": true,
    "baseBranch": "main"
  },
  "loop": {
    "maxIterations": 10
  }
}
```

### Per-project Usage

```bash
cd ~/projects/any-project
notion-code plan    # Create PRD from Notion ticket
notion-code run     # Implement PRD steps
```

The tool automatically:
1. Creates `opencode.json` with Notion MCP config (if missing)
2. Fetches tasks from your Notion board
3. Creates PRDs as child pages under tickets
4. Updates task status as work progresses (To Do → In Progress → Done)
5. Tracks progress locally in `progress.txt`
6. Creates branches and PRs per task

### Task Source Priority

| Scenario | What happens |
|----------|--------------|
| Notion configured, no `TASKS.md` | Uses Notion board |
| Only `TASKS.md` exists | Uses local file |
| Both available | Prompts you to choose |

## Options

### Command Options

| Command | Option | Description |
|---------|--------|-------------|
| All | `-d, --dir <dir>` | Working directory |
| `plan` | `--ticket <id>` | Specific Notion ticket ID |
| `run` | `-y, --yes` | Skip confirmations |
| `run` | `--ticket <id>` | Specific Notion ticket ID |
| `loop` | `--hitl` | Pause after each iteration |
| `loop` | `--ticket <id>` | Specific Notion ticket ID |

## Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript | Language (ES2022, ESM) |
| Commander.js | CLI argument parsing |
| @clack/prompts | Beautiful terminal UI |
| @opencode-ai/sdk | Programmatic OpenCode control |
| execa | Shell command execution |
| Zod | Runtime type validation |
| tsup | Fast ESBuild bundling |

## Philosophy

The Ralph approach follows these principles:

1. **Plan first** - Create a PRD before writing code
2. **Small steps** - One feature per iteration
3. **Feedback loops** - Types, tests, linting as guardrails
4. **Progress tracking** - Document what was done
5. **Git commits** - Save progress after each change
6. **Clear stop condition** - Completion signal when done

## Development

```bash
# Install dependencies
npm install

# Development mode (watch)
npm run dev

# Build
npm run build

# Type check
npm run typecheck
```

## License

MIT
