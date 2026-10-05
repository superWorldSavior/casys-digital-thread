/**
 * DEV-ONLY MCP correlation tap (#59). The relay records exact tools/call
 * request/response pairs; the coordinator attributes them to ACP tool
 * events that carry no output (bex/Muse). Attribution requires exactly
 * one unconsumed match (tool + canonical args + recency) and consumes
 * it; zero or several matches attribute nothing, never a wrong result.
 * Production runs without a tap: output-less events capture nothing.
 */
export interface McpTapRecord {
  readonly tool: string;
  readonly argsJson: string;
  readonly resultJson: string;
  readonly failed: boolean;
  readonly at: number;
}

export interface McpTapQuery {
  readonly tool: string;
  readonly argsJson: string;
  /** Epoch ms; records older than this never match. */
  readonly since: number;
}

export interface McpCallTap {
  record(entry: McpTapRecord): void;
  /**
   * Returns the single unconsumed match and consumes it. Returns
   * undefined on zero matches or on ambiguity (several matches), in
   * which case nothing is consumed.
   */
  takeMatch(query: McpTapQuery): McpTapRecord | undefined;
}

/** Bounded ring; oldest entries drop first. */
export function createMcpCallTap(maxEntries = 50): McpCallTap {
  const entries: { record: McpTapRecord; consumed: boolean }[] = [];
  return {
    record(entry: McpTapRecord): void {
      entries.push({ record: entry, consumed: false });
      while (entries.length > maxEntries) entries.shift();
    },
    takeMatch(query: McpTapQuery): McpTapRecord | undefined {
      const matches = entries.filter((entry) =>
        !entry.consumed &&
        entry.record.tool === query.tool &&
        entry.record.argsJson === query.argsJson &&
        entry.record.at >= query.since
      );
      if (matches.length !== 1) return undefined;
      matches[0].consumed = true;
      return matches[0].record;
    },
  };
}

/**
 * Deterministic JSON for cross-channel comparison: object keys sorted
 * recursively, so key order differences between the relay parse and the
 * ACP event never break a match. Inputs are parsed JSON (no cycles).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
