export type LogLevel = 'info' | 'warn' | 'error'

export interface RequestLogInput {
  appVersion: string
  requestId: string
  method: string
  path: string
  status: number
  durationMs: number
  userAgent: string | null
  errorCode?: string | null
  event?: string
  errorType?: string
}

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const versionPattern = /^\d{1,3}(?:\.\d{1,3}){0,2}$/
const safeErrorCodes = new Set([
  'validation_error',
  'authentication_failed',
  'authorization_failed',
  'request_conflict',
  'not_found',
  'rate_limited',
  'server_error',
  'worker_unhandled_error',
  'frontend_unhandled_error',
  'frontend_unhandled_rejection',
  'frontend_render_error',
])

export function getRequestId(value: string | null): string {
  return value && requestIdPattern.test(value) ? value.toLowerCase() : crypto.randomUUID()
}

export function normalizeApiRoute(path: string): string {
  const pathname = path.split('?', 1)[0]
  if (/^\/api\/purchases\/\d+$/.test(pathname)) return '/api/purchases/:id'
  if (/^\/api\/items\/\d+\/deactivate$/.test(pathname)) return '/api/items/:id/deactivate'
  if (/^\/api\/auth\/members\/\d+\/deactivate$/.test(pathname)) {
    return '/api/auth/members/:id/deactivate'
  }
  const knownRoutes = new Set([
    '/api/health',
    '/api/categories',
    '/api/items',
    '/api/purchases',
    '/api/analytics',
    '/api/audit/purchases',
    '/api/auth/status',
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/join',
    '/api/auth/logout',
    '/api/auth/session',
    '/api/auth/select-business',
    '/api/auth/invitations',
    '/api/auth/members',
    '/api/businesses',
    '/api/telemetry/frontend-error',
  ])
  if (pathname.startsWith('/api/exports/')) return '/api/exports/:kind.csv'
  return knownRoutes.has(pathname) ? pathname : '/api/:unmatched'
}

function majorVersion(match: RegExpMatchArray | null): string | null {
  return match?.[1] && match[1].length <= 3 ? match[1] : null
}

export function normalizeUserAgent(userAgent: string | null) {
  const value = userAgent ?? ''
  let browserFamily = 'Unknown'
  let browserVersion: string | null = null
  const browserMatchers: Array<[string, RegExp]> = [
    ['Edge', /Edg(?:A|iOS)?\/(\d{1,3})/],
    ['Opera', /OPR\/(\d{1,3})/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d{1,3})/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d{1,3})/],
    ['Safari', /Version\/(\d{1,3})(?:\.\d+)? .*Safari/],
  ]
  for (const [family, matcher] of browserMatchers) {
    const match = value.match(matcher)
    if (match) {
      browserFamily = family
      browserVersion = majorVersion(match)
      break
    }
  }

  let osFamily = 'Unknown'
  let osVersion: string | null = null
  let match = value.match(/Windows NT (\d+\.\d+)/)
  if (match) {
    osFamily = 'Windows'
    osVersion = ({ '10.0': '10+', '6.3': '8.1', '6.2': '8', '6.1': '7' } as Record<string, string>)[match[1]] ?? 'Other'
  } else if ((match = value.match(/(?:iPhone|iPad|iPod).* OS (\d+)(?:[_.](\d+))?/))) {
    osFamily = 'iOS'
    osVersion = match[1]
  } else if ((match = value.match(/Android[ -](\d+)(?:\.(\d+))?/))) {
    osFamily = 'Android'
    osVersion = match[1]
  } else if ((match = value.match(/(?:Mac OS X|macOS)[ _](\d+)(?:[._](\d+))?/))) {
    osFamily = 'macOS'
    osVersion = match[1] === '10' && match[2] ? `10.${match[2]}` : match[1]
  } else if (/CrOS/.test(value)) {
    osFamily = 'ChromeOS'
  } else if (/Linux/.test(value)) {
    osFamily = 'Linux'
  }

  let deviceClass = 'desktop'
  if (/iPad|Tablet/i.test(value) || (/Android/i.test(value) && !/Mobile/i.test(value))) {
    deviceClass = 'tablet'
  } else if (/Mobile|iPhone|iPod|Android/i.test(value)) {
    deviceClass = 'mobile'
  }

  return { browserFamily, browserVersion, osFamily, osVersion, deviceClass }
}

export function sanitizeErrorCode(value: string | null | undefined): string | null {
  if (!value) return null
  return safeErrorCodes.has(value) ? value : null
}

export function buildRequestLog(input: RequestLogInput) {
  const userAgent = normalizeUserAgent(input.userAgent)
  const status = Number.isInteger(input.status) ? input.status : 500
  const errorCode = sanitizeErrorCode(input.errorCode) ?? (
    status >= 500 ? 'server_error'
      : status === 429 ? 'rate_limited'
      : status === 401 ? 'authentication_failed'
      : status === 403 ? 'authorization_failed'
      : status === 409 ? 'request_conflict'
      : status === 404 ? 'not_found'
      : status >= 400 ? 'validation_error'
      : null
  )
  const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
  const log: Record<string, string | number | null> = {
    timestamp: new Date().toISOString(),
    level,
    applicationVersion: versionPattern.test(input.appVersion) ? input.appVersion : 'unknown',
    requestId: getRequestId(input.requestId),
    method: /^[A-Z]{3,10}$/.test(input.method) ? input.method : 'OTHER',
    route: normalizeApiRoute(input.path),
    status,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    browserFamily: userAgent.browserFamily,
    browserVersion: userAgent.browserVersion,
    osFamily: userAgent.osFamily,
    osVersion: userAgent.osVersion,
    deviceClass: userAgent.deviceClass,
    errorCode,
  }
  if (input.event) log.event = safeEventName(input.event)
  if (input.errorType) log.errorType = safeErrorType(input.errorType)
  return log
}

export function safeEventName(value: string): string {
  return /^[a-z][a-z0-9_]{2,48}$/.test(value) ? value : 'unknown_event'
}

export function safeErrorType(value: string): string {
  const knownTypes = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'DataError',
    'InvalidAccessError',
    'NotSupportedError',
    'OperationError',
    'UnknownError',
  ])
  return knownTypes.has(value) ? value : 'UnknownError'
}

export function emitStructuredLog(record: Record<string, unknown>): void {
  try {
    if (record.level === 'error') console.error(record)
    else if (record.level === 'warn') console.warn(record)
    else console.log(record)
  } catch {
    // Telemetry must not interrupt the request being served.
  }
}
