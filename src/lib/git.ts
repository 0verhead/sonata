import { execa } from "execa";

/**
 * Check if current directory is a git repository
 */
export async function isGitRepo(cwd: string = process.cwd()): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--git-dir"], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(
  cwd: string = process.cwd()
): Promise<string> {
  const result = await execa("git", ["branch", "--show-current"], { cwd });
  return result.stdout.trim();
}

/**
 * Check if there are uncommitted changes
 */
export async function hasChanges(cwd: string = process.cwd()): Promise<boolean> {
  const result = await execa("git", ["status", "--porcelain"], { cwd });
  return result.stdout.trim().length > 0;
}

/**
 * Create a new branch from the base branch
 */
export async function createBranch(
  branchName: string,
  baseBranch: string = "main",
  cwd: string = process.cwd()
): Promise<void> {
  // Fetch latest from remote
  try {
    await execa("git", ["fetch", "origin", baseBranch], { cwd });
  } catch {
    // Might not have remote, continue anyway
  }

  // Create and checkout new branch
  await execa("git", ["checkout", "-b", branchName], { cwd });
}

/**
 * Switch to an existing branch
 */
export async function switchBranch(
  branchName: string,
  cwd: string = process.cwd()
): Promise<void> {
  await execa("git", ["checkout", branchName], { cwd });
}

/**
 * Check if a branch exists locally
 */
export async function branchExists(
  branchName: string,
  cwd: string = process.cwd()
): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--verify", branchName], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stage all changes
 */
export async function stageAll(cwd: string = process.cwd()): Promise<void> {
  await execa("git", ["add", "-A"], { cwd });
}

/**
 * Commit staged changes
 */
export async function commit(
  message: string,
  cwd: string = process.cwd()
): Promise<void> {
  await execa("git", ["commit", "-m", message], { cwd });
}

/**
 * Push current branch to remote
 */
export async function push(
  cwd: string = process.cwd(),
  setUpstream: boolean = false
): Promise<void> {
  const branch = await getCurrentBranch(cwd);
  if (setUpstream) {
    await execa("git", ["push", "-u", "origin", branch], { cwd });
  } else {
    await execa("git", ["push"], { cwd });
  }
}

/**
 * Create a pull request using GitHub CLI
 */
export async function createPR(
  title: string,
  body: string,
  baseBranch: string = "main",
  cwd: string = process.cwd()
): Promise<string> {
  // Push first
  await push(cwd, true);

  // Create PR
  const result = await execa(
    "gh",
    ["pr", "create", "--title", title, "--body", body, "--base", baseBranch],
    { cwd }
  );

  // Extract PR URL from output
  const prUrl = result.stdout.trim();
  return prUrl;
}

/**
 * Check if gh CLI is installed
 */
export async function checkGhInstalled(): Promise<boolean> {
  try {
    await execa("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a branch name from a task title
 */
export function generateBranchName(taskTitle: string, taskId: string): string {
  const slug = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 40);

  const shortId = taskId.replace(/-/g, "").substring(0, 8);
  return `task/${slug}-${shortId}`;
}

/**
 * Get the remote URL
 */
export async function getRemoteUrl(
  cwd: string = process.cwd()
): Promise<string | null> {
  try {
    const result = await execa("git", ["remote", "get-url", "origin"], { cwd });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get commit messages since diverging from base branch
 */
export async function getCommitsSinceBase(
  baseBranch: string = "main",
  cwd: string = process.cwd()
): Promise<string[]> {
  try {
    const result = await execa(
      "git",
      ["log", `${baseBranch}..HEAD`, "--pretty=format:%s"],
      { cwd }
    );
    return result.stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Generate PR title from commit messages
 * Uses first commit message or summarizes multiple commits
 */
export function generatePRTitle(commits: string[]): string {
  if (commits.length === 0) {
    return "Changes from notion-code";
  }
  
  if (commits.length === 1) {
    return commits[0];
  }
  
  // Multiple commits - use the first one (usually the most descriptive)
  // or find a common theme
  const firstCommit = commits[commits.length - 1]; // Oldest commit (usually the feature name)
  return firstCommit;
}

/**
 * Generate PR body from commits and progress
 */
export function generatePRBody(commits: string[]): string {
  const lines = [
    "## Summary",
    "",
    "Completed via notion-code",
    "",
  ];
  
  if (commits.length > 0) {
    lines.push("## Commits", "");
    for (const commit of commits) {
      lines.push(`- ${commit}`);
    }
    lines.push("");
  }
  
  lines.push("See `progress.txt` for detailed work log.");
  
  return lines.join("\n");
}
