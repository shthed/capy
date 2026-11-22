import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export async function runSettingsDecompositionTests(vite) {
  const typesMod = await vite.ssrLoadModule('/src/types/index.ts');
  const presetMod = await vite.ssrLoadModule('/src/data/presetGallery.ts');
  const toggleMod = await vite.ssrLoadModule('/src/components/settings/SettingToggleRow.tsx');
  const controlsMod = await vite.ssrLoadModule('/src/components/SettingsControls.tsx');
  const sliderMod = await vite.ssrLoadModule('/src/components/settings/SettingSliderRow.tsx');
  const cardMod = await vite.ssrLoadModule('/src/components/settings/SnapshotCard.tsx');

  // 1. Structural contract: SettingsModal.tsx < 250 LOC and SettingsModalProps <= 8 top-level fields
  const settingsModalSrc = fs.readFileSync(
    path.join(projectRoot, 'src/components/SettingsModal.tsx'),
    'utf8'
  );
  const settingsModalLoc = settingsModalSrc.split(/\r?\n/).length;
  assert.equal(
    settingsModalLoc < 250,
    true,
    `SettingsModal.tsx must be a thin shell < 250 LOC (got ${settingsModalLoc})`
  );

  const settingsTypesSrc = fs.readFileSync(
    path.join(projectRoot, 'src/components/settings/types.ts'),
    'utf8'
  );
  const propsBlockMatch = /export interface SettingsModalProps\s*\{([\s\S]*?)\}/m.exec(
    settingsTypesSrc
  );
  assert.ok(propsBlockMatch, 'SettingsModalProps must be exported from settings/types.ts');
  const topLevelPropCount = propsBlockMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//')).length;
  assert.equal(
    topLevelPropCount <= 8,
    true,
    `SettingsModalProps must expose <= 8 top-level props (got ${topLevelPropCount})`
  );

  // 2. presetGallery.ts invariants
  const { GALLERY_FILTER_TAGS, PRESET_GALLERY_ITEMS, STANDARD_RESOLUTIONS } = presetMod;
  const { DEFAULT_GENERATOR_CONFIG } = typesMod;
  assert.equal(Array.isArray(GALLERY_FILTER_TAGS) && GALLERY_FILTER_TAGS[0] === 'All', true);
  assert.equal(PRESET_GALLERY_ITEMS.length, 10, 'Expected 10 preset gallery items');
  assert.equal(STANDARD_RESOLUTIONS.length >= 6, true, 'Expected standard resolution presets');

  const seenIds = new Set();
  const validCategories = new Set(['ALGORITHM', 'BORDER', 'DETAIL']);
  for (const item of PRESET_GALLERY_ITEMS) {
    assert.equal(seenIds.has(item.id), false, `Duplicate preset id: ${item.id}`);
    seenIds.add(item.id);
    assert.equal(
      validCategories.has(item.category),
      true,
      `Invalid category for ${item.id}: ${item.category}`
    );
    assert.equal(
      /^\.\/assets\/presets\/[a-z0-9-]+\.png$/.test(item.image),
      true,
      `Preset image path must be relative ./assets/presets/*.png (got ${item.image})`
    );
    const applied = item.apply({ ...DEFAULT_GENERATOR_CONFIG });
    assert.equal(
      item.isMatch(applied),
      true,
      `Preset ${item.id} must satisfy isMatch(apply(DEFAULT_GENERATOR_CONFIG)) === true`
    );
  }

  // 3. SettingToggleRow / SettingSwitchRow single source of truth & markup contract
  const { SettingToggleRow } = toggleMod;
  const { SettingSwitchRow } = controlsMod;
  assert.equal(
    SettingToggleRow,
    SettingSwitchRow,
    'SettingsControls.SettingSwitchRow must re-export SettingToggleRow as a single source of truth'
  );

  const toggleHtml = renderToStaticMarkup(
    React.createElement(SettingToggleRow, {
      label: 'Reduced Motion',
      description: 'Skip animations',
      badge: 'Active',
      checked: true,
      disabled: true,
      testId: 'setting-test-toggle',
      onToggle: () => {},
    })
  );
  assert.ok(toggleHtml.includes('role="switch"'), 'SettingToggleRow must render role="switch"');
  assert.ok(toggleHtml.includes('aria-checked="true"'), 'SettingToggleRow must set aria-checked');
  assert.ok(
    toggleHtml.includes('aria-label="Reduced Motion"'),
    'SettingToggleRow must set aria-label'
  );
  assert.ok(
    toggleHtml.includes('data-testid="setting-test-toggle"'),
    'SettingToggleRow must forward data-testid'
  );
  assert.ok(toggleHtml.includes('capy-switch'), 'SettingToggleRow must preserve .capy-switch');
  assert.ok(
    toggleHtml.includes('capy-switch-knob'),
    'SettingToggleRow must preserve .capy-switch-knob'
  );
  assert.ok(toggleHtml.includes('disabled=""') || toggleHtml.includes('disabled '), 'disabled attr');
  assert.ok(toggleHtml.includes('Active'), 'SettingToggleRow must render optional badge');
  assert.ok(toggleHtml.includes('Skip animations'), 'SettingToggleRow must render description');

  // 4. SettingSliderRow accessible label/input pairing + disabled vs dimmed modes
  const { SettingSliderRow } = sliderMod;
  const dimmedSliderHtml = renderToStaticMarkup(
    React.createElement(SettingSliderRow, {
      label: 'Finger Reach Radius',
      valueLabel: '22px',
      valueTestId: 'reach-val',
      testId: 'reach-input',
      containerTestId: 'reach-container',
      min: 8,
      max: 40,
      step: 1,
      value: 22,
      dimmed: true,
      onChange: () => {},
    })
  );
  const forMatch = /<label\s+for="([^"]+)"/.exec(dimmedSliderHtml);
  const idMatch = /<input[^>]*\sid="([^"]+)"/.exec(dimmedSliderHtml);
  assert.ok(forMatch && idMatch, 'SettingSliderRow must render <label for> and <input id>');
  assert.equal(forMatch[1], idMatch[1], 'SettingSliderRow label for must match input id');
  assert.ok(
    dimmedSliderHtml.includes('aria-label="Finger Reach Radius"'),
    'SettingSliderRow must include aria-label'
  );
  assert.ok(
    dimmedSliderHtml.includes('opacity-50'),
    'Dimmed SettingSliderRow must apply opacity-50'
  );
  assert.ok(
    dimmedSliderHtml.includes('data-dimmed="true"'),
    'Dimmed SettingSliderRow must set data-dimmed="true"'
  );
  assert.equal(
    /<input[^>]*\sdisabled\b/.test(dimmedSliderHtml),
    false,
    'Dimmed SettingSliderRow must remain interactive (not HTML disabled)'
  );

  const disabledSliderHtml = renderToStaticMarkup(
    React.createElement(SettingSliderRow, {
      label: 'Sound Volume',
      valueLabel: 'Muted',
      min: 0,
      max: 1,
      step: 0.05,
      value: 0.7,
      disabled: true,
      onChange: () => {},
    })
  );
  assert.equal(
    /<input[^>]*\sdisabled(?:\s|=|>)/.test(disabledSliderHtml),
    true,
    'Disabled SettingSliderRow must set HTML disabled on input'
  );
  assert.ok(
    disabledSliderHtml.includes('opacity-50'),
    'Disabled SettingSliderRow must apply opacity-50'
  );

  // 5. SnapshotCard unified detail & grid variants + safe thumbnail resolution
  const { SnapshotCard } = cardMod;
  const safeSampleAssetPath = typesMod.SAMPLE_GALLERY[0].assetPath;
  const baseSnap = {
    id: 'snap-1',
    title: 'Capy Forest',
    timestamp: 1700000000000,
    lastOpened: 1700000000000,
    filledCount: 5,
    totalCount: 10,
    isPinned: true,
    fileSizeBytes: 20480,
    sampleAssetPath: safeSampleAssetPath,
    previewDataUrl: 'javascript:alert(1)',
  };

  const detailHtml = renderToStaticMarkup(
    React.createElement(SnapshotCard, {
      snapshot: baseSnap,
      variant: 'detail',
      isActive: true,
      isSelected: true,
      failedThumbSrcs: {},
      onThumbError: () => {},
      onClick: () => {},
      onDoubleClick: () => {},
    })
  );
  assert.ok(detailHtml.includes('data-testid="save-card-snap-1"'), 'detail card testid');
  assert.ok(detailHtml.includes('50%'), 'detail card progress percentage');
  assert.ok(detailHtml.includes('20 KB'), 'detail card file size');
  assert.ok(
    detailHtml.includes(`src="${safeSampleAssetPath}"`),
    'detail card must use safe sample asset path'
  );
  assert.equal(
    detailHtml.includes('javascript:'),
    false,
    'SnapshotCard must never render unsafe javascript: preview URLs'
  );

  const gridFallbackHtml = renderToStaticMarkup(
    React.createElement(SnapshotCard, {
      snapshot: { ...baseSnap, sampleAssetPath: undefined, previewDataUrl: 'http://evil.example/x.png' },
      variant: 'grid',
      isActive: false,
      isSelected: false,
      failedThumbSrcs: {},
      onThumbError: () => {},
      onClick: () => {},
      onDoubleClick: () => {},
    })
  );
  assert.ok(gridFallbackHtml.includes('data-testid="save-card-snap-1"'), 'grid card testid');
  assert.equal(
    gridFallbackHtml.includes('<img'),
    false,
    'SnapshotCard must fall back to icon placeholder when no safe thumbnail is available'
  );
  assert.equal(
    gridFallbackHtml.includes('http://evil.example'),
    false,
    'SnapshotCard must reject unsafe http: thumbnail URLs'
  );
}
