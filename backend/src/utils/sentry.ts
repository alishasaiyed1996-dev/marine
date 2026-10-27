import * as Sentry from '@sentry/node'

export function initSentry() {
  const dsn = process.env.SENTRY_DSN
  // No DSN → Sentry stays off entirely (never crashes, never sends).
  if (!dsn) {
    return
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version || '1.0.0',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    integrations: [
      // B5: request bodies are never attached. RFQ / contact / account forms
      // carry names, emails, phone numbers and addresses — none of that may
      // leave the server. The integration default ('medium') would attach up
      // to 10 KB of every POST body.
      Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' }),
    ],
    beforeSend(event) {
      // Scrub sensitive data from error reports. This is defense in depth on
      // top of `maxIncomingRequestBodySize: 'none'`: no request payload, no
      // cookies, no auth material, and no one-time tokens in URLs.
      const request = event.request
      if (request) {
        delete request.data
        delete request.cookies
        if (request.headers) {
          delete request.headers['authorization']
          delete request.headers['x-csrf-token']
          delete request.headers['cookie']
        }
        if (typeof request.url === 'string') {
          // Query strings can carry reset-password tokens / tracking emails.
          request.url = request.url.split('?')[0]
        }
        if (request.query_string) {
          request.query_string = ''
        }
      }
      return event
    },
  })
}

export function captureError(error: Error, context?: Record<string, unknown>) {
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value)
      })
    }
    Sentry.captureException(error)
  })
}
