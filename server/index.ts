import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from './app.js'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.use((req, res, next) => req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next())
}

const port = Number(process.env.PORT || 3001)
app.listen(port, '0.0.0.0', () => console.log(`Stokita listening on ${port}`))
