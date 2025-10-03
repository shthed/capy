const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const STARTER_SVGS = [
  'capybara-lagoon.svg',
  'capybara-twilight.svg',
  'lush-green-forest.svg',
];

function resolveSvgPath(fileName) {
  return path.join(__dirname, '..', 'art', fileName);
}

test.describe('starter SVG quality', () => {
  for (const fileName of STARTER_SVGS) {
    test(`${fileName} parses cleanly and passes quality checks`, async ({ page }) => {
      const svgPath = resolveSvgPath(fileName);
      const svgMarkup = await fs.promises.readFile(svgPath, 'utf8');

      await page.setContent('<!DOCTYPE html><html><body></body></html>');

      const result = await page.evaluate((markup) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(markup, 'image/svg+xml');
        const issues = [];

        const parserError = doc.querySelector('parsererror');
        if (parserError) {
          issues.push(
            `Parser error: ${parserError.textContent?.trim() || 'Unknown parser error'}`
          );
          return { ok: false, issues };
        }

        const svgEl = doc.querySelector('svg');
        if (!svgEl) {
          issues.push('Missing <svg> root element.');
          return { ok: false, issues };
        }

        const widthAttr = svgEl.getAttribute('width');
        const heightAttr = svgEl.getAttribute('height');
        const viewBoxAttr = svgEl.getAttribute('viewBox');
        const width = Number.parseFloat(widthAttr ?? '');
        const height = Number.parseFloat(heightAttr ?? '');
        if (!Number.isFinite(width) || width <= 0) {
          issues.push('Missing or invalid width attribute.');
        }
        if (!Number.isFinite(height) || height <= 0) {
          issues.push('Missing or invalid height attribute.');
        }
        if (!viewBoxAttr) {
          issues.push('Missing viewBox attribute.');
        } else {
          const parts = viewBoxAttr
            .trim()
            .split(/[ ,]+/)
            .map((part) => Number.parseFloat(part))
            .filter((value) => Number.isFinite(value));
          if (parts.length < 4) {
            issues.push('viewBox must contain four numeric values.');
          }
        }

        const titleEl = doc.querySelector('svg > title');
        const descEl = doc.querySelector('svg > desc');
        if (!titleEl || !titleEl.textContent?.trim()) {
          issues.push('Missing accessible <title> element.');
        }
        if (!descEl || !descEl.textContent?.trim()) {
          issues.push('Missing accessible <desc> element.');
        }

        const regionNodes = Array.from(doc.querySelectorAll('svg > g[data-cell-id]'));
        if (!regionNodes.length) {
          issues.push('No paintable regions were found.');
          return { ok: false, issues };
        }

        const regionIds = new Set();
        const cellIds = new Set();

        for (const group of regionNodes) {
          const regionId = group.getAttribute('id');
          if (!regionId) {
            issues.push('Every region group must include an id attribute.');
          } else if (regionIds.has(regionId)) {
            issues.push(`Duplicate region id detected: ${regionId}`);
          } else {
            regionIds.add(regionId);
          }

          const cellId = group.getAttribute('data-cell-id');
          if (!cellId || !/^c\d+$/i.test(cellId)) {
            issues.push(`Invalid data-cell-id on ${regionId || 'a region group'}.`);
          } else if (cellIds.has(cellId)) {
            issues.push(`Duplicate data-cell-id detected: ${cellId}`);
          } else {
            cellIds.add(cellId);
          }

          const colorId = group.getAttribute('data-color-id');
          if (!colorId || !colorId.toString().trim()) {
            issues.push(`Missing data-color-id on ${regionId || cellId || 'a region group'}.`);
          }

          const colorName = group.getAttribute('data-color-name');
          if (!colorName || !colorName.toString().trim()) {
            issues.push(`Missing data-color-name on ${regionId || cellId || 'a region group'}.`);
          }

          const colorHex = group.getAttribute('data-color-hex');
          if (!colorHex || !/^#(?:[0-9a-f]{3}){1,2}$/i.test(colorHex.trim())) {
            issues.push(`Missing or invalid data-color-hex on ${regionId || cellId || 'a region group'}.`);
          }

          const title = group.querySelector('title');
          if (!title || !title.textContent?.trim()) {
            issues.push(`Missing region <title> for ${regionId || cellId || 'a region group'}.`);
          }

          const pathNodes = [];
          if (group.tagName.toLowerCase() === 'path') {
            pathNodes.push(group);
          }
          group.querySelectorAll('path').forEach((pathEl) => {
            pathNodes.push(pathEl);
          });

          if (!pathNodes.length) {
            issues.push(`Region ${regionId || cellId || 'unknown'} is missing path geometry.`);
          }

          for (const pathEl of pathNodes) {
            const d = pathEl.getAttribute('d');
            if (!d || !d.trim()) {
              issues.push(`A path inside ${regionId || cellId || 'a region group'} is missing d data.`);
            }
            const fill = pathEl.getAttribute('fill');
            if (fill && /^none$/i.test(fill.trim())) {
              issues.push(`A path inside ${regionId || cellId || 'a region group'} uses fill="none".`);
            }
          }
        }

        return { ok: issues.length === 0, issues };
      }, svgMarkup);

      expect(result.ok, result.issues.join('\n')).toBeTruthy();
    });
  }
});
