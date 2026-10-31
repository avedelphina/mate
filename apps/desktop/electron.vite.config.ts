import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// The window loads nothing but its own files, and connects to nothing: it talks to main through the bridge.
// Only a picture drawn by the stylesheet itself (a data: address) is let in. It is put in the built page and not
// the dev server's, which needs inline scripts and a socket for hot reload.
const policy = {
  name: 'mate-content-security-policy',
  apply: 'build' as const,
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
      },
      injectTo: 'head-prepend' as const
    }
  ]
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // The window is sandboxed, and a sandboxed preload cannot be an ES module.
    build: { rollupOptions: { output: { format: 'cjs' } } }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), policy]
  }
})
