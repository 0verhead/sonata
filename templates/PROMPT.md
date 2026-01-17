# Ralph Loop Prompt Template

This is the default prompt structure used by sonata. The actual prompt is
built dynamically from your TASKS.md and progress.txt files.

## How It Works

The prompt sent to opencode follows this structure:

```
@TASKS.md @progress.txt

1. Decide which task to work on next.
   This should be the one YOU decide has the highest priority,
   - not necessarily the first in the list.
2. Check any feedback loops, such as types and tests.
3. Append your progress to the progress.txt file.
4. Make a git commit of that feature.

ONLY WORK ON A SINGLE FEATURE.

If, while implementing the feature, you notice that all work
is complete, output <promise>COMPLETE</promise>.
```

## Customizing

You can create a custom `PROMPT.md` in your project root to override the
default instructions. The @TASKS.md and @progress.txt references will still
be included automatically.

## Tips for Your TASKS.md

Structure your task file for best results:

```markdown
# Tasks

## High Priority
- [ ] Critical bug fix: describe the issue
- [ ] Core feature: what needs to be built

## Medium Priority
- [ ] Enhancement: improve existing feature
- [ ] Refactor: clean up specific code

## Low Priority
- [ ] Polish: minor UI improvements
- [ ] Docs: update documentation

## Done
- [x] Completed task 1
- [x] Completed task 2

---

## Context

Add any important context here:
- Tech stack details
- External API docs
- Design decisions
```

## The Ralph Philosophy

1. **Small steps** - One feature per iteration
2. **Feedback loops** - Types, tests, linting as guardrails
3. **Progress tracking** - Document what was done
4. **Commits** - Save progress after each change
5. **Stop condition** - Clear signal when all work is done

For more information, see:
- https://ghuntley.com/ralph/
- https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum
