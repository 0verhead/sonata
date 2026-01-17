import * as fs from "node:fs";
import * as path from "node:path";

const SESSION_DIR = ".sonata";
const SESSION_FILE = "session.json";

/**
 * Session data for tracking current working ticket
 */
export interface Session {
  ticketId: string;
  ticketTitle: string;
  ticketUrl: string;
  startedAt: string;
  branch: string;
  iteration: number;
  // PRD-based workflow fields
  prdPageId?: string;        // ID of the PRD child page in Notion
  prdContent?: string;       // Cached PRD content (markdown)
  prdFetchedAt?: string;     // When PRD was last fetched
  totalSteps?: number;       // Total steps in the PRD
  completedSteps?: number;   // Steps marked complete
  // OpenCode session continuity (for future use)
  opencodeSessionId?: string; // Track opencode session for --continue flag
  // Local mode fields
  isLocal?: boolean;         // true when using local specs
  specId?: string;           // ID from spec frontmatter
  specFilepath?: string;     // Path to spec file
}

/**
 * Get the session file path for a project
 */
function getSessionPath(cwd: string): string {
  return path.join(cwd, SESSION_DIR, SESSION_FILE);
}

/**
 * Ensure the session directory exists
 */
function ensureSessionDir(cwd: string): void {
  const dir = path.join(cwd, SESSION_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load the current session for a project
 * Returns null if no active session
 */
export function loadCurrentSession(cwd: string): Session | null {
  const sessionPath = getSessionPath(cwd);
  
  if (!fs.existsSync(sessionPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(sessionPath, "utf-8");
    return JSON.parse(content) as Session;
  } catch {
    return null;
  }
}

/**
 * Check if there's an active session
 */
export function hasActiveSession(cwd: string): boolean {
  return loadCurrentSession(cwd) !== null;
}

/**
 * Initialize a new session for a ticket
 */
export function initSession(
  cwd: string,
  data: {
    ticketId: string;
    ticketTitle: string;
    ticketUrl: string;
    branch: string;
  }
): Session {
  ensureSessionDir(cwd);
  
  const session: Session = {
    ticketId: data.ticketId,
    ticketTitle: data.ticketTitle,
    ticketUrl: data.ticketUrl,
    branch: data.branch,
    startedAt: new Date().toISOString(),
    iteration: 0,
  };
  
  const sessionPath = getSessionPath(cwd);
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8");
  
  return session;
}

/**
 * Update the current session
 */
export function updateSession(
  cwd: string,
  updates: Partial<Session>
): Session | null {
  const session = loadCurrentSession(cwd);
  
  if (!session) {
    return null;
  }
  
  const updated: Session = {
    ...session,
    ...updates,
  };
  
  const sessionPath = getSessionPath(cwd);
  fs.writeFileSync(sessionPath, JSON.stringify(updated, null, 2), "utf-8");
  
  return updated;
}

/**
 * Increment the iteration counter
 */
export function incrementIteration(cwd: string): number {
  const session = loadCurrentSession(cwd);
  
  if (!session) {
    return 0;
  }
  
  const newIteration = session.iteration + 1;
  updateSession(cwd, { iteration: newIteration });
  
  return newIteration;
}

/**
 * Update session with PRD information
 */
export function updateSessionPrd(
  cwd: string,
  prdData: {
    prdPageId: string;
    prdContent: string;
    totalSteps?: number;
  }
): Session | null {
  return updateSession(cwd, {
    prdPageId: prdData.prdPageId,
    prdContent: prdData.prdContent,
    prdFetchedAt: new Date().toISOString(),
    totalSteps: prdData.totalSteps,
    completedSteps: 0,
  });
}

/**
 * Update completed steps count
 */
export function updateCompletedSteps(cwd: string, completedSteps: number): Session | null {
  return updateSession(cwd, { completedSteps });
}

/**
 * Check if the session has a PRD loaded
 */
export function sessionHasPrd(cwd: string): boolean {
  const session = loadCurrentSession(cwd);
  return session !== null && Boolean(session.prdContent);
}

/**
 * Get PRD content from session
 */
export function getSessionPrd(cwd: string): string | null {
  const session = loadCurrentSession(cwd);
  return session?.prdContent ?? null;
}

/**
 * Count steps in PRD content (looks for checkbox patterns)
 */
export function countPrdSteps(prdContent: string): { total: number; completed: number } {
  const uncheckedPattern = /- \[ \]/g;
  const checkedPattern = /- \[x\]/gi;
  
  const unchecked = prdContent.match(uncheckedPattern)?.length ?? 0;
  const checked = prdContent.match(checkedPattern)?.length ?? 0;
  
  return {
    total: unchecked + checked,
    completed: checked,
  };
}

/**
 * Clear the current session (ticket complete or abandoned)
 */
export function clearSession(cwd: string): void {
  const sessionPath = getSessionPath(cwd);
  
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }
}

/**
 * Get session directory path (for .gitignore purposes)
 */
export function getSessionDir(): string {
  return SESSION_DIR;
}
