import * as Sentry from '@sentry/react'

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION || '1.0.0',
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.2 : 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      // Scrub sensitive data
      if (event.request?.headers) {
        delete event.request.headers['authorization']
        delete event.request.headers['x-csrf-token']
      }
      // B5: breadcrumb/network URLs can carry one-time reset tokens or guest
      // tracking emails in the query string — strip the query before send.
      for (const crumb of event.breadcrumbs ?? []) {
        const url = crumb?.data?.['url']
        if (typeof url === 'string') {
          crumb.data['url'] = url.split('?')[0]
        }
      }
      return event
    },
  })
}
