// @ts-check
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
 *
 * 能力按需开启(默认关):
 * - trackFocus:focus() 真的改写 document.activeElement(焦点落点/归还断言用)
 *
 * 按选择器取元素走**段内注入**:被测代码若在元素上调 querySelector(而非
 * document 上调),由用例给该元素挂一个最小命中实现(见 StubElement.querySelector
 * 的「段内可注入最小探针节点」注记),不在本 stub 里做全局选择器表。
 */

/**
 * 读全局槽位(如 document / window / 跨段共享宿主)。
 *
 * 放宽理由:Node 段以最小 stub 顶替浏览器全局,stub 只实现被测路径触及的成员,
 * 完整 DOM 全局契约由浏览器提供;这些键也不在 lib.dom 的 Window 类型上,
 * 故按运行期键名读写(而非把 stub 当完整 Window/Document 赋值)。
 *
 * @param {string} name
 * @returns {unknown}
 */
export function globalSlot(name) {
  const scope = /** @type {Record<string, unknown>} */ (globalThis);
  return scope[name];
}

/**
 * 写全局槽位(安装/复位 stub 用);放宽理由同 globalSlot。
 * @param {string} name
 * @param {unknown} value
 * @returns {void}
 */
export function setGlobalSlot(name, value) {
  const scope = /** @type {Record<string, unknown>} */ (globalThis);
  scope[name] = value;
}

/**
 * classList stub:只实现被测代码触及的成员。
 * @typedef {object} StubClassList
 * @property {(...names: string[]) => void} add
 * @property {(...names: string[]) => void} remove
 * @property {(name: string) => boolean} contains
 * @property {(name: string, force?: boolean) => boolean} toggle
 * @property {Set<string>} values
 */

/**
 * @param {string[]} [initial]
 * @returns {StubClassList}
 */
function makeClassList(initial = ["hidden"]) {
  const values = new Set(initial);
  return {
    add: (/** @type {string[]} */ ...names) => names.forEach((n) => values.add(n)),
    remove: (/** @type {string[]} */ ...names) => names.forEach((n) => values.delete(n)),
    contains: (/** @type {string} */ name) => values.has(name),
    /**
     * @param {string} name
     * @param {boolean} [force]
     * @returns {boolean}
     */
    toggle(name, force) {
      const enabled = force ?? !values.has(name);
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    values,
  };
}

/**
 * 子节点:元素或文本(向导外壳按 h() 构建时会混排文本节点)。
 * @typedef {StubElement | string} StubNode
 */

/**
 * 子树查询的覆写位:段内可注入最小探针节点(只需承接 setAttribute,
 * 见 ui-interaction-guards 的图标路径探针)。
 * @typedef {{ setAttribute: (key: string, value: string) => void }} StubProbe
 */

/**
 * 元素 stub:实现被测 dist 模块触及的 DOM 成员;未列出的成员不提供
 * (真实浏览器契约在 dist 侧按需使用,本 stub 只覆盖被测路径)。
 * @typedef {object} StubElement
 * @property {StubClassList} classList
 * @property {Record<string, string>} dataset
 * @property {Record<string, string>} style
 * @property {StubNode[]} children
 * @property {string} textContent
 * @property {string} title
 * @property {string} value
 * @property {string} id
 * @property {string} className
 * @property {boolean} disabled
 * @property {boolean} hidden
 * @property {boolean} isConnected
 * // 勾选态:开关类控件由被测模块按需赋值(stub 不预置,故为可选)
 * @property {boolean} [checked]
 * @property {(type: string, fn: (...args: unknown[]) => unknown) => void} addEventListener
 * @property {(type: string) => void} removeEventListener
 * @property {(type: string) => boolean} hasListener
 * @property {(k: string, v: unknown) => void} setAttribute
 * @property {(k: string) => void} removeAttribute
 * @property {(k: string) => boolean} hasAttribute
 * @property {(k: string) => string | null} getAttribute
 * @property {() => void} focus
 * @property {() => void} remove
 * @property {(...nodes: StubNode[]) => void} append
 * @property {(node: StubNode) => StubNode} appendChild
 * @property {(...nodes: StubNode[]) => void} replaceChildren
 * @property {(selector: string) => StubProbe | null} querySelector
 * @property {(selector: string) => StubNode[]} querySelectorAll
 * @property {(selector: string) => StubNode | null} closest
 * @property {(node: StubNode) => boolean} contains
 * @property {() => { top: number; height: number }} getBoundingClientRect
 * @property {Map<string, (...args: unknown[]) => unknown>} listener
 * @property {Map<string, (...args: unknown[]) => unknown>} listeners
 * @property {Map<string, string>} attributes
 */

/**
 * setAttribute 契约:属性值同时回写到元素自身字段(dist 模块读 el.title / el.hidden 等)。
 * 元素 stub 是开放对象,属性名由被测代码在运行期给出(键集非静态契约)。
 * @param {StubElement} el
 * @param {string} key
 * @param {string} value
 * @returns {void}
 */
function setStubProp(el, key, value) {
  // 放宽理由:按被测代码给出的任意属性名回写字段,静态键集不可枚举。
  const open = /** @type {Record<string, unknown>} */ (el);
  open[key] = value;
}

/**
 * 元素工厂:props 用于按用例覆盖初始字段(如 id / dataset),其余走默认。
 * @param {Partial<StubElement>} [props]
 * @returns {StubElement}
 */
export function makeElement(props = {}) {
  /** @type {Map<string, (...args: unknown[]) => unknown>} */
  const listeners = new Map();
  /** @type {Map<string, string>} */
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
    addEventListener(/** @type {string} */ type, /** @type {(...args: unknown[]) => unknown} */ fn) {
      listeners.set(type, fn);
    },
    removeEventListener(/** @type {string} */ type) { listeners.delete(type); },
    hasListener(/** @type {string} */ type) { return listeners.has(type); },
    setAttribute(/** @type {string} */ k, /** @type {unknown} */ v) {
      attributes.set(k, String(v));
      setStubProp(/** @type {StubElement} */ (el), k, String(v));
    },
    removeAttribute(/** @type {string} */ k) { attributes.delete(k); },
    hasAttribute(/** @type {string} */ k) { return attributes.has(k); },
    getAttribute(/** @type {string} */ k) { return attributes.get(k) ?? null; },
    focus() {},
    remove() { el.isConnected = false; },
    append(/** @type {StubNode[]} */ ...nodes) { el.children.push(...nodes); },
    appendChild(/** @type {StubNode} */ node) { el.children.push(node); return node; },
    replaceChildren(/** @type {StubNode[]} */ ...nodes) { el.children = nodes; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    getBoundingClientRect() { return { top: 0, height: 0 }; },
    get listener() { return listeners; },
    get listeners() { return listeners; },
    get attributes() { return attributes; },
  };
  return /** @type {StubElement} */ (el);
}

/**
 * 触发元素上登记的监听器(单类型单槽,与既有段一致)。
 * @param {StubElement} el
 * @param {string} type
 * @param {unknown} [event]
 * @returns {unknown}
 */
export function fireListener(el, type, event) {
  const map = el.listeners ?? el.listener;
  const fn = map?.get(type);
  if (typeof fn !== "function") {
    throw new Error(`元素 #${el.id ?? "?"} 未登记 ${type} 监听器(绑定是否仍挂在该元素?)`);
  }
  return fn(event);
}

/**
 * 合成键盘事件:记录 stopPropagation / preventDefault,供边界断言。
 * preventDefaultCalled 与 defaultPrevented 一同初始化(此前只在 preventDefault()
 * 首次调用时隐式建键),stub 的可观察状态不变。
 * @param {string} key
 * @param {unknown} target
 * @param {Partial<StubKeyEvent>} [extra]
 * @returns {StubKeyEvent}
 */
export function makeKeyEvent(key, target, extra = {}) {
  return {
    key,
    target,
    altKey: false,
    defaultPrevented: false,
    preventDefaultCalled: false,
    propagationStopped: false,
    stopPropagation() { this.propagationStopped = true; },
    preventDefault() { this.preventDefaultCalled = true; this.defaultPrevented = true; },
    ...extra,
  };
}

/**
 * 合成键盘事件形状。
 * @typedef {object} StubKeyEvent
 * @property {string} key
 * @property {unknown} target
 * @property {boolean} altKey
 * @property {boolean} defaultPrevented
 * @property {boolean} preventDefaultCalled
 * @property {boolean} propagationStopped
 * @property {() => void} stopPropagation
 * @property {() => void} preventDefault
 */

/**
 * 跨段共享的 stub 宿主:元素表与 window 监听器表(见文件头「跨段共享约定」)。
 * @typedef {object} DomStubHost
 * @property {Map<string, StubElement>} elements
 * @property {Map<string, ((...args: unknown[]) => unknown)[]>} windowListeners
 * @property {StubElement[]} created
 */

/**
 * 安装 stub:返回元素表、创建元素流水(window 供动态构建的模块追加节点)、
 * document/window 与 restore()。api 由调用方按用例补齐。
 *
 * ⚠️ 本 stub 是**契约面**:新增 DOM 接口调用前须确认本 stub(或段内自建 stub)
 * 提供了该方法,否则会在段内抛错,并表现为一条与该改动毫不相干的断言失败
 * (真实案例:某段元素 stub 无 removeAttribute,被测代码里的属性摘除抛
 * TypeError,最终报出的是「付印应执行两次合并」)。已实现成员见 StubElement。
 *
 * @param {object} [options]
 * @param {Record<string, unknown>} [options.api] preload 面按用例补齐
 * @param {StubElement | null} [options.activeElement] 焦点初始落点
 * @param {boolean} [options.trackFocus] 开启焦点追踪(见下),默认关
 */
export function installDomStub({
  api = {},
  activeElement = null,
  trackFocus = false,
} = {}) {
  const originalDocument = globalSlot("document");
  const originalWindow = globalSlot("window");
  // 前序段可能已建 host(且未带 created 流水)——按需补齐,共享同一实例
  const existing = globalSlot("__m2wRendererDomStub");
  /** @type {DomStubHost} */
  const host = /** @type {DomStubHost} */ (existing ?? {
    elements: new Map(),
    windowListeners: new Map(),
    created: [],
  });
  host.elements ??= new Map();
  host.windowListeners ??= new Map();
  host.created ??= [];
  setGlobalSlot("__m2wRendererDomStub", host);

  /**
   * 焦点落点:trackFocus 开启时是真的可变状态,focus() 会改写 document.activeElement,
   * 焦点落点/归还类断言才有着落;默认关闭时 focus() 保持空操作(历史段只关心
   * 「有没有调 focus」,不关心落到哪)。
   */
  let currentActive = /** @type {StubElement} */ (activeElement ?? host.elements.get("__active__") ?? null);

  /**
   * 给元素装上「真的落焦」的 focus()。跨段共享的元素表里可能已有前序段造的
   * 元素(其 focus 是空操作),故对存量元素一并补装。
   * ⚠️ 直接用导出的 makeElement 造的元素不在元素表里、拿不到这层装配 ——
   * 段内自造的探针元素若也要参与焦点断言,须显式过一次本函数。
   * @param {StubElement} el
   * @returns {StubElement}
   */
  const withFocus = (el) => {
    if (!trackFocus) return el;
    el.focus = () => {
      currentActive = el;
    };
    return el;
  };

  /** @param {string} id @returns {StubElement} */
  const elementFor = (id) => {
    let el = host.elements.get(id);
    if (!el) {
      el = withFocus(makeElement({ id }));
      host.elements.set(id, el);
    }
    return el;
  };

  const createTracked = () => {
    const el = withFocus(makeElement());
    host.created.push(el);
    return el;
  };

  // 存量元素(前序段所建)补装焦点追踪
  for (const el of host.elements.values()) withFocus(el);

  /** @type {Map<string, (...args: unknown[]) => unknown>} */
  const documentListeners = new Map();
  const fakeDocument = {
    get activeElement() {
      return currentActive;
    },
    set activeElement(el) {
      currentActive = /** @type {StubElement} */ (el);
    },
    documentElement: elementFor("__documentElement__"),
    body: elementFor("__body__"),
    getElementById: elementFor,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: createTracked,
    createElementNS: createTracked,
    addEventListener(/** @type {string} */ type, /** @type {(...args: unknown[]) => unknown} */ fn) {
      documentListeners.set(type, fn);
    },
    removeEventListener(/** @type {string} */ type) { documentListeners.delete(type); },
  };

  const fakeWindow = {
    api: {
      ...api,
    },
    setTimeout,
    clearTimeout,
    addEventListener(/** @type {string} */ type, /** @type {(...args: unknown[]) => unknown} */ fn) {
      const list = host.windowListeners.get(type) ?? [];
      list.push(fn);
      host.windowListeners.set(type, list);
    },
    removeEventListener(/** @type {string} */ type) { host.windowListeners.delete(type); },
  };

  setGlobalSlot("document", fakeDocument);
  setGlobalSlot("window", fakeWindow);

  return {
    elements: host.elements,
    created: host.created,
    document: fakeDocument,
    window: fakeWindow,
    elementFor,
    withFocus,
    documentListeners,
    restore() {
      setGlobalSlot("document", originalDocument);
      setGlobalSlot("window", originalWindow);
    },
  };
}

/** 触发 window 级监听(unload 等)。 */
export function fireWindow(/** @type {string} */ type) {
  const host = /** @type {DomStubHost | undefined} */ (globalSlot("__m2wRendererDomStub"));
  for (const fn of host?.windowListeners.get(type) ?? []) fn();
}
