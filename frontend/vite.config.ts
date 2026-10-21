import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'

/** Mirrors vercel.json's "/portal(/*)" -> portal.html rewrite in `vite dev` and `vite preview`,
 *  so the client portal bundle is reachable at the same path locally as in production. */
function portalRewrite(): Plugin {
  const rewrite = (req: IncomingMessage, _res: ServerResponse, next: () => void) => {
    if (req.url === '/portal' || req.url?.startsWith('/portal/')) req.url = '/portal.html';
    next();
  };
  return {
    name: 'portal-rewrite',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), portalRewrite()],
  build: {
    rollupOptions: {
      // Two entry points: the staff/client app at "/", and a separate client-only
      // bundle at "/portal" (own shell, no staff sidebar). See vercel.json for the
      // rewrites that route requests to each.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        portal: resolve(import.meta.dirname, 'portal.html'),
      },
    },
  },
})
