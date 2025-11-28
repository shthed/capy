export const capybaraFixture = Object.freeze({
  title: 'Fixture: Capybara Springs sketch',
  width: 4,
  height: 4,
  paletteMeta: { source: 'fixtures' },
  palette: [
    { id: 1, hex: '#8fb1d1', name: 'Sky' },
    { id: 2, hex: '#513421', name: 'Fur' },
  ],
  regions: [
    { id: 0, colorId: 1, pixelCount: 8, cx: 1.25, cy: 0.75 },
    { id: 1, colorId: 2, pixelCount: 8, cx: 2.75, cy: 2.75 },
  ],
  regionMap: [
    0, 0, 0, 0,
    0, 0, 1, 1,
    1, 1, 1, 1,
    1, 1, 1, 1,
  ],
  backgroundColor: '#f8fafc',
  viewport: {
    x: 0,
    y: 0,
    width: 4,
    height: 4,
  },
});
