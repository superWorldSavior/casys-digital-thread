/**
 * Exact server-owned value submitted to mcp-build123d 0.7.1's
 * `build123d_export.timeout_ms` input.
 *
 * This is the provider tool argument, not the HTTP client deadline or an
 * isolated microVM execution limit.
 */
export const BUILD123D_EXPORT_TIMEOUT_MS = 60_000 as const;
