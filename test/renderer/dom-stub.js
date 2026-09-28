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
 * - elementProps:按 id 覆盖元素初始字段(段可从 index.html 解析出真实属性回填)
 * - selectorGroups:document.querySelectorAll 的选择器 → 元素表(radio 组成组靠它;
 *   未登记的选择器仍返回空数组,与历史段一致)
 *
 * 按选择器取元素走**段内注入**:被测代码若在**元素上**调 querySelector(而非
 * document 上调),由用例给该元素挂一个最小命中实现(见 StubElement.querySelector
 * 的「段内可注入最小探针节点」注记),不在本 stub 里做全局选择器表。
 * document 级选择器走上面的 selectorGroups。
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
export function makeClassList(initial = ["hidden"]) {
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
 * // inert(可聚焦性摘除):被测代码按折叠态写这个布尔;stub 不预置,由用例或被测代码赋值
 * @property {boolean} [inert]
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
 * // 数值型 input 的 number 视图:空串/非数值按浏览器语义给 NaN(不是 0),
 * // 被测代码靠它区分「空输入」与「真填了 0」(settings-bindings 的钳制分支)
 * @property {number} valueAsNumber
 * // select 的选中项集合:默认按 value 在子节点里推导(回填后读到的即当前选中项);
 * // 段内显式赋值即接管(既有段按「dom stub 未提供该成员」写的注入写法仍有效)
 * @property {StubNode[]} selectedOptions
 * @property {(event: { type: string }) => boolean} dispatchEvent
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
  /** 段内注入的 selectedOptions;未注入时按 value 在子节点里推导。 */
  /** @type {StubNode[] | null} */
  let selectedOverride = null;
  // 标注 any 断开自引用推断:getter 里读 el.value / el.children 会让 TS 无法定出
  // el 的类型(它在自己的初始化式里被引用);末尾再 cast 回 StubElement。
  /** @type {any} */
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
    get valueAsNumber() {
      // 与浏览器一致:value 恒为字符串(此处 String() 归一,容忍用例写入数字);
      // 空串与非数值都是 NaN(Number("") 会给 0,那会让「清空后输入」被读成 0,
      // 钳制分支就错了)
      const raw = String(el.value);
      return raw.trim() === "" || Number.isNaN(Number(raw)) ? Number.NaN : Number(raw);
    },
    get selectedOptions() {
      if (selectedOverride) return selectedOverride;
      const value = el.value;
      if (value === "") return [];
      return el.children.filter(
        (/** @type {StubNode} */ node) =>
          typeof node === "object" &&
          node !== null &&
          /** @type {{ value?: unknown }} */ (node).value === value,
      );
    },
    set selectedOptions(/** @type {StubNode[]} */ list) { selectedOverride = list; },
    /** 被测代码造事件派发自身(如 stepper 经 change 走既有校验/持久化链路);
     *  命中已登记监听器即调用,语义等价于浏览器在同元素上派发该类型事件。 */
    dispatchEvent(/** @type {{ type: string }} */ event) {
      const fn = listeners.get(event.type);
      if (typeof fn === "function") fn(event);
      return true;
    },
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
 * @param {(id: string) => (Partial<StubElement> | undefined)} [options.elementProps]
 *   元素**首次创建**时的初始字段覆盖(如从 index.html 解析出的 classList/checked);
 *   已存在的元素不再改写(跨段共享的元素表里前序段建的实例保持原样)
 * @param {Record<string, StubElement[]>} [options.selectorGroups]
 *   document.querySelectorAll 的选择器 → 命中元素。未登记的选择器仍返回空数组,
 *   与历史段行为一致(故既有段不受影响)
 */
export function installDomStub({
  api = {},
  activeElement = null,
  trackFocus = false,
  elementProps = undefined,
  selectorGroups = undefined,
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
      el = withFocus(makeElement({ id, ...(elementProps?.(id) ?? {}) }));
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
  // 选择器组里的元素不在元素表内(无 id 的 radio),同样补装焦点追踪
  for (const group of Object.values(selectorGroups ?? {})) for (const el of group) withFocus(el);

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
    querySelectorAll: (/** @type {string} */ selector) => selectorGroups?.[selector] ?? [],
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
