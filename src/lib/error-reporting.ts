/** Where a crash gets reported.
 *
 * The original shipped errors to Lovable's editor, which a standalone copy has
 * no connection to. Left as a single seam: point it at Sentry, a log endpoint,
 * or your own table, and every error boundary in the app feeds it.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (import.meta.env?.DEV) console.error("[app error]", error, context ?? {});
}
