const recentReports = new Map<string, number>()
const supportedErrorTypes = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
])

function normalizeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  return supportedErrorTypes.has(name) ? name : 'UnknownError'
}

export function createRequestId(): string {
  return crypto.randomUUID()
}

export function reportFrontendError(
  errorCode:
    | 'frontend_unhandled_error'
    | 'frontend_unhandled_rejection'
    | 'frontend_render_error',
  error: unknown,
): void {
  const errorType = normalizeErrorType(error)
  const dedupeKey = `${errorCode}:${errorType}`
  const now = Date.now()
  if ((recentReports.get(dedupeKey) ?? 0) > now - 30_000) return
  recentReports.set(dedupeKey, now)
  for (const [key, reportedAt] of recentReports) {
    if (reportedAt <= now - 30_000) recentReports.delete(key)
  }

  const requestId = createRequestId()
  void fetch('/api/telemetry/frontend-error', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    },
    body: JSON.stringify({ errorCode, errorType }),
  }).catch(() => undefined)
}

export function installGlobalErrorReporting(): void {
  window.addEventListener('error', (event) => {
    reportFrontendError('frontend_unhandled_error', event.error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportFrontendError('frontend_unhandled_rejection', event.reason)
  })
}
