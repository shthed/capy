import test from 'node:test';
import assert from 'node:assert/strict';

import { createSvgRenderer } from '../../render.js';

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

test('setImageSource syncs viewBox to source dimensions', () => {
  const previousDocument = global.document;
  try {
    const document = new FakeDocument();
    const container = new FakeElement('div');
    const host = new FakeElement('canvas');
    host.clientWidth = 200;
    host.clientHeight = 120;
    host.parentElement = container;

    global.document = document;
    const renderer = createSvgRenderer(host);

    renderer.setImageSource('data:image/png;base64,', 800, 600);

    assert.equal(renderer.svg.getAttribute('viewBox'), '0 0 800 600');
    assert.equal(renderer.baseImage.getAttribute('width'), '800');
    assert.equal(renderer.baseImage.getAttribute('height'), '600');
    assert.equal(renderer.baseImage.style.display, '');
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
    const host = new FakeElement('canvas');
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
