import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'path';
import fs from 'fs';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.resolve(WEB_DIR, 'public/assets/presets');

const PRESET_SPECS = [
  {
    id: 'algo-auto',
    image: '/assets/capybara.webp',
    config: {
      algorithm: 'AUTO',
      lineHandling: 'ABSORB_LINES',
      paletteDetail: 'MEDIUM',
      imageType: 'AUTO',
      colorCount: 18,
      minRegionArea: 48,
      maxRegions: 250,
      resolution: 360,
      smoothingPasses: 2,
    },
  },
  {
    id: 'algo-line-art',
    image: '/assets/capybara.webp',
    config: {
      algorithm: 'LINE_ART',
      lineHandling: 'ABSORB_LINES',
      paletteDetail: 'MEDIUM',
      imageType: 'DRAWING',
      colorCount: 18,
      minRegionArea: 48,
      maxRegions: 250,
      resolution: 360,
      smoothingPasses: 2,
    },
  },
  {
    id: 'algo-painterly',
    image: '/assets/capybara.webp',
    config: {
      algorithm: 'PAINTERLY',
      lineHandling: 'ABSORB_LINES',
      paletteDetail: 'MEDIUM',
      imageType: 'PHOTO',
      colorCount: 18,
      minRegionArea: 48,
      maxRegions: 250,
      resolution: 360,
      smoothingPasses: 2,
    },
  },
  {
    id: 'algo-posterized',
    image: '/assets/capybara.webp',
    config: {
      algorithm: 'POSTERIZED',
      lineHandling: 'ABSORB_LINES',
      paletteDetail: 'MEDIUM',
      imageType: 'DRAWING',
      colorCount: 18,
      minRegionArea: 36,
      maxRegions: 250,
      resolution: 360,
      smoothingPasses: 0,
    },
  },
  {
    id: 'algo-mosaic',
    image: '/assets/capybara.webp',
    config: {
      algorithm: 'MOSAIC_CEL',
      lineHandling: 'ABSORB_LINES',
      paletteDetail: 'MEDIUM',
      imageType: 'PHOTO',
      colorCount: 18,
      minRegionArea: 32,
      maxRegions: 250,
      resolution: 360,
      smoothingPasses: 2,
    },
  },
  {
    id: 'border-absorb',
    image: '/assets/snail_guitar.webp',
    config: {
      algorithm: 'LINE_ART',
      lineHandling: 'ABSORB_LINES',
      paletteDetail: 'MEDIUM',
      imageType: 'DRAWING',
      colorCount: 16,
      minRegionArea: 28,
      maxRegions: 300,
      resolution: 380,
      smoothingPasses: 2,
    },
  },
  {
    id: 'border-unified',
    image: '/assets/snail_guitar.webp',
    config: {
      algorithm: 'LINE_ART',
      lineHandling: 'UNIFIED_BLACK_REGION',
      paletteDetail: 'MEDIUM',
      imageType: 'DRAWING',
      colorCount: 16,
      minRegionArea: 28,
      maxRegions: 300,
      resolution: 380,
      smoothingPasses: 2,
    },
  },
  {
    id: 'detail-low',
    image: '/assets/capybara.webp',
    config: {
      algorithm: 'AUTO',
      lineHandling: 'ABSORB_LINES',
      paletteDetail: 'LOW',
      imageType: 'AUTO',
      colorCount: 10,
      minRegionArea: 96,
      maxRegions: 100,
      resolution: 360,
      smoothingPasses: 2,
    },
  },
  {
    id: 'detail-medium',
    image: '/assets/capybara.webp',
    config: {
      algorithm: 'AUTO',
      lineHandling: 'ABSORB_LINES',
      paletteDetail: 'MEDIUM',
      imageType: 'AUTO',
      colorCount: 18,
      minRegionArea: 48,
      maxRegions: 250,
      resolution: 360,
      smoothingPasses: 2,
    },
  },
  {
    id: 'detail-high',
    image: '/assets/capybara.webp',
    config: {
      algorithm: 'AUTO',
      lineHandling: 'ABSORB_LINES',
      paletteDetail: 'HIGH',
      imageType: 'AUTO',
      colorCount: 38,
      minRegionArea: 24,
      maxRegions: 500,
      resolution: 420,
      smoothingPasses: 2,
    },
  },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = await createServer({
    root: WEB_DIR,
    server: { port: 4179, strictPort: true },
    logLevel: 'silent',
  });
  await server.listen();

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 640, height: 640 } });
    const page = await context.newPage();
    await page.goto('http://localhost:4179/?skipTutorial=1', { waitUntil: 'domcontentloaded' });

    for (const spec of PRESET_SPECS) {
      const result = await page.evaluate(async ({ imagePath, config }) => {
        const mod = await import('/src/engine/PuzzleGenerator.ts');
        const generator = new mod.AutoPuzzleGenerator();

        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = imagePath;
        });

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = img.naturalWidth;
        srcCanvas.height = img.naturalHeight;
        const srcCtx = srcCanvas.getContext('2d');
        srcCtx.drawImage(img, 0, 0);

        const puzzle = generator.generate(srcCanvas, config);
        const { width, height, palette, regions, regionMap, borderMap } = puzzle;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = width;
        outCanvas.height = height;
        const outCtx = outCanvas.getContext('2d');
        const outImg = outCtx.createImageData(width, height);
        const data = outImg.data;

        const regionColor = new Map();
        for (const r of regions) {
          const pal = palette.find((p) => p.id === r.colorId) || palette[0];
          regionColor.set(r.id, pal);
        }

        const total = width * height;
        for (let i = 0; i < total; i++) {
          const off = i * 4;
          if (borderMap[i] === 1) {
            data[off] = 24;
            data[off + 1] = 24;
            data[off + 2] = 32;
            data[off + 3] = 255;
          } else {
            const rId = regionMap[i];
            const pal = regionColor.get(rId);
            if (pal) {
              data[off] = pal.r;
              data[off + 1] = pal.g;
              data[off + 2] = pal.b;
              data[off + 3] = 255;
            } else {
              data[off] = 241;
              data[off + 1] = 245;
              data[off + 2] = 249;
              data[off + 3] = 255;
            }
          }
        }
        outCtx.putImageData(outImg, 0, 0);

        const dataUrl = outCanvas.toDataURL('image/png');
        return {
          dataUrl,
          regionCount: regions.length,
          colorCount: palette.length,
          width,
          height,
        };
      }, { imagePath: spec.image, config: spec.config });

      const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, '');
      const dest = path.join(OUT_DIR, `${spec.id}.png`);
      fs.writeFileSync(dest, Buffer.from(base64, 'base64'));
      console.log(
        `Generated ${spec.id}.png (${result.width}x${result.height}, ${result.regionCount} regions, ${result.colorCount} colors)`
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
