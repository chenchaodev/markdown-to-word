/**
 * renderer 段共用 DOM stub(dist renderer 模块在 Node 段直接 import,需要一个最小 DOM)。
 *
 * 跨段共享约定(与 convert-command-lock 段同款):dist 模块在一个进程内只 import 一次,
 * dom/refs 的元素解析发生在首个 import 段;后跑的段若自建 document,拿到的将是另一批
 * 元素,监听器/断言都对不上。故元素表与 window 监听器表挂在
 * globalThis.__m2wRendererDomStub 上复用,getElementById 始终命中同一批实例。
 *
 * 元素工厂接口保持与既有段兼容(listener 单类型单槽),另加本段需要的
 * children / attributes / remove / isConnected / fire 等钩子。
 */

function makeClassList(initial = ["hidden"]) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((n) => values.add(n)),
    remove: (...names) => names.forEach((n) => values.delete(n)),
    contains: (name) => values.has(name),
    toggle(name, force) {
      const enabled = force ?? !values.has(name);
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    values,
  };
}

export function makeElement(props = {}) {
  const listeners = new Map();
  const attributes = new Map();
  const el = {
    classList: makeClassList(),
    dataset: {},
    style: {},
    children: [],
    textContent: "",
    title: "",
    value: "",
    id: "",
    className: "",
    disabled: false,
    hidden: false,
    isConnected: true,
    ...props,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    hasListener(type) { return listeners.has(type); },
    setAttribute(k, v) { attributes.set(k, String(v)); el[k] = String(v); },
    removeAttribute(k) { attributes.delete(k); },
    hasAttribute(k) { return attributes.has(k); },
    getAttribute(k) { return attributes.get(k) ?? null; },
    focus() {},
    remove() { el.isConnected = false; },
    append(...nodes) { el.children.push(...nodes); },
    appendChild(node) { el.children.push(node); return node; },
    replaceChildren(...nodes) { el.children = nodes; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    getBoundingClientRect() { return { top: 0, height: 0 }; },
    get listener() { return listeners; },
    get listeners() { return listeners; },
    get attributes() { return attributes; },
  };
  return el;
}

/** 触发元素上登记的监听器(单类型单槽,与既有段一致)。 */
export function fireListener(el, type, event) {
  const map = el.listeners ?? el.listener;
  const fn = map?.get(type);
  if (typeof fn !== "function") {
    throw new Error(`元素 #${el.id ?? "?"} 未登记 ${type} 监听器(绑定是否仍挂在该元素?)`);
  }
  return fn(event);
}

/** 合成键盘事件:记录 stopPropagation / preventDefault,供边界断言。 */
export function makeKeyEvent(key, target, extra = {}) {
  return {
    key,
    target,
    altKey: false,
    defaultPrevented: false,
    propagationStopped: false,
    stopPropagation() { this.propagationStopped = true; },
    preventDefault() { this.preventDefaultCalled = true; this.defaultPrevented = true; },
    ...extra,
  };
}

/**
 * 安装 stub:返回元素表、创建元素流水(window 供动态构建的模块追加节点)、
 * document/window 与 restore()。api 由调用方按用例补齐。
 */
export function installDomStub({ api = {}, activeElement = null } = {}) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const host = (globalThis.__m2wRendererDomStub ??= {
    elements: new Map(),
    windowListeners: new Map(),
    created: [],
  });
  // 前序段可能已建 host(且未带 created 流水)——按需补齐,共享同一实例
  host.elements ??= new Map();
  host.windowListeners ??= new Map();
  host.created ??= [];

  const elementFor = (id) => {
    let el = host.elements.get(id);
    if (!el) {
      el = makeElement({ id });
      host.elements.set(id, el);
    }
    return el;
  };

  const createTracked = () => {
    const el = makeElement();
    host.created.push(el);
    return el;
  };

  const documentListeners = new Map();
  const fakeDocument = {
    activeElement: activeElement ?? elementFor("__active__"),
    documentElement: elementFor("__documentElement__"),
    body: elementFor("__body__"),
    getElementById: elementFor,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: createTracked,
    createElementNS: createTracked,
    addEventListener(type, fn) { documentListeners.set(type, fn); },
    removeEventListener(type) { documentListeners.delete(type); },
  };

  const fakeWindow = {
    api: {
      ...api,
    },
    setTimeout,
    clearTimeout,
    addEventListener(type, fn) {
      const list = host.windowListeners.get(type) ?? [];
      list.push(fn);
      host.windowListeners.set(type, list);
    },
    removeEventListener(type) { host.windowListeners.delete(type); },
  };

  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;

  return {
    elements: host.elements,
    created: host.created,
    document: fakeDocument,
    window: fakeWindow,
    elementFor,
    documentListeners,
    restore() {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
    },
  };
}

/** 触发 window 级监听(unload 等)。 */
export function fireWindow(type) {
  const host = globalThis.__m2wRendererDomStub;
  for (const fn of host?.windowListeners.get(type) ?? []) fn();
}
