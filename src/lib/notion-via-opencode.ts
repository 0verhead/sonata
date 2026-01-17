import { runOpenCodeCli } from "./opencode.js";

/**
 * Ticket info returned from Notion queries via opencode
 */
export interface TicketInfo {
  id: string;
  title: string;
  status: string;
  url: string;
  hasPrd: boolean;
  prdPageId?: string;
}

/**
 * PRD content fetched from Notion
 */
export interface PrdContent {
  pageId: string;
  content: string;
  title: string;
}

/**
 * Validate if a string is a valid Notion UUID (32 chars without dashes, or 36 with dashes)
 */
function isValidNotionId(id: string): boolean {
  const uuidPattern = /^[a-f0-9]{32}$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return uuidPattern.test(id);
}

/**
 * Parse a line-based ticket format from AI output
 * Format: TICKET|id|status|title|url
 */
function parseTicketLines(output: string): TicketInfo[] {
  const tickets: TicketInfo[] = [];
  const lines = output.split("\n");
  
  for (const line of lines) {
    // Look for lines starting with TICKET|
    if (line.trim().startsWith("TICKET|")) {
      const parts = line.trim().split("|");
      // Format: TICKET|id|status|title|url (5 parts)
      if (parts.length >= 5) {
        const id = parts[1].trim();
        // Skip example IDs that aren't valid UUIDs (like "page-id", "abc123", "def456")
        if (!isValidNotionId(id)) {
          console.log(`[notion] Skipping invalid ticket ID (not a UUID): ${id}`);
          continue;
        }
        tickets.push({
          id,
          title: parts[3].trim(),
          url: parts[4].trim(),
          status: parts[2].trim(),
          hasPrd: false, // Will be checked separately when needed
        });
      }
    }
  }
  
  return tickets;
}

/**
 * Fetch tickets from Notion board via opencode MCP
 * Returns tickets in "Planned" and optionally "In Progress" status
 * PRD status is checked separately
 */
export async function fetchTicketsViaMcp(
  boardId: string,
  statusColumn: { todo: string; inProgress: string; done: string },
  cwd: string,
  includeInProgress: boolean = false,
  viewId?: string
): Promise<TicketInfo[]> {
  const statusValues = includeInProgress
    ? [statusColumn.todo, statusColumn.inProgress]
    : [statusColumn.todo];
  
  const statusList = statusValues.map(s => `"${s}"`).join(" or ");
  
  // Build the URL with optional view parameter
  const notionUrl = viewId
    ? `https://notion.so/${boardId}?v=${viewId}`
    : boardId;
  
  const viewInstruction = viewId
    ? `This database has multiple views. Use view ID ${viewId} to get the correct data source.`
    : "";
  
  const prompt = `
Use notion-fetch to get the database: ${notionUrl}
${viewInstruction}
The notion-fetch response will show the database pages. Look through ALL pages listed.

Find ALL pages where the Status property equals ${statusList}.

For EACH matching ticket, output ONE line in this EXACT format:
TICKET|page-id|status|ticket title|https://notion.so/page-id

IMPORTANT RULES:
- Go through EVERY page in the response - don't stop early
- Output ALL matching tickets, not just first 10
- Do NOT use notion-search - just use the fetch response
- Do NOT output example lines - only real tickets
- At the end, output: TOTAL|<number> with the count of tickets you found
`.trim();

  const result = await runOpenCodeCli(prompt, { cwd, timeoutMs: 180000 });

  if (!result.success) {
    throw new Error(`Failed to fetch tickets: ${result.error}`);
  }

  const tickets = parseTicketLines(result.output);
  
  // Check if AI reported a total count for verification
  const totalMatch = result.output.match(/TOTAL\|(\d+)/);
  if (totalMatch) {
    const reportedTotal = parseInt(totalMatch[1], 10);
    if (reportedTotal !== tickets.length) {
      console.warn(`[notion] AI reported ${reportedTotal} tickets but parsed ${tickets.length}`);
    }
  }
  
  if (tickets.length === 0) {
    console.error("No tickets found in output. Raw output:");
    console.error(result.output.slice(-500));
  }
  
  return tickets;
}

/**
 * Check if a specific ticket has a PRD child page
 */
export async function checkTicketHasPrd(
  ticketId: string,
  cwd: string
): Promise<{ hasPrd: boolean; prdPageId?: string }> {
  console.log(`[notion] Checking for PRD in ticket: ${ticketId}`);
  
  const prompt = `
Use notion-fetch to get the page with ID: ${ticketId}

Check if it has a child page titled "PRD" (case-insensitive).

Reply with EXACTLY one of these two formats:
HAS_PRD|child-page-id
NO_PRD

Nothing else.
`.trim();

  const result = await runOpenCodeCli(prompt, { cwd, timeoutMs: 60000 });

  if (!result.success) {
    console.error(`[notion] PRD check failed: ${result.error}`);
    return { hasPrd: false };
  }

  const output = result.output.trim();
  console.log(`[notion] PRD check output: ${output.slice(-200)}`);
  
  if (output.includes("HAS_PRD|")) {
    // Match valid UUID format (32 chars without dashes, or 36 with dashes)
    // This avoids matching example text like "HAS_PRD|child-page-id" where "c" is valid hex
    const match = output.match(/HAS_PRD\|([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (match) {
      console.log(`[notion] Found PRD with ID: ${match[1]}`);
      return { hasPrd: true, prdPageId: match[1] };
    } else {
      console.error("[notion] HAS_PRD found but no valid UUID. Output tail:", output.slice(-300));
    }
  }
  
  console.log("[notion] No PRD found");
  return { hasPrd: false };
}

/**
 * Fetch the content of a specific page by ID
 * This is simpler than fetchPrdContentViaMcp because we already know the page ID
 */
export async function fetchPageContentViaMcp(
  pageId: string,
  cwd: string
): Promise<string | null> {
  console.log(`[notion] Fetching page content for: ${pageId}`);
  
  const prompt = `
Use notion-fetch to get the page with ID: ${pageId}

Output the page content in this EXACT format:
PAGE_CONTENT_START
(the full markdown content of the page here)
PAGE_CONTENT_END

Output ONLY the markers and content, nothing else before or after.
`.trim();

  const result = await runOpenCodeCli(prompt, { cwd, timeoutMs: 120000 });

  if (!result.success) {
    console.error(`[notion] Failed to fetch page: ${result.error}`);
    return null;
  }

  const output = result.output;
  console.log(`[notion] Raw output length: ${output.length} chars`);
  
  // Extract content between markers
  const contentMatch = output.match(/PAGE_CONTENT_START\s*([\s\S]*?)\s*PAGE_CONTENT_END/);
  if (!contentMatch) {
    console.error("[notion] Could not find PAGE_CONTENT markers in output");
    console.error("[notion] Output tail:", output.slice(-500));
    return null;
  }
  
  const content = contentMatch[1].trim();
  console.log(`[notion] Extracted content: ${content.length} chars`);
  return content;
}

/**
 * Fetch PRD content for a specific ticket via opencode MCP
 * 
 * Two-step approach:
 * 1. Use checkTicketHasPrd() to find the PRD child page ID
 * 2. Use fetchPageContentViaMcp() to get the content
 * 
 * This is more reliable than asking the AI to do both in one prompt.
 */
export async function fetchPrdContentViaMcp(
  ticketId: string,
  cwd: string
): Promise<PrdContent | null> {
  console.log(`[notion] Fetching PRD for ticket: ${ticketId}`);
  
  // Step 1: Check if PRD exists and get its page ID
  console.log("[notion] Step 1: Checking if ticket has PRD...");
  const prdStatus = await checkTicketHasPrd(ticketId, cwd);
  
  if (!prdStatus.hasPrd) {
    console.log("[notion] No PRD found for this ticket");
    return null;
  }
  
  if (!prdStatus.prdPageId) {
    console.error("[notion] PRD exists but no page ID returned");
    return null;
  }
  
  console.log(`[notion] PRD found with ID: ${prdStatus.prdPageId}`);
  
  // Step 2: Fetch the PRD page content directly
  console.log("[notion] Step 2: Fetching PRD content...");
  const content = await fetchPageContentViaMcp(prdStatus.prdPageId, cwd);
  
  if (!content) {
    console.error("[notion] Failed to fetch PRD content");
    return null;
  }
  
  console.log(`[notion] PRD content fetched successfully (${content.length} chars)`);
  
  return {
    pageId: prdStatus.prdPageId,
    title: "PRD",
    content,
  };
}

/**
 * Create a PRD child page under a ticket via opencode MCP
 */
export async function createPrdViaMcp(
  ticketId: string,
  prdContent: string,
  cwd: string
): Promise<{ pageId: string; url: string } | null> {
  const escapedContent = prdContent.replace(/`/g, "\\`").replace(/\$/g, "\\$");
  
  const prompt = `
Use the Notion MCP (notion-create-pages) to create a child page under the page with ID: ${ticketId}

Create the page with:
- Title: "PRD"
- Content: 
${escapedContent}

After creating, output the result in this format:
CREATED|page-id|https://notion.so/page-url

If creation failed, output:
FAILED|reason
`.trim();

  const result = await runOpenCodeCli(prompt, { cwd, timeoutMs: 120000 });

  if (!result.success) {
    throw new Error(`Failed to create PRD: ${result.error}`);
  }

  const output = result.output;
  
  // Look for CREATED|id|url pattern
  const match = output.match(/CREATED\|([a-f0-9-]+)\|(https:\/\/[^\s]+)/i);
  if (match) {
    return {
      pageId: match[1].trim(),
      url: match[2].trim(),
    };
  }
  
  // Check for failure
  if (output.includes("FAILED|")) {
    const failMatch = output.match(/FAILED\|(.+)/);
    console.error("PRD creation failed:", failMatch?.[1] ?? "unknown reason");
  }
  
  return null;
}

/**
 * Update ticket status in Notion via opencode MCP
 */
export async function updateTicketStatusViaMcp(
  ticketId: string,
  newStatus: string,
  statusPropertyName: string,
  cwd: string
): Promise<boolean> {
  const prompt = `
Use the Notion MCP (notion-update-page) to update the page with ID: ${ticketId}

Set the "${statusPropertyName}" property to: "${newStatus}"

Return "SUCCESS" if the update was successful, or "FAILED: reason" if it failed.
Output ONLY the status word, nothing else.
`.trim();

  const result = await runOpenCodeCli(prompt, { cwd, timeoutMs: 60000 });

  if (!result.success) {
    console.warn(`Failed to update ticket status: ${result.error}`);
    return false;
  }

  return result.output.toLowerCase().includes("success");
}

/**
 * Update PRD content in Notion (mark steps as complete)
 */
export async function updatePrdViaMcp(
  prdPageId: string,
  newContent: string,
  cwd: string
): Promise<boolean> {
  const escapedContent = newContent.replace(/`/g, "\\`").replace(/\$/g, "\\$");
  
  const prompt = `
Use the Notion MCP (notion-update-page) to replace the content of page with ID: ${prdPageId}

New content:
${escapedContent}

Return "SUCCESS" if the update was successful, or "FAILED: reason" if it failed.
Output ONLY the status word, nothing else.
`.trim();

  const result = await runOpenCodeCli(prompt, { cwd, timeoutMs: 60000 });

  if (!result.success) {
    console.warn(`Failed to update PRD: ${result.error}`);
    return false;
  }

  return result.output.toLowerCase().includes("success");
}

/**
 * Fetch tickets that have PRD child pages (ready for implementation)
 * Note: This checks each ticket for PRDs which can be slow
 */
export async function fetchReadyTicketsViaMcp(
  boardId: string,
  statusColumn: { todo: string; inProgress: string; done: string },
  cwd: string,
  includeInProgress: boolean = false,
  viewId?: string
): Promise<TicketInfo[]> {
  const allTickets = await fetchTicketsViaMcp(boardId, statusColumn, cwd, includeInProgress, viewId);
  
  // Check each ticket for PRD (sequentially to avoid rate limits)
  const readyTickets: TicketInfo[] = [];
  for (const ticket of allTickets) {
    const prdStatus = await checkTicketHasPrd(ticket.id, cwd);
    if (prdStatus.hasPrd) {
      readyTickets.push({
        ...ticket,
        hasPrd: true,
        prdPageId: prdStatus.prdPageId,
      });
    }
  }
  
  return readyTickets;
}

/**
 * Search for additional tickets that might have been missed
 * Uses broader search queries to find more tickets
 */
export async function fetchMoreTicketsViaMcp(
  boardId: string,
  statusColumn: { todo: string; inProgress: string; done: string },
  cwd: string,
  excludeIds: string[],
  viewId?: string
): Promise<TicketInfo[]> {
  const excludeList = excludeIds.length > 0 
    ? `\nALREADY FOUND (do NOT include these): ${excludeIds.join(", ")}`
    : "";
  
  const notionUrl = viewId
    ? `https://notion.so/${boardId}?v=${viewId}`
    : boardId;
  
  const prompt = `
TASK: Find MORE tickets with Status = "${statusColumn.todo}" that may have been missed.

Database: ${notionUrl}
${excludeList}

STRATEGY:
1. Get the data source URL (collection://...) for this database
2. Use notion-search with various queries to find tickets:
   - Search for common German words: "fahrzeug", "fahrer", "nutzer", "kosten", "daten"
   - Search for common English words: "feature", "bug", "update", "fix", "add"
   - Search for names: person names that might appear in tickets
   - Search for technical terms: "api", "ui", "export", "import", "tabelle"
3. For each search result, check if Status = "${statusColumn.todo}"
4. Only include NEW tickets not in the exclude list

OUTPUT FORMAT - For each NEW ticket found:
TICKET|page-id|status|title|https://notion.so/page-id

Do multiple searches. Output ALL new tickets found.
At the end: TOTAL|<number>
`.trim();

  const result = await runOpenCodeCli(prompt, { cwd, timeoutMs: 300000 });

  if (!result.success) {
    console.error(`[notion] Failed to fetch more tickets: ${result.error}`);
    return [];
  }

  const tickets = parseTicketLines(result.output);
  
  // Filter out any that were in the exclude list (in case AI included them anyway)
  const excludeSet = new Set(excludeIds);
  return tickets.filter(t => !excludeSet.has(t.id));
}
