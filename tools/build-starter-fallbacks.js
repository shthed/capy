#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const targets = [
  { id: 'starter-capybara-forest', file: path.join('art', 'capybara-forest.svg') },
  { id: 'starter-capybara-lagoon', file: path.join('art', 'capybara-lagoon.svg') },
  { id: 'starter-twilight-marsh', file: path.join('art', 'capybara-twilight.svg') },
  { id: 'starter-lush-forest', file: path.join('art', 'lush-green-forest.svg') },
];

const lines = [];
lines.push('(function () {');
lines.push('  const fallbackSvgs = {');

for (let i = 0; i < targets.length; i += 1) {
  const target = targets[i];
  const svgPath = path.join(projectRoot, target.file);
  if (!fs.existsSync(svgPath)) {
    throw new Error(`Unable to locate ${target.file} while building inline fallbacks.`);
  }
  const svg = fs.readFileSync(svgPath, 'utf8').replace(/`/g, '\\`');
  const comma = i === targets.length - 1 ? '' : ',';
  lines.push(`    "${target.id}": String.raw\`${svg}\`${comma}`);
}

lines.push('  };');
lines.push('  const globalStore = (window.__starterSvgFallbacks = window.__starterSvgFallbacks || {});');
lines.push('  Object.assign(globalStore, fallbackSvgs);');
lines.push('  const applyMarker = () => {');
lines.push("    if (typeof document !== 'undefined' && document.body) {");
lines.push("      document.body.setAttribute('data-inline-fallbacks', Object.keys(globalStore).join(','));");
lines.push('    }');
lines.push('  };');
lines.push("  if (typeof document !== 'undefined' && document.readyState === 'loading') {");
lines.push("    document.addEventListener('DOMContentLoaded', applyMarker, { once: true });");
lines.push('  } else {');
lines.push('    applyMarker();');
lines.push('  }');
lines.push('})();');

fs.writeFileSync(path.join(projectRoot, 'art', 'starter-fallbacks.js'), `${lines.join('\n')}\n`, 'utf8');

console.log('Updated art/starter-fallbacks.js with embedded SVG fallbacks.');
