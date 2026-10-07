import type { IncomingMessage, ServerResponse } from 'node:http'
import { app } from '../server/app.js'

// Vercel routes all /api/* requests here and passes the original path in `route`.
export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost')
  const route = url.searchParams.get('route')
  if (route === null || route.includes('..') || route.startsWith('/')) {
    res.statusCode = 404
    res.end('Not found')
    return
  }
  url.searchParams.delete('route')
  req.url = `/api/${route}${url.search}`
  app(req, res)
}
