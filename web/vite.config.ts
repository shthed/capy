import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function collectFilesDeterministic(dirAbs, baseAbs = dirAbs, out = []) {
  if (!fs.existsSync(dirAbs)) return out;
  const entries = fs
    .readdirSync(dirAbs, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const fullPath = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      collectFilesDeterministic(fullPath, baseAbs, out);
    } else if (entry.isFile()) {
      const rel = path.relative(baseAbs, fullPath).split(path.sep).join('/');
      out.push({ rel, fullPath });
    }
  }
  return out;
}

export function computeDistAssetsDigest(assetsDirAbs: string): string {
  const files = collectFilesDeterministic(assetsDirAbs);
  if (files.length === 0) return 'empty';
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file.rel);
    hash.update('\0');
    hash.update(fs.readFileSync(file.fullPath));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

export function parseAndroidSha256Fingerprints(rawEnv?: string): string[] {
  if (!rawEnv || typeof rawEnv !== 'string') return [];
  const tokens = rawEnv.split(/[,;\s]+/);
  const valid: string[] = [];
  for (const raw of tokens) {
    const trimmed = raw.trim().toUpperCase();
    if (!trimmed) continue;
    let candidate = trimmed;
    if (/^[0-9A-F]{64}$/.test(candidate)) {
      candidate = candidate.match(/.{2}/g)!.join(':');
    }
    if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(candidate)) continue;
    if (/^(00:){31}00$/.test(candidate)) continue;
    if (!valid.includes(candidate)) {
      valid.push(candidate);
    }
  }
  return valid;
}

export function extractInlineScriptHashes(htmlContent: string): string[] {
  const hashes: string[] = [];
  const scriptRe = /<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(htmlContent)) !== null) {
    const attrs = match[1] || '';
    if (/\btype\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json(?:\s|$))/i.test(attrs)) {
      continue;
    }
    const body = match[2];
    if (!body || body.trim().length === 0) continue;
    const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
    const token = `'sha256-${digest}'`;
    if (!hashes.includes(token)) {
      hashes.push(token);
    }
  }
  return hashes;
}

/**
 * Builds the strict meta Content-Security-Policy injected into production `dist/index.html`
 * so hosts that do not honor Cloudflare `_headers` (GitHub Pages, Android WebView) still
 * enforce identical script/connect/img/worker/object restrictions without breaking Vite dev HMR.
 * Omits `frame-ancestors` (ignored in `<meta>`) and `upgrade-insecure-requests` (preserves local `http://localhost` preview/E2E).
 */
export function buildMetaCspPolicy(htmlContent: string): string {
  const scriptHashes = extractInlineScriptHashes(htmlContent);
  const scriptSrcTokens = [
    "'self'",
    ...scriptHashes,
    'https://accounts.google.com/gsi/client',
    'https://js.puter.com/v2/',
  ];
  return [
    "default-src 'self'",
    `script-src ${scriptSrcTokens.join(' ')}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://*.puter.com",
    "font-src 'self' data:",
    "connect-src 'self' data: blob: https://capypaint.com https://paint.capyboop.com https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com https://generativelanguage.googleapis.com https://openrouter.ai https://api.openai.com https://api.x.ai https://api.puter.com https://puter.com https://*.puter.com https://graph.microsoft.com https://login.microsoftonline.com wss://capypaint.com wss://*.capypaint.com wss://paint.capyboop.com",
    "worker-src 'self' blob:",
    'frame-src https://accounts.google.com https://puter.com https://*.puter.com',
    "manifest-src 'self'",
    "media-src 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ') + ';';
}

function capyPostBuildStampPlugin(): Plugin {
  let outDirAbs = path.resolve(__dirname, 'dist');
  return {
    name: 'capy-post-build-stamp',
    apply: 'build',
    configResolved(config) {
      outDirAbs = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (/http-equiv=["']?Content-Security-Policy["']?/i.test(html)) {
          return html;
        }
        const csp = buildMetaCspPolicy(html);
        const metaTag = `    <meta http-equiv="Content-Security-Policy" content="${csp}" />`;
        if (/<meta\s+charset=["']?UTF-8["']?\s*\/?>/i.test(html)) {
          return html.replace(
            /(<meta\s+charset=["']?UTF-8["']?\s*\/?>)/i,
            `$1\n${metaTag}`
          );
        }
        return html.replace(/<head>/i, `<head>\n${metaTag}`);
      },
    },
    closeBundle() {
      const pkgPath = path.resolve(__dirname, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };

      const swPath = path.join(outDirAbs, 'sw.js');
      if (fs.existsSync(swPath)) {
        const assetsDir = path.join(outDirAbs, 'assets');
        const emittedAssetUrls = fs.existsSync(assetsDir)
          ? fs
              .readdirSync(assetsDir)
              .filter((name) => /\.(?:js|css)$/i.test(name))
              .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
              .map((name) => `./assets/${name}`)
          : [];
        const assetsDigest = computeDistAssetsDigest(assetsDir);
        const rawSw = fs.readFileSync(swPath, 'utf8');
        const stampedSw = rawSw
          .replace('__CAPY_SW_VERSION__', pkg.version)
          .replace('__CAPY_SW_ASSETS_DIGEST__', assetsDigest)
          .replace('/* __CAPY_SW_BUILD_ASSETS__ */ []', JSON.stringify(emittedAssetUrls));
        fs.writeFileSync(swPath, stampedSw, 'utf8');
      }

      const wellKnownDir = path.join(outDirAbs, '.well-known');
      fs.mkdirSync(wellKnownDir, { recursive: true });
      const fingerprints = parseAndroidSha256Fingerprints(
        process.env.CAPY_ANDROID_SHA256_CERT_FINGERPRINTS
      );
      const assetLinksPayload = [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: 'com.capyboop.paint',
            sha256_cert_fingerprints: fingerprints,
          },
        },
      ];
      fs.writeFileSync(
        path.join(wellKnownDir, 'assetlinks.json'),
        `${JSON.stringify(assetLinksPayload, null, 2)}\n`,
        'utf8'
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), capyPostBuildStampPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) {
              return 'vendor-ui';
            }
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
});
