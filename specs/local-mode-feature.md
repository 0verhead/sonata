---
id: local-mode-feature
title: Local Mode Feature - specs/ folder for PRDs
status: done
priority: high
created: 2025-01-17T00:00:00Z
updated: 2025-01-17T00:00:00Z
---

## Summary

Add a local mode to notion-code where PRDs are stored as markdown files in a `specs/` folder instead of Notion. This follows the Ralph loop pattern where specs are local files that the AI reads and implements.

**References:**
- https://ghuntley.com/ralph/
- https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum

## Mode Resolution Logic

```
1. If --local flag → use local mode
2. If --notion flag → use Notion mode  
3. If config.mode is set → use that mode (no conflict check)
4. If config.mode NOT set AND both specs/ AND Notion exist → ERROR (require flag)
5. If only specs/ folder exists → use local mode
6. If only Notion configured → use Notion mode
7. Otherwise → prompt to run setup
```

## Spec File Format

Each spec is a single markdown file with YAML frontmatter:

```markdown
---
id: add-user-authentication
title: Add User Authentication  
status: todo
priority: high
created: 2025-01-17T10:00:00Z
updated: 2025-01-17T10:00:00Z
---

## Summary
Implement user authentication with login/logout functionality.

## Steps
- [ ] Create auth context and provider
- [ ] Build login form component
- [ ] Add API routes for auth
- [ ] Implement session management
- [ ] Add protected route wrapper

## Files
- src/contexts/AuthContext.tsx
- src/components/LoginForm.tsx
- src/api/auth.ts

## Acceptance Criteria
- Users can log in with email/password
- Sessions persist across page refreshes
- Protected routes redirect to login

## Definition of Done
All steps complete, tests passing, no TypeScript errors.
```

## Steps

### New Files to Create

- [x] **Create `src/types/specs.ts`** - Zod schemas for spec frontmatter and full spec
  ```typescript
  const SpecFrontmatterSchema = z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['todo', 'in-progress', 'done']),
    priority: z.enum(['high', 'medium', 'low']).optional(),
    created: z.string(),
    updated: z.string(),
  });

  const SpecSchema = z.object({
    ...frontmatter,
    content: z.string(),  // The markdown body (PRD)
    filepath: z.string(), // Full path to the file
  });
  ```

- [x] **Create `src/lib/specs.ts`** - Core library for spec management
  ```typescript
  // Functions:
  - specsDir(cwd: string): string                    // Returns specs/ path
  - specsExist(cwd: string): boolean                 // Check if specs/ folder exists
  - ensureSpecsDir(cwd: string): void                // Creates specs/ if needed
  - listSpecs(cwd: string): Spec[]                   // Lists all specs with parsed frontmatter
  - getSpec(cwd: string, id: string): Spec | null    // Get single spec by ID
  - getSpecsByStatus(cwd, status): Spec[]            // Filter by status
  - createSpec(cwd, data): Spec                      // Create new spec file
  - updateSpecStatus(cwd, id, status): void          // Update frontmatter status
  - updateSpecContent(cwd, id, content): void        // Update spec body
  - specFilename(title: string): string              // Generate slug filename from title
  ```

- [x] **Create `src/lib/mode.ts`** - Mode resolution logic
  ```typescript
  export function resolveMode(
    flags: { local?: boolean; notion?: boolean },
    config: Config,
    cwd: string
  ): 'local' | 'notion' {
    // 1. Explicit flags take priority
    if (flags.local) return 'local';
    if (flags.notion) return 'notion';
    
    // 2. Config default
    if (config.mode) return config.mode;
    
    // 3. Auto-detect with conflict check
    const hasSpecs = specsExist(cwd);
    const hasNotion = !!config.notion.boardId;
    
    if (hasSpecs && hasNotion) {
      throw new Error('Both specs/ and Notion configured. Use --local or --notion flag.');
    }
    
    if (hasSpecs) return 'local';
    if (hasNotion) return 'notion';
    
    throw new Error('No mode configured. Run `notion-code setup` first.');
  }
  ```

- [x] **Create `templates/SPEC.example.md`** - Example spec file template

### Files to Modify

- [x] **Update `src/types/index.ts`** - Add mode and local config to ConfigSchema
  ```typescript
  const ConfigSchema = z.object({
    mode: z.enum(['local', 'notion']).optional(),
    notion: z.object({ /* existing */ }),
    local: z.object({
      specsDir: z.string(),
    }).optional(),
    git: z.object({ /* existing */ }),
    loop: z.object({ /* existing */ }),
  });
  ```

- [x] **Update `src/lib/config.ts`** - Add defaults for local mode config
  ```typescript
  const defaultConfig: Config = {
    mode: undefined, // no default, auto-detect
    local: {
      specsDir: 'specs',
    },
    // ... existing
  };
  ```

- [x] **Update `src/lib/session.ts`** - Add local mode fields
  ```typescript
  interface Session {
    // ... existing fields
    isLocal?: boolean;        // true when using local specs
    specId?: string;          // ID from spec frontmatter
    specFilepath?: string;    // Path to spec file
  }
  ```

- [x] **Update `src/lib/opencode.ts`** - Add local prompt builders
  - `buildLocalPlanningPrompt(title, cwd)` - Prompt for creating spec file
  - `buildLocalImplementationPrompt(spec, progressFile)` - Prompt for implementing local spec

- [x] **Update `src/commands/plan.ts`** - Add --local flag
  - Add `local?: boolean` to PlanOptions
  - Branch to `runLocalPlanningSession()` when local mode
  - Local flow: prompt for title → launch OpenCode → AI writes spec to specs/

- [x] **Update `src/commands/run.ts`** - Add --local flag
  - Add `local?: boolean` to RunOptions
  - Branch to local workflow when local mode
  - Local flow: list specs by status → select → read content → implement → update status

- [x] **Update `src/commands/loop.ts`** - Add --local flag
  - Pass through to run command with local flag

- [x] **Update `src/commands/status.ts`** - Add --local flag
  - Show specs from specs/ folder with status counts

- [x] **Update `src/commands/setup.ts`** - Add mode configuration
  - Add prompt: "Default mode: [local] [notion]"
  - Save to config.mode

- [x] **Update `src/index.ts`** - Add CLI flags
  ```typescript
  program
    .command('plan')
    .option('--local', 'Use local specs/ folder instead of Notion')
    .option('--notion', 'Use Notion board')
    // ...

  program
    .command('run')
    .option('--local', 'Use local specs/ folder instead of Notion')
    .option('--notion', 'Use Notion board')
    // ...
  ```

## Files Affected

| File | Action | Description |
|------|--------|-------------|
| `src/types/specs.ts` | Create | Zod schemas for spec frontmatter and full spec |
| `src/lib/specs.ts` | Create | Core library: list, read, create, update specs |
| `src/lib/mode.ts` | Create | Mode resolution logic (resolveMode function) |
| `templates/SPEC.example.md` | Create | Example spec file template |
| `src/types/index.ts` | Modify | Add `mode` and `local` to ConfigSchema |
| `src/lib/config.ts` | Modify | Add defaults for local mode config |
| `src/lib/session.ts` | Modify | Add `isLocal`, `specId`, `specFilepath` fields |
| `src/lib/opencode.ts` | Modify | Add `buildLocalPlanningPrompt` and `buildLocalImplementationPrompt` |
| `src/commands/plan.ts` | Modify | Add `--local` flag, local planning workflow |
| `src/commands/run.ts` | Modify | Add `--local` flag, local implementation workflow |
| `src/commands/loop.ts` | Modify | Add `--local` flag |
| `src/commands/status.ts` | Modify | Add `--local` flag, show local specs |
| `src/commands/setup.ts` | Modify | Add option to configure default mode |
| `src/index.ts` | Modify | Add `--local` and `--notion` flags to CLI commands |

## Acceptance Criteria

- [x] `notion-code plan --local` creates a spec file in `specs/` folder
- [x] `notion-code run --local` reads and implements specs from `specs/` folder
- [x] `notion-code loop --local` works with local specs
- [x] `notion-code status --local` shows local specs status
- [x] `notion-code setup` allows configuring default mode
- [x] Mode resolution works correctly (flags > config > auto-detect)
- [x] Conflict detection works when both specs/ and Notion exist without config.mode

## Definition of Done

All steps complete, TypeScript compiles without errors, and the local mode workflow works end-to-end:
1. `notion-code setup` → configure local mode as default
2. `notion-code plan` → create spec in specs/
3. `notion-code run` → implement spec from specs/
4. `notion-code loop` → autonomous implementation
5. Spec status updates correctly (todo → in-progress → done)
