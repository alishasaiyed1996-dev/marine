import { Router } from 'express'
import * as sitemapService from '../../services/sitemapService.js'

const router = Router()

// ─── GET /api/sitemap.xml ─────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    res.setHeader('Content-Type', 'application/xml')
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')

    const xml = await sitemapService.generateSitemap()
    res.send(xml)
  } catch (err) {
    console.error('Sitemap generation error:', err)
    res.status(503).send(sitemapService.getFallbackSitemap())
  }
})

export default router
