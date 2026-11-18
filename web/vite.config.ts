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

function capyPostBuildStampPlugin(): Plugin {
  let outDirAbs = path.resolve(__dirname, 'dist');
  return {
    name: 'capy-post-build-stamp',
    apply: 'build',
    configResolved(config) {
      outDirAbs = path.resolve(config.root, config.build.outDir);
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
            package_name: 'com.capypaint.capy',
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
            if (id.includes('lucide-react') || id.includes('canvas-confetti')) {
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
