// Unit-level event wiring only. This is not a DOM implementation or browser evidence.
export function fakeDocument(html, lang) {
  const nodes = new Map(), radios = [], events = new Map(), downloads = [];
  const doc = {
    documentElement: { lang }, activeElement: null, downloads,
    getElementById: id => nodes.get(id),
    querySelectorAll: () => radios,
    createElement: tag => new FakeElement(tag),
    defaultView: {
      addEventListener: (name, callback) => events.set(name, callback),
      removeEventListener: name => events.delete(name),
    },
    fireWindow: name => events.get(name)?.(),
  };
  class FakeElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.dataset = {};
      this.attributes = new Map(); this.listeners = new Map(); this.style = { setProperty(name, value) { this[name] = value; } };
      this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this.textContent = '';
    }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = undefined; }
    addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
    emit(name) { for (const callback of this.listeners.get(name) ?? []) callback({ target: this }); }
    click() { if (!this.disabled) { if (this.tagName === 'A') downloads.push({ href: this.href, filename: this.download }); this.emit('click'); } }
    focus() { doc.activeElement = this; } // Assign a field on a fake object; no OS/browser focus API.
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  }
  doc.body = new FakeElement('body');
  for (const match of html.matchAll(/<([a-z-]+)\b([^>]*)>/g)) {
    const [, tag, attrs] = match, id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    const node = new FakeElement(tag);
    node.hidden = /\bhidden\b/.test(attrs); node.disabled = /\bdisabled\b/.test(attrs); node.checked = /\bchecked\b/.test(attrs);
    if (id) { if (nodes.has(id)) throw Error('Duplicate id'); nodes.set(id, node); }
    const name = /\bname="([^"]+)"/.exec(attrs)?.[1], value = /\bvalue="([^"]+)"/.exec(attrs)?.[1];
    if (tag === 'input' && ['paper', 'direction'].includes(name)) { node.name = name; node.value = value; radios.push(node); }
  }
  doc.radios = radios;
  doc.changeRadio = value => {
    const radio = radios.find(node => node.value === value);
    for (const node of radios.filter(node => node.name === radio.name)) node.checked = node === radio;
    radio.emit('change');
  };
  return doc;
}
