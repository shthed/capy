import test from 'node:test';
import assert from 'node:assert/strict';

import '../../capy.js';

const { createSvgRenderer } = globalThis.capyRenderer || {};

class FakeElement {
  constructor(tagName, namespaceURI = null) {
    this.tagName = tagName;
    this.namespaceURI = namespaceURI;
    this.attributes = new Map();
    this.children = [];
    this.style = {};
    this.parentElement = null;
    this.clientWidth = 0;
    this.clientHeight = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(node) {
    if (node) {
      node.parentElement = this;
      node.parentNode = this;
      this.children.push(node);
    }
    return node;
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) {
      this.children.splice(index, 1);
      node.parentElement = null;
      node.parentNode = null;
    }
    return node;
  }

  insertAdjacentElement(_position, node) {
    return this.appendChild(node);
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }
}

class FakeDocument {
  createElementNS(namespaceURI, tagName) {
    return new FakeElement(tagName, namespaceURI);
  }
}

test('renderFrame draws simple shapes', () => {
  const previousDocument = global.document;
  try {
    const document = new FakeDocument();
    const container = new FakeElement('div');
    const host = new FakeElement('div');
    host.clientWidth = 200;
    host.clientHeight = 120;
    host.parentElement = container;

    global.document = document;
    const renderer = createSvgRenderer(host);

    renderer.renderFrame({
      state: {
        puzzle: {
          palette: [{ id: 1, hex: '#ff0000' }],
        },
        filled: new Set([7]),
      },
      cache: {
        regions: [
          { id: 7, colorId: 1, pathData: 'M0 0 L10 0 L10 10 Z' },
          { id: 8, colorId: 1, pathData: 'M20 0 L30 0 L30 10 Z' },
        ],
      },
      backgroundColor: '#ffffff',
      defaultBackgroundColor: '#ffffff',
    });

    const paths = renderer.svg.children[1].children;
    assert.equal(paths.length, 2);
    assert.equal(paths[0].getAttribute('fill'), '#ff0000');
    assert.equal(paths[1].getAttribute('fill'), 'rgba(248, 250, 252, 1)');
  } finally {
    global.document = previousDocument;
  }
});

test('dispose restores the container position when modified', () => {
  const previousDocument = global.document;
  try {
    const document = new FakeDocument();
    const container = new FakeElement('div');
    container.style.position = 'static';
    const host = new FakeElement('div');
    host.clientWidth = 100;
    host.clientHeight = 100;
    host.parentElement = container;

    global.document = document;
    const renderer = createSvgRenderer(host);

    assert.equal(container.style.position, 'relative');

    renderer.dispose();

    assert.equal(container.style.position, 'static');
  } finally {
    global.document = previousDocument;
  }
});
