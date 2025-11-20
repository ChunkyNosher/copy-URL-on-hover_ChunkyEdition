!function(e) {
  "use strict";
  const t = 5e3, n = [], i = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console)
  };
  function o(e, i) {
    n.length >= t && n.shift();
    const o = Array.from(i).map(e => {
      if ("object" == typeof e && null !== e) try {
        return JSON.stringify(e, null, 2);
      } catch (t) {
        return String(e);
      }
      return String(e);
    }).join(" ");
    n.push({
      type: e,
      timestamp: Date.now(),
      message: o,
      context: s()
    });
  }
  function s() {
    return "undefined" != typeof document && document.currentScript ? "content-script" : "undefined" != typeof browser && browser.runtime && browser.runtime.getBackgroundPage ? "background" : "undefined" != typeof window && window.location && "moz-extension:" === window.location.protocol ? "popup" : "unknown";
  }
  async function a(e) {
    try {
      return await browser.runtime.sendMessage(e);
    } catch (e) {
      throw console.error("[Browser API] Failed to send message to background:", e), e;
    }
  }
  async function r(e) {
    if (!e || "string" != typeof e) return console.error("[Browser API] Invalid text for clipboard:", e), 
    !1;
    try {
      return await navigator.clipboard.writeText(e), !0;
    } catch (t) {
      return console.error("[Browser API] Failed to copy to clipboard:", t), console.error("[Browser API] Text length:", e.length, "Preview:", e.substring(0, 50)), 
      function(e) {
        try {
          const t = document.createElement("textarea");
          t.value = e, t.style.position = "fixed", t.style.opacity = "0", document.body.appendChild(t), 
          t.select();
          const n = document.execCommand("copy");
          return document.body.removeChild(t), n || console.error("[Browser API] execCommand copy returned false"), 
          n;
        } catch (e) {
          return console.error("[Browser API] Fallback copy also failed:", e), !1;
        }
      }(e);
    }
  }
  console.log = function(...e) {
    o("LOG", e), i.log.apply(console, e);
  }, console.error = function(...e) {
    o("ERROR", e), i.error.apply(console, e);
  }, console.warn = function(...e) {
    o("WARN", e), i.warn.apply(console, e);
  }, console.info = function(...e) {
    o("INFO", e), i.info.apply(console, e);
  }, console.debug = function(...e) {
    o("DEBUG", e), i.debug.apply(console, e);
  }, i.log("[Console Interceptor] ✓ Console methods overridden successfully"), i.log("[Console Interceptor] Buffer size:", t), 
  i.log("[Console Interceptor] Context:", s());
  const l = {
    copyUrlKey: "y",
    copyUrlCtrl: !1,
    copyUrlAlt: !1,
    copyUrlShift: !1,
    copyTextKey: "x",
    copyTextCtrl: !1,
    copyTextAlt: !1,
    copyTextShift: !1,
    openNewTabKey: "o",
    openNewTabCtrl: !1,
    openNewTabAlt: !1,
    openNewTabShift: !1,
    openNewTabSwitchFocus: !1,
    quickTabKey: "q",
    quickTabCtrl: !1,
    quickTabAlt: !1,
    quickTabShift: !1,
    quickTabCloseKey: "Escape",
    quickTabMaxWindows: 3,
    quickTabDefaultWidth: 800,
    quickTabDefaultHeight: 600,
    quickTabPosition: "follow-cursor",
    quickTabCustomX: 100,
    quickTabCustomY: 100,
    quickTabCloseOnOpen: !1,
    quickTabEnableResize: !0,
    quickTabUpdateRate: 360,
    showNotification: !0,
    notifDisplayMode: "tooltip",
    tooltipColor: "#4CAF50",
    tooltipDuration: 1500,
    tooltipAnimation: "fade",
    notifColor: "#4CAF50",
    notifDuration: 2e3,
    notifPosition: "bottom-right",
    notifSize: "medium",
    notifBorderColor: "#000000",
    notifBorderWidth: 1,
    notifAnimation: "slide",
    debugMode: !1,
    darkMode: !0,
    menuSize: "medium"
  }, c = 1e6, d = {
    QUICK_TAB_CREATED: "quickTab:created",
    QUICK_TAB_CLOSED: "quickTab:closed",
    QUICK_TAB_MINIMIZED: "quickTab:minimized",
    QUICK_TAB_RESTORED: "quickTab:restored",
    QUICK_TAB_PINNED: "quickTab:pinned",
    QUICK_TAB_UNPINNED: "quickTab:unpinned",
    QUICK_TAB_MOVED: "quickTab:moved",
    QUICK_TAB_RESIZED: "quickTab:resized",
    QUICK_TAB_ALL_CLOSED: "quickTab:allClosed",
    QUICK_TAB_REQUESTED: "quickTab:requested",
    QUICK_TAB_FOCUS_CHANGED: "quickTab:focusChanged",
    PANEL_TOGGLED: "panel:toggled",
    PANEL_OPENED: "panel:opened",
    PANEL_CLOSED: "panel:closed",
    PANEL_MOVED: "panel:moved",
    PANEL_RESIZED: "panel:resized",
    URL_COPIED: "url:copied",
    TEXT_COPIED: "text:copied",
    LINK_OPENED: "link:opened",
    HOVER_START: "hover:start",
    HOVER_END: "hover:end",
    STORAGE_UPDATED: "storage:updated",
    STORAGE_SYNCED: "storage:synced",
    BROADCAST_RECEIVED: "broadcast:received",
    ERROR: "error",
    DRAG_START: "drag:start",
    DRAG_MOVE: "drag:move",
    DRAG_END: "drag:end",
    RESIZE_START: "resize:start",
    RESIZE_MOVE: "resize:move",
    RESIZE_END: "resize:end"
  };
  function h(e, t = {}, n = null) {
    const i = document.createElement(e);
    return Object.entries(t).forEach(([e, t]) => {
      if ("className" === e) i.className = t; else if ("style" === e && "object" == typeof t) Object.assign(i.style, t); else if (e.startsWith("on") && "function" == typeof t) {
        const n = e.substring(2).toLowerCase();
        i.addEventListener(n, t);
      } else i.setAttribute(e, t);
    }), n && ("string" == typeof n ? i.textContent = n : Array.isArray(n) ? n.forEach(e => {
      e instanceof Element ? i.appendChild(e) : "string" == typeof e && i.appendChild(document.createTextNode(e));
    }) : n instanceof Element && i.appendChild(n)), i;
  }
  function u(e, t) {
    return e && "function" == typeof e.get && e.get(t) || 0;
  }
  function g(e) {
    return "bounce" === e?.tooltipAnimation ? "cuo-anim-bounce" : "cuo-anim-fade";
  }
  const p = new class {
    constructor() {
      this.config = null, this.stateManager = null, this.styleInjected = !1;
    }
    init(e, t) {
      this.config = e, this.stateManager = t, console.log("[NotificationManager] Initializing..."), 
      this.injectStyles(), console.log("[NotificationManager] Initialized successfully");
    }
    injectStyles() {
      if (this.styleInjected) return;
      const e = document.createElement("style");
      e.id = "cuo-notification-styles", e.textContent = "\n/* Notification Animations */\n@keyframes slideInRight {\n  from {\n    transform: translateX(100%);\n    opacity: 0;\n  }\n  to {\n    transform: translateX(0);\n    opacity: 1;\n  }\n}\n\n@keyframes slideInLeft {\n  from {\n    transform: translateX(-100%);\n    opacity: 0;\n  }\n  to {\n    transform: translateX(0);\n    opacity: 1;\n  }\n}\n\n@keyframes fadeIn {\n  from {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n\n@keyframes bounce {\n  0%,\n  100% {\n    transform: translateY(0);\n  }\n  50% {\n    transform: translateY(-10px);\n  }\n}\n\n/* Animation Classes */\n.cuo-anim-slide {\n  animation: slideInRight 0.3s ease-out;\n}\n\n.cuo-anim-fade {\n  animation: fadeIn 0.3s ease-out;\n}\n\n.cuo-anim-bounce {\n  animation: bounce 0.5s ease-out;\n}\n\n/* Tooltip Base Styles */\n.cuo-tooltip {\n  position: fixed;\n  background-color: #333;\n  color: white;\n  padding: 8px 12px;\n  border-radius: 4px;\n  font-size: 14px;\n  z-index: 999999999;\n  pointer-events: none;\n  opacity: 1;\n  transition: opacity 0.2s;\n}\n\n/* Toast Base Styles */\n.cuo-toast {\n  position: fixed;\n  background-color: #333;\n  color: white;\n  padding: 12px 20px;\n  border-radius: 4px;\n  font-size: 14px;\n  z-index: 999999998;\n  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);\n  border: 1px solid #444;\n  pointer-events: none;\n  opacity: 1;\n  transition: opacity 0.3s;\n}\n", 
      document.head.appendChild(e), this.styleInjected = !0, console.log("[NotificationManager] Styles injected from CSS module");
    }
    showNotification(e, t = "info") {
      this.config && this.config.showNotification ? (console.log("[NotificationManager] Showing notification:", e, t), 
      "tooltip" === this.config.notifDisplayMode ? this.showTooltip(e) : this.showToast(e, t)) : console.log("[NotificationManager] Notifications disabled");
    }
    showTooltip(e) {
      !function(e, t, n) {
        const i = document.getElementById("copy-url-tooltip");
        i && i.remove();
        const o = u(n, "lastMouseX"), s = u(n, "lastMouseY"), a = h("div", {
          id: "copy-url-tooltip",
          className: g(t),
          style: {
            position: "fixed",
            left: `${o + 10}px`,
            top: `${s + 10}px`,
            backgroundColor: t?.tooltipColor || "#333",
            color: "white",
            padding: "8px 12px",
            borderRadius: "4px",
            fontSize: "14px",
            zIndex: "999999999",
            pointerEvents: "none",
            opacity: "1"
          }
        }, e);
        document.body.appendChild(a), setTimeout(() => {
          a.style.opacity = "0", a.style.transition = "opacity 0.2s", setTimeout(() => a.remove(), 200);
        }, t?.tooltipDuration || 1e3), console.log("[Tooltip] Displayed:", e);
      }(e, this.config, this.stateManager);
    }
    showToast(e, t = "info") {
      !function(e, t, n) {
        const i = document.getElementById("copy-url-toast");
        i && i.remove();
        const o = {
          "top-left": {
            top: "20px",
            left: "20px"
          },
          "top-right": {
            top: "20px",
            right: "20px"
          },
          "bottom-left": {
            bottom: "20px",
            left: "20px"
          },
          "bottom-right": {
            bottom: "20px",
            right: "20px"
          }
        }, s = o[n?.notifPosition] || o["bottom-right"];
        let a = "cuo-anim-fade";
        "slide" === n?.notifAnimation ? a = "cuo-anim-slide" : "bounce" === n?.notifAnimation && (a = "cuo-anim-bounce");
        const r = parseInt(n?.notifBorderWidth) || 1, l = h("div", {
          id: "copy-url-toast",
          className: a,
          style: {
            position: "fixed",
            ...s,
            backgroundColor: n?.notifColor || "#333",
            color: "white",
            padding: "12px 20px",
            borderRadius: "4px",
            fontSize: "14px",
            zIndex: "999999998",
            boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
            border: `${r}px solid ${n?.notifBorderColor || "#444"}`,
            pointerEvents: "none",
            opacity: "1"
          }
        }, e);
        document.body.appendChild(l), setTimeout(() => {
          l.style.opacity = "0", l.style.transition = "opacity 0.3s", setTimeout(() => l.remove(), 300);
        }, n?.notifDuration || 2e3), console.log("[Toast] Displayed:", e);
      }(e, 0, this.config);
    }
    updateConfig(e) {
      this.config = e, console.log("[NotificationManager] Configuration updated");
    }
  };
  function f(e) {
    return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
  }
  var b = {
    exports: {}
  };
  !function(e) {
    var t = Object.prototype.hasOwnProperty, n = "~";
    function i() {}
    function o(e, t, n) {
      this.fn = e, this.context = t, this.once = n || !1;
    }
    function s(e, t, i, s, a) {
      if ("function" != typeof i) throw new TypeError("The listener must be a function");
      var r = new o(i, s || e, a), l = n ? n + t : t;
      return e._events[l] ? e._events[l].fn ? e._events[l] = [ e._events[l], r ] : e._events[l].push(r) : (e._events[l] = r, 
      e._eventsCount++), e;
    }
    function a(e, t) {
      0 === --e._eventsCount ? e._events = new i : delete e._events[t];
    }
    function r() {
      this._events = new i, this._eventsCount = 0;
    }
    Object.create && (i.prototype = Object.create(null), (new i).__proto__ || (n = !1)), 
    r.prototype.eventNames = function() {
      var e, i, o = [];
      if (0 === this._eventsCount) return o;
      for (i in e = this._events) t.call(e, i) && o.push(n ? i.slice(1) : i);
      return Object.getOwnPropertySymbols ? o.concat(Object.getOwnPropertySymbols(e)) : o;
    }, r.prototype.listeners = function(e) {
      var t = n ? n + e : e, i = this._events[t];
      if (!i) return [];
      if (i.fn) return [ i.fn ];
      for (var o = 0, s = i.length, a = new Array(s); o < s; o++) a[o] = i[o].fn;
      return a;
    }, r.prototype.listenerCount = function(e) {
      var t = n ? n + e : e, i = this._events[t];
      return i ? i.fn ? 1 : i.length : 0;
    }, r.prototype.emit = function(e, t, i, o, s, a) {
      var r = n ? n + e : e;
      if (!this._events[r]) return !1;
      var l, c, d = this._events[r], h = arguments.length;
      if (d.fn) {
        switch (d.once && this.removeListener(e, d.fn, void 0, !0), h) {
         case 1:
          return d.fn.call(d.context), !0;

         case 2:
          return d.fn.call(d.context, t), !0;

         case 3:
          return d.fn.call(d.context, t, i), !0;

         case 4:
          return d.fn.call(d.context, t, i, o), !0;

         case 5:
          return d.fn.call(d.context, t, i, o, s), !0;

         case 6:
          return d.fn.call(d.context, t, i, o, s, a), !0;
        }
        for (c = 1, l = new Array(h - 1); c < h; c++) l[c - 1] = arguments[c];
        d.fn.apply(d.context, l);
      } else {
        var u, g = d.length;
        for (c = 0; c < g; c++) switch (d[c].once && this.removeListener(e, d[c].fn, void 0, !0), 
        h) {
         case 1:
          d[c].fn.call(d[c].context);
          break;

         case 2:
          d[c].fn.call(d[c].context, t);
          break;

         case 3:
          d[c].fn.call(d[c].context, t, i);
          break;

         case 4:
          d[c].fn.call(d[c].context, t, i, o);
          break;

         default:
          if (!l) for (u = 1, l = new Array(h - 1); u < h; u++) l[u - 1] = arguments[u];
          d[c].fn.apply(d[c].context, l);
        }
      }
      return !0;
    }, r.prototype.on = function(e, t, n) {
      return s(this, e, t, n, !1);
    }, r.prototype.once = function(e, t, n) {
      return s(this, e, t, n, !0);
    }, r.prototype.removeListener = function(e, t, i, o) {
      var s = n ? n + e : e;
      if (!this._events[s]) return this;
      if (!t) return a(this, s), this;
      var r = this._events[s];
      if (r.fn) r.fn !== t || o && !r.once || i && r.context !== i || a(this, s); else {
        for (var l = 0, c = [], d = r.length; l < d; l++) (r[l].fn !== t || o && !r[l].once || i && r[l].context !== i) && c.push(r[l]);
        c.length ? this._events[s] = 1 === c.length ? c[0] : c : a(this, s);
      }
      return this;
    }, r.prototype.removeAllListeners = function(e) {
      var t;
      return e ? (t = n ? n + e : e, this._events[t] && a(this, t)) : (this._events = new i, 
      this._eventsCount = 0), this;
    }, r.prototype.off = r.prototype.removeListener, r.prototype.addListener = r.prototype.on, 
    r.prefixed = n, r.EventEmitter = r, e.exports = r;
  }(b);
  var m = f(b.exports);
  class y {
    constructor(e, t, n, i, o) {
      this.stateManager = e, this.storageManager = t, this.broadcastManager = n, this.handlers = i, 
      this.eventBus = o;
    }
    setupListeners() {
      console.log("[SyncCoordinator] Setting up listeners"), this.eventBus.on("storage:changed", e => {
        this.handleStorageChange(e);
      }), this.eventBus.on("broadcast:received", ({type: e, data: t}) => {
        this.handleBroadcastMessage(e, t);
      }), console.log("[SyncCoordinator] Listeners setup complete");
    }
    handleStorageChange(e) {
      e ? (console.log("[SyncCoordinator] Storage changed, checking if should sync"), 
      this.storageManager.shouldIgnoreStorageChange(e.saveId) ? console.log("[SyncCoordinator] Ignoring own storage change") : (console.log("[SyncCoordinator] Syncing state from storage"), 
      this.stateManager.hydrate(e.quickTabs || []))) : console.log("[SyncCoordinator] Ignoring null storage change");
    }
    handleBroadcastMessage(e, t) {
      t ? (console.log("[SyncCoordinator] Received broadcast:", e), this._routeMessage(e, t)) : console.warn("[SyncCoordinator] Received broadcast with null data, ignoring");
    }
    _routeMessage(e, t) {
      switch (e) {
       case "CREATE":
        this.handlers.create.create(t);
        break;

       case "UPDATE_POSITION":
        this.handlers.update.handlePositionChangeEnd(t.id, t.left, t.top);
        break;

       case "UPDATE_SIZE":
        this.handlers.update.handleSizeChangeEnd(t.id, t.width, t.height);
        break;

       case "SOLO":
        this.handlers.visibility.handleSoloToggle(t.id, t.soloedOnTabs);
        break;

       case "MUTE":
        this.handlers.visibility.handleMuteToggle(t.id, t.mutedOnTabs);
        break;

       case "MINIMIZE":
        this.handlers.visibility.handleMinimize(t.id);
        break;

       case "RESTORE":
        this.handlers.visibility.handleRestore(t.id);
        break;

       case "CLOSE":
        this.handlers.destroy.handleDestroy(t.id);
        break;

       default:
        console.warn("[SyncCoordinator] Unknown broadcast type:", e);
      }
    }
  }
  class w {
    constructor(e, t, n, i) {
      this.stateManager = e, this.minimizedManager = t, this.panelManager = n, this.eventBus = i, 
      this.renderedTabs = new Map;
    }
    init() {
      console.log("[UICoordinator] Initializing..."), this.setupStateListeners(), this.renderAll(), 
      console.log("[UICoordinator] Initialized");
    }
    renderAll() {
      console.log("[UICoordinator] Rendering all visible tabs");
      const e = this.stateManager.getVisible();
      for (const t of e) this.render(t);
      console.log(`[UICoordinator] Rendered ${e.length} tabs`);
    }
    render(e) {
      if (this.renderedTabs.has(e.id)) return console.log("[UICoordinator] Tab already rendered:", e.id), 
      this.renderedTabs.get(e.id);
      console.log("[UICoordinator] Rendering tab:", e.id);
      const t = this._createWindow(e);
      return this.renderedTabs.set(e.id, t), console.log("[UICoordinator] Tab rendered:", e.id), 
      t;
    }
    update(e) {
      const t = this.renderedTabs.get(e.id);
      if (!t) return console.warn("[UICoordinator] Tab not rendered, rendering now:", e.id), 
      this.render(e);
      console.log("[UICoordinator] Updating tab:", e.id), t.updatePosition(e.position.left, e.position.top), 
      t.updateSize(e.size.width, e.size.height), t.updateZIndex(e.zIndex), console.log("[UICoordinator] Tab updated:", e.id);
    }
    destroy(e) {
      const t = this.renderedTabs.get(e);
      t ? (console.log("[UICoordinator] Destroying tab:", e), t.destroy && t.destroy(), 
      this.renderedTabs.delete(e), console.log("[UICoordinator] Tab destroyed:", e)) : console.warn("[UICoordinator] Tab not found for destruction:", e);
    }
    setupStateListeners() {
      console.log("[UICoordinator] Setting up state listeners"), this.eventBus.on("state:added", ({quickTab: e}) => {
        this.render(e);
      }), this.eventBus.on("state:updated", ({quickTab: e}) => {
        this.update(e);
      }), this.eventBus.on("state:deleted", ({id: e}) => {
        this.destroy(e);
      });
    }
    _createWindow(e) {
      return createQuickTabWindow({
        id: e.id,
        url: e.url,
        left: e.position.left,
        top: e.position.top,
        width: e.size.width,
        height: e.size.height,
        title: e.title,
        cookieStoreId: e.container,
        minimized: e.visibility.minimized,
        zIndex: e.zIndex,
        soloedOnTabs: e.visibility.soloedOnTabs,
        mutedOnTabs: e.visibility.mutedOnTabs
      });
    }
  }
  class v {
    constructor(e, t = {}) {
      this.element = e, this.onDragStart = t.onDragStart || null, this.onDrag = t.onDrag || null, 
      this.onDragEnd = t.onDragEnd || null, this.onDragCancel = t.onDragCancel || null, 
      this.isDragging = !1, this.currentPointerId = null, this.offsetX = 0, this.offsetY = 0, 
      this.currentX = 0, this.currentY = 0, this.rafId = null, this.boundHandlePointerDown = this.handlePointerDown.bind(this), 
      this.boundHandlePointerMove = this.handlePointerMove.bind(this), this.boundHandlePointerUp = this.handlePointerUp.bind(this), 
      this.boundHandlePointerCancel = this.handlePointerCancel.bind(this), this.attach();
    }
    attach() {
      this.element.addEventListener("pointerdown", this.boundHandlePointerDown), this.element.addEventListener("pointermove", this.boundHandlePointerMove), 
      this.element.addEventListener("pointerup", this.boundHandlePointerUp), this.element.addEventListener("pointercancel", this.boundHandlePointerCancel);
    }
    handlePointerDown(e) {
      if ("BUTTON" === e.target.tagName || "INPUT" === e.target.tagName) return;
      this.isDragging = !0, this.currentPointerId = e.pointerId;
      const t = this.element.parentElement.getBoundingClientRect();
      this.currentX = t.left, this.currentY = t.top, this.offsetX = e.clientX - this.currentX, 
      this.offsetY = e.clientY - this.currentY, this.element.setPointerCapture(e.pointerId), 
      this.onDragStart && this.onDragStart(this.currentX, this.currentY);
    }
    handlePointerMove(e) {
      this.isDragging && (this.rafId || (this.rafId = requestAnimationFrame(() => {
        const t = e.clientX - this.offsetX, n = e.clientY - this.offsetY;
        this.currentX = t, this.currentY = n, this.onDrag && this.onDrag(t, n), this.rafId = null;
      })));
    }
    handlePointerUp(e) {
      if (!this.isDragging) return;
      this.isDragging = !1, this.rafId && (cancelAnimationFrame(this.rafId), this.rafId = null), 
      null !== this.currentPointerId && (this.element.releasePointerCapture(this.currentPointerId), 
      this.currentPointerId = null);
      const t = e.clientX - this.offsetX, n = e.clientY - this.offsetY;
      this.onDragEnd && this.onDragEnd(t, n);
    }
    handlePointerCancel(e) {
      if (!this.isDragging) return;
      this.isDragging = !1, this.rafId && (cancelAnimationFrame(this.rafId), this.rafId = null);
      const t = this.onDragCancel || this.onDragEnd;
      t && t(this.currentX, this.currentY), this.currentPointerId = null;
    }
    destroy() {
      this.element.removeEventListener("pointerdown", this.boundHandlePointerDown), this.element.removeEventListener("pointermove", this.boundHandlePointerMove), 
      this.element.removeEventListener("pointerup", this.boundHandlePointerUp), this.element.removeEventListener("pointercancel", this.boundHandlePointerCancel), 
      this.rafId && (cancelAnimationFrame(this.rafId), this.rafId = null), this.isDragging = !1, 
      this.currentPointerId = null;
    }
  }
  function S(e, t = {}, n = null) {
    const i = document.createElement(e);
    return Object.entries(t).forEach(([e, t]) => {
      if ("className" === e) i.className = t; else if ("style" === e && "object" == typeof t) Object.assign(i.style, t); else if (e.startsWith("on") && "function" == typeof t) {
        const n = e.substring(2).toLowerCase();
        i.addEventListener(n, t);
      } else i.setAttribute(e, t);
    }), n && ("string" == typeof n ? i.textContent = n : Array.isArray(n) ? n.forEach(e => {
      e instanceof Element ? i.appendChild(e) : "string" == typeof e && i.appendChild(document.createTextNode(e));
    }) : n instanceof Element && i.appendChild(n)), i;
  }
  const T = {
    se: {
      cursor: "se-resize",
      position: {
        bottom: 0,
        right: 0
      },
      size: {
        width: 10,
        height: 10
      },
      directions: [ "e", "s" ]
    },
    sw: {
      cursor: "sw-resize",
      position: {
        bottom: 0,
        left: 0
      },
      size: {
        width: 10,
        height: 10
      },
      directions: [ "w", "s" ]
    },
    ne: {
      cursor: "ne-resize",
      position: {
        top: 0,
        right: 0
      },
      size: {
        width: 10,
        height: 10
      },
      directions: [ "e", "n" ]
    },
    nw: {
      cursor: "nw-resize",
      position: {
        top: 0,
        left: 0
      },
      size: {
        width: 10,
        height: 10
      },
      directions: [ "w", "n" ]
    },
    e: {
      cursor: "e-resize",
      position: {
        top: 10,
        right: 0,
        bottom: 10
      },
      size: {
        width: 10
      },
      directions: [ "e" ]
    },
    w: {
      cursor: "w-resize",
      position: {
        top: 10,
        left: 0,
        bottom: 10
      },
      size: {
        width: 10
      },
      directions: [ "w" ]
    },
    s: {
      cursor: "s-resize",
      position: {
        bottom: 0,
        left: 10,
        right: 10
      },
      size: {
        height: 10
      },
      directions: [ "s" ]
    },
    n: {
      cursor: "n-resize",
      position: {
        top: 0,
        left: 10,
        right: 10
      },
      size: {
        height: 10
      },
      directions: [ "n" ]
    }
  };
  class C {
    constructor(e, t, n = {}) {
      if (this.direction = e, this.window = t, this.config = T[e], this.minWidth = n.minWidth || 400, 
      this.minHeight = n.minHeight || 300, !this.config) throw new Error(`Invalid resize direction: ${e}`);
      this.element = null, this.isResizing = !1, this.startState = null;
    }
    create() {
      const {cursor: e, position: t, size: n} = this.config, i = {
        position: "absolute",
        cursor: e,
        zIndex: "10",
        backgroundColor: "transparent",
        ...Object.entries(t).reduce((e, [t, n]) => (e[t] = `${n}px`, e), {}),
        ...Object.entries(n).reduce((e, [t, n]) => (e[t] = `${n}px`, e), {})
      };
      return this.element = S("div", {
        className: `quick-tab-resize-handle-${this.direction}`,
        style: i
      }), this.attachEventListeners(), this.element;
    }
    attachEventListeners() {
      this.element.addEventListener("pointerdown", this.handlePointerDown.bind(this)), 
      this.element.addEventListener("pointermove", this.handlePointerMove.bind(this)), 
      this.element.addEventListener("pointerup", this.handlePointerUp.bind(this)), this.element.addEventListener("pointercancel", this.handlePointerCancel.bind(this));
    }
    handlePointerDown(e) {
      0 === e.button && (e.stopPropagation(), e.preventDefault(), this.isResizing = !0, 
      this.element.setPointerCapture(e.pointerId), this.startState = {
        x: e.clientX,
        y: e.clientY,
        width: this.window.width,
        height: this.window.height,
        left: this.window.left,
        top: this.window.top
      });
    }
    handlePointerMove(e) {
      if (!this.isResizing) return;
      const t = e.clientX - this.startState.x, n = e.clientY - this.startState.y, i = this.calculateNewDimensions(t, n);
      Object.assign(this.window, i), this.window.container.style.width = `${i.width}px`, 
      this.window.container.style.height = `${i.height}px`, this.window.container.style.left = `${i.left}px`, 
      this.window.container.style.top = `${i.top}px`, this.notifyChanges(i), e.preventDefault();
    }
    calculateNewDimensions(e, t) {
      const {directions: n} = this.config, {width: i, height: o, left: s, top: a} = this.startState;
      let r = i, l = o, c = s, d = a;
      for (const h of n) switch (h) {
       case "e":
        r = Math.max(this.minWidth, i + e);
        break;

       case "w":
        {
          const t = i - this.minWidth, n = Math.min(e, t);
          r = i - n, c = s + n;
        }
        break;

       case "s":
        l = Math.max(this.minHeight, o + t);
        break;

       case "n":
        {
          const e = o - this.minHeight, n = Math.min(t, e);
          l = o - n, d = a + n;
        }
      }
      return {
        width: r,
        height: l,
        left: c,
        top: d
      };
    }
    notifyChanges(e) {
      const {width: t, height: n, left: i, top: o} = e, {width: s, height: a, left: r, top: l} = this.startState;
      t === s && n === a || this.window.onSizeChange?.(this.window.id, t, n), i === r && o === l || this.window.onPositionChange?.(this.window.id, i, o);
    }
    handlePointerUp(e) {
      this.isResizing && (this.isResizing = !1, this.element.releasePointerCapture(e.pointerId), 
      e.preventDefault(), e.stopPropagation(), this.window.onSizeChangeEnd?.(this.window.id, this.window.width, this.window.height), 
      this.window.left === this.startState.left && this.window.top === this.startState.top || this.window.onPositionChangeEnd?.(this.window.id, this.window.left, this.window.top), 
      this.startState = null);
    }
    handlePointerCancel(e) {
      this.isResizing && (this.isResizing = !1, this.window.onSizeChangeEnd?.(this.window.id, this.window.width, this.window.height), 
      this.window.onPositionChangeEnd?.(this.window.id, this.window.left, this.window.top), 
      this.startState = null);
    }
    destroy() {
      this.element && (this.element.remove(), this.element = null);
    }
  }
  const k = [ "nw", "n", "ne", "e", "se", "s", "sw", "w" ];
  class I {
    constructor(e, t = {}) {
      this.window = e, this.options = t, this.handles = [];
    }
    attachHandles() {
      for (const e of k) {
        const t = new C(e, this.window, this.options), n = t.create();
        this.window.container.appendChild(n), this.handles.push(t);
      }
      return this.handles;
    }
    detachAll() {
      for (const e of this.handles) e.destroy();
      this.handles = [];
    }
    getHandle(e) {
      return this.handles.find(t => t.direction === e);
    }
  }
  class E {
    constructor(e, t) {
      this.config = e, this.callbacks = t, this.titlebar = null, this.titleElement = null, 
      this.soloButton = null, this.muteButton = null, this.faviconElement = null, this.currentZoom = 100, 
      this.zoomDisplay = null;
    }
    build() {
      this.titlebar = this._createContainer();
      const e = this._createLeftSection(), t = this._createRightSection();
      return this.titlebar.appendChild(e), this.titlebar.appendChild(t), this.titlebar;
    }
    updateTitle(e) {
      this.titleElement && (this.titleElement.textContent = e);
    }
    updateSoloButton(e) {
      this.soloButton && (this.soloButton.textContent = e ? "🎯" : "⭕", this.soloButton.title = e ? "Un-solo (show on all tabs)" : "Solo (show only on this tab)", 
      this.soloButton.style.background = e ? "#444" : "transparent");
    }
    updateMuteButton(e) {
      this.muteButton && (this.muteButton.textContent = e ? "🔇" : "🔊", this.muteButton.title = e ? "Unmute (show on this tab)" : "Mute (hide on this tab)", 
      this.muteButton.style.background = e ? "#c44" : "transparent");
    }
    _createContainer() {
      return S("div", {
        className: "quick-tab-titlebar",
        style: {
          height: "40px",
          backgroundColor: "#2d2d2d",
          borderBottom: "1px solid #444",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          cursor: "move",
          userSelect: "none"
        }
      });
    }
    _createLeftSection() {
      const e = S("div", {
        style: {
          display: "flex",
          alignItems: "center",
          flex: "1",
          overflow: "hidden",
          gap: "8px"
        }
      }), t = this._createNavigationButtons();
      return e.appendChild(t), this.faviconElement = this._createFavicon(), e.appendChild(this.faviconElement), 
      this.titleElement = this._createTitle(), e.appendChild(this.titleElement), e;
    }
    _createNavigationButtons() {
      const e = S("div", {
        style: {
          display: "flex",
          gap: "4px",
          alignItems: "center"
        }
      });
      return this._appendHistoryButtons(e), this._appendZoomControls(e), e;
    }
    _appendHistoryButtons(e) {
      const t = this._createButton("←", () => {
        if (this.config.iframe.contentWindow) try {
          this.config.iframe.contentWindow.history.back();
        } catch (e) {
          console.warn("[QuickTab] Cannot navigate back - cross-origin restriction");
        }
      });
      t.title = "Back", e.appendChild(t);
      const n = this._createButton("→", () => {
        if (this.config.iframe.contentWindow) try {
          this.config.iframe.contentWindow.history.forward();
        } catch (e) {
          console.warn("[QuickTab] Cannot navigate forward - cross-origin restriction");
        }
      });
      n.title = "Forward", e.appendChild(n);
      const i = this._createButton("↻", () => {
        const e = this.config.iframe.src;
        this.config.iframe.src = "about:blank", setTimeout(() => {
          this.config.iframe.src = e;
        }, 10);
      });
      i.title = "Reload", e.appendChild(i);
    }
    _appendZoomControls(e) {
      const t = this._createButton("−", () => {
        this.currentZoom > 50 && (this.currentZoom -= 10, this._applyZoom(this.currentZoom));
      });
      t.title = "Zoom Out", e.appendChild(t), this.zoomDisplay = S("span", {
        style: {
          fontSize: "11px",
          color: "#fff",
          minWidth: "38px",
          textAlign: "center",
          fontWeight: "500"
        }
      }, "100%"), e.appendChild(this.zoomDisplay);
      const n = this._createButton("+", () => {
        this.currentZoom < 200 && (this.currentZoom += 10, this._applyZoom(this.currentZoom));
      });
      n.title = "Zoom In", e.appendChild(n);
    }
    _createFavicon() {
      const e = S("img", {
        className: "quick-tab-favicon",
        style: {
          width: "16px",
          height: "16px",
          marginLeft: "5px",
          marginRight: "5px",
          flexShrink: "0"
        }
      });
      try {
        const t = new URL(this.config.url), n = "https://www.google.com/s2/favicons?domain=";
        e.src = `${n}${t.hostname}&sz=32`, e.onerror = () => {
          e.style.display = "none";
        };
      } catch (t) {
        e.style.display = "none";
      }
      return e;
    }
    _createTitle() {
      return S("div", {
        className: "quick-tab-title",
        style: {
          color: "#fff",
          fontSize: "14px",
          fontWeight: "bold",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: "1"
        }
      }, this.config.title);
    }
    _createRightSection() {
      const e = S("div", {
        style: {
          display: "flex",
          gap: "8px"
        }
      }), t = this._createButton("🔗", () => {
        this.callbacks.onOpenInTab && this.callbacks.onOpenInTab();
      });
      t.title = "Open in New Tab", e.appendChild(t);
      const n = this._isCurrentTabSoloed();
      this.soloButton = this._createButton(n ? "🎯" : "⭕", () => {
        this.callbacks.onSolo && this.callbacks.onSolo(this.soloButton);
      }), this.soloButton.title = n ? "Un-solo (show on all tabs)" : "Solo (show only on this tab)", 
      this.soloButton.style.background = n ? "#444" : "transparent", e.appendChild(this.soloButton);
      const i = this._isCurrentTabMuted();
      this.muteButton = this._createButton(i ? "🔇" : "🔊", () => {
        this.callbacks.onMute && this.callbacks.onMute(this.muteButton);
      }), this.muteButton.title = i ? "Unmute (show on this tab)" : "Mute (hide on this tab)", 
      this.muteButton.style.background = i ? "#c44" : "transparent", e.appendChild(this.muteButton);
      const o = this._createButton("−", () => {
        this.callbacks.onMinimize && this.callbacks.onMinimize();
      });
      o.title = "Minimize", e.appendChild(o);
      const s = this._createButton("×", () => {
        this.callbacks.onClose && this.callbacks.onClose();
      });
      return s.title = "Close", e.appendChild(s), e;
    }
    _createButton(e, t) {
      const n = S("button", {
        style: {
          width: "24px",
          height: "24px",
          backgroundColor: "transparent",
          border: "1px solid #666",
          borderRadius: "4px",
          color: "#fff",
          fontSize: "16px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0",
          transition: "background-color 0.2s"
        }
      }, e);
      return n.addEventListener("mouseenter", () => {
        n.style.backgroundColor = "#444";
      }), n.addEventListener("mouseleave", () => {
        n.style.backgroundColor = "transparent";
      }), n.addEventListener("click", e => {
        e.stopPropagation(), t();
      }), n;
    }
    _applyZoom(e) {
      const t = e / 100;
      if (this.config.iframe.contentWindow) try {
        this.config.iframe.contentWindow.document.body.style.zoom = t;
      } catch (e) {
        this.config.iframe.style.transform = `scale(${t})`, this.config.iframe.style.transformOrigin = "top left", 
        this.config.iframe.style.width = 100 / t + "%", this.config.iframe.style.height = 100 / t + "%";
      }
      this.zoomDisplay && (this.zoomDisplay.textContent = `${e}%`), console.log(`[TitlebarBuilder] Zoom applied: ${e}% on ${this.config.url}`);
    }
    _isCurrentTabSoloed() {
      return this.config.soloedOnTabs && this.config.soloedOnTabs.includes(this.config.currentTabId);
    }
    _isCurrentTabMuted() {
      return this.config.mutedOnTabs && this.config.mutedOnTabs.includes(this.config.currentTabId);
    }
  }
  class M {
    constructor(e) {
      this._initializeBasicProperties(e), this._initializePositionAndSize(e), this._initializeVisibility(e), 
      this._initializeCallbacks(e), this._initializeState();
    }
    _initializeBasicProperties(e) {
      this.id = e.id, this.url = e.url, this.title = e.title || "Quick Tab", this.cookieStoreId = e.cookieStoreId || "firefox-default";
    }
    _initializePositionAndSize(e) {
      this.left = e.left || 100, this.top = e.top || 100, this.width = e.width || 800, 
      this.height = e.height || 600, this.zIndex = e.zIndex || c;
    }
    _initializeVisibility(e) {
      this.minimized = e.minimized || !1, this.soloedOnTabs = e.soloedOnTabs || [], this.mutedOnTabs = e.mutedOnTabs || [];
    }
    _initializeCallbacks(e) {
      const t = () => {};
      [ "onDestroy", "onMinimize", "onFocus", "onPositionChange", "onPositionChangeEnd", "onSizeChange", "onSizeChangeEnd", "onSolo", "onMute" ].forEach(n => {
        this[n] = e[n] || t;
      });
    }
    _initializeState() {
      this.container = null, this.iframe = null, this.rendered = !1, this.isDragging = !1, 
      this.isResizing = !1, this.resizeStartWidth = 0, this.resizeStartHeight = 0, this.soloButton = null, 
      this.muteButton = null, this.dragController = null, this.resizeController = null;
    }
    render() {
      if (this.container) return console.warn("[QuickTabWindow] Already rendered:", this.id), 
      this.container;
      const t = Number.isFinite(this.left) ? this.left : 100, n = Number.isFinite(this.top) ? this.top : 100;
      this.left = t, this.top = n, this.container = S("div", {
        id: `quick-tab-${this.id}`,
        className: "quick-tab-window",
        style: {
          position: "fixed",
          left: "-9999px",
          top: "-9999px",
          width: `${this.width}px`,
          height: `${this.height}px`,
          zIndex: this.zIndex.toString(),
          backgroundColor: "#1e1e1e",
          border: "2px solid #444",
          borderRadius: "8px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          display: this.minimized ? "none" : "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "box-shadow 0.2s, opacity 0.15s ease-in",
          visibility: "hidden",
          opacity: "0"
        }
      }), this.titlebarBuilder = new E({
        title: this.title,
        url: this.url,
        soloedOnTabs: this.soloedOnTabs,
        mutedOnTabs: this.mutedOnTabs,
        currentTabId: this.currentTabId,
        iframe: null
      }, {
        onClose: () => this.destroy(),
        onMinimize: () => this.minimize(),
        onSolo: e => this.toggleSolo(e),
        onMute: e => this.toggleMute(e),
        onOpenInTab: () => {
          const t = this.iframe.src || this.iframe.getAttribute("data-deferred-src");
          e.runtime.sendMessage({
            action: "openTab",
            url: t,
            switchFocus: !0
          });
        }
      });
      const i = this.titlebarBuilder.build();
      return this.container.appendChild(i), this.soloButton = this.titlebarBuilder.soloButton, 
      this.muteButton = this.titlebarBuilder.muteButton, this.iframe = S("iframe", {
        src: this.url,
        style: {
          flex: "1",
          border: "none",
          width: "100%",
          height: "calc(100% - 40px)"
        },
        sandbox: "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      }), this.container.appendChild(this.iframe), this.titlebarBuilder.config.iframe = this.iframe, 
      this.setupIframeLoadHandler(), document.body.appendChild(this.container), this.rendered = !0, 
      requestAnimationFrame(() => {
        this.container.style.left = `${t}px`, this.container.style.top = `${n}px`, this.container.style.visibility = "visible", 
        this.container.style.opacity = "1";
      }), this.dragController = new v(i, {
        onDragStart: (e, t) => {
          console.log("[QuickTabWindow] Drag started:", this.id, e, t), this.isDragging = !0, 
          this.onFocus(this.id);
        },
        onDrag: (e, t) => {
          this.left = e, this.top = t, this.container.style.left = `${e}px`, this.container.style.top = `${t}px`, 
          this.onPositionChange && this.onPositionChange(this.id, e, t);
        },
        onDragEnd: (e, t) => {
          console.log("[QuickTabWindow] Drag ended:", this.id, e, t), this.isDragging = !1, 
          this.onPositionChangeEnd && this.onPositionChangeEnd(this.id, e, t);
        },
        onDragCancel: (e, t) => {
          console.log("[QuickTabWindow] Drag cancelled:", this.id, e, t), this.isDragging = !1, 
          this.onPositionChangeEnd && this.onPositionChangeEnd(this.id, e, t);
        }
      }), this.resizeController = new I(this, {
        minWidth: 400,
        minHeight: 300
      }), this.resizeController.attachHandles(), this.setupFocusHandlers(), console.log("[QuickTabWindow] Rendered:", this.id), 
      this.container;
    }
    setupFocusHandlers() {
      this.container.addEventListener("mousedown", () => {
        this.onFocus(this.id);
      });
    }
    minimize() {
      this.minimized = !0, this.container.style.display = "none", console.log(`[Quick Tab] Minimized - URL: ${this.url}, Title: ${this.title}, ID: ${this.id}, Position: (${this.left}, ${this.top}), Size: ${this.width}x${this.height}`), 
      this.onMinimize(this.id);
    }
    restore() {
      this.minimized = !1, this.container.style.display = "flex", this.container.style.left = `${this.left}px`, 
      this.container.style.top = `${this.top}px`, this.container.style.width = `${this.width}px`, 
      this.container.style.height = `${this.height}px`, console.log(`[Quick Tab] Restored - URL: ${this.url}, Title: ${this.title}, ID: ${this.id}, Position: (${this.left}, ${this.top}), Size: ${this.width}x${this.height}`), 
      this.onFocus(this.id);
    }
    updateZIndex(e) {
      this.zIndex = e, this.container && (this.container.style.zIndex = e.toString());
    }
    setupIframeLoadHandler() {
      this.iframe.addEventListener("load", () => {
        this._updateTitleFromIframe();
      });
    }
    _updateTitleFromIframe() {
      const e = this._tryGetIframeTitle();
      if (e) return void this._setTitle(e, e);
      const t = this._tryGetHostname();
      t ? this._setTitle(t, this.iframe.src) : this.title = "Quick Tab";
    }
    _tryGetIframeTitle() {
      try {
        return this.iframe.contentDocument?.title;
      } catch (e) {
        return null;
      }
    }
    _tryGetHostname() {
      try {
        return new URL(this.iframe.src).hostname;
      } catch (e) {
        return null;
      }
    }
    _setTitle(e, t) {
      this.title = e, this.titlebarBuilder && (this.titlebarBuilder.updateTitle(e), this.titlebarBuilder.titleElement && (this.titlebarBuilder.titleElement.title = t));
    }
    isCurrentTabSoloed() {
      return this.soloedOnTabs && this.soloedOnTabs.length > 0 && window.quickTabsManager && window.quickTabsManager.currentTabId && this.soloedOnTabs.includes(window.quickTabsManager.currentTabId);
    }
    isCurrentTabMuted() {
      return this.mutedOnTabs && this.mutedOnTabs.length > 0 && window.quickTabsManager && window.quickTabsManager.currentTabId && this.mutedOnTabs.includes(window.quickTabsManager.currentTabId);
    }
    toggleSolo(e) {
      if (console.log("[QuickTabWindow] toggleSolo called for:", this.id), console.log("[QuickTabWindow] window.quickTabsManager:", window.quickTabsManager), 
      console.log("[QuickTabWindow] currentTabId:", window.quickTabsManager?.currentTabId), 
      !window.quickTabsManager || !window.quickTabsManager.currentTabId) return console.warn("[QuickTabWindow] Cannot toggle solo - no current tab ID"), 
      console.warn("[QuickTabWindow] window.quickTabsManager:", window.quickTabsManager), 
      void console.warn("[QuickTabWindow] currentTabId:", window.quickTabsManager?.currentTabId);
      const t = window.quickTabsManager.currentTabId;
      this.isCurrentTabSoloed() ? (this.soloedOnTabs = this.soloedOnTabs.filter(e => e !== t), 
      e.textContent = "⭕", e.title = "Solo (show only on this tab)", e.style.background = "transparent", 
      0 === this.soloedOnTabs.length && console.log("[QuickTabWindow] Un-soloed - now visible on all tabs")) : (this.soloedOnTabs = [ t ], 
      this.mutedOnTabs = [], e.textContent = "🎯", e.title = "Un-solo (show on all tabs)", 
      e.style.background = "#444", this.muteButton && (this.muteButton.textContent = "🔊", 
      this.muteButton.title = "Mute (hide on this tab)", this.muteButton.style.background = "transparent"), 
      console.log("[QuickTabWindow] Soloed - only visible on this tab")), this.onSolo && this.onSolo(this.id, this.soloedOnTabs);
    }
    toggleMute(e) {
      if (console.log("[QuickTabWindow] toggleMute called for:", this.id), console.log("[QuickTabWindow] window.quickTabsManager:", window.quickTabsManager), 
      console.log("[QuickTabWindow] currentTabId:", window.quickTabsManager?.currentTabId), 
      !window.quickTabsManager || !window.quickTabsManager.currentTabId) return console.warn("[QuickTabWindow] Cannot toggle mute - no current tab ID"), 
      console.warn("[QuickTabWindow] window.quickTabsManager:", window.quickTabsManager), 
      void console.warn("[QuickTabWindow] currentTabId:", window.quickTabsManager?.currentTabId);
      const t = window.quickTabsManager.currentTabId;
      this.isCurrentTabMuted() ? (this.mutedOnTabs = this.mutedOnTabs.filter(e => e !== t), 
      e.textContent = "🔊", e.title = "Mute (hide on this tab)", e.style.background = "transparent", 
      console.log("[QuickTabWindow] Unmuted on this tab")) : (this.mutedOnTabs.includes(t) || this.mutedOnTabs.push(t), 
      this.soloedOnTabs = [], e.textContent = "🔇", e.title = "Unmute (show on this tab)", 
      e.style.background = "#c44", this.soloButton && (this.soloButton.textContent = "⭕", 
      this.soloButton.title = "Solo (show only on this tab)", this.soloButton.style.background = "transparent"), 
      console.log("[QuickTabWindow] Muted on this tab")), this.onMute && this.onMute(this.id, this.mutedOnTabs);
    }
    setPosition(e, t) {
      this.left = e, this.top = t, this.container && (this.container.style.left = `${e}px`, 
      this.container.style.top = `${t}px`);
    }
    setSize(e, t) {
      this.width = e, this.height = t, this.container && (this.container.style.width = `${e}px`, 
      this.container.style.height = `${t}px`);
    }
    isRendered() {
      return this.rendered && this.container && this.container.parentNode;
    }
    destroy() {
      this.dragController && (this.dragController.destroy(), this.dragController = null), 
      this.resizeController && (this.resizeController.detachAll(), this.resizeController = null), 
      this.container && (this.container.remove(), this.container = null, this.iframe = null, 
      this.rendered = !1), this.onDestroy(this.id), console.log("[QuickTabWindow] Destroyed:", this.id);
    }
    getState() {
      return {
        id: this.id,
        url: this.url,
        left: this.left,
        top: this.top,
        width: this.width,
        height: this.height,
        title: this.title,
        cookieStoreId: this.cookieStoreId,
        minimized: this.minimized,
        zIndex: this.zIndex,
        soloedOnTabs: this.soloedOnTabs,
        mutedOnTabs: this.mutedOnTabs
      };
    }
  }
  class x {
    constructor(e, t, n, i, o, s, a) {
      this.quickTabsMap = e, this.currentZIndex = t, this.cookieStoreId = n, this.broadcastManager = i, 
      this.eventBus = o, this.Events = s, this.generateId = a;
    }
    create(e) {
      console.log("[CreateHandler] Creating Quick Tab with options:", e);
      const t = e.id || this.generateId(), n = e.cookieStoreId || this.cookieStoreId || "firefox-default";
      return this.quickTabsMap.has(t) ? this._handleExistingTab(t) : this._createNewTab(t, n, e);
    }
    _handleExistingTab(e) {
      const t = this.quickTabsMap.get(e);
      return t.isRendered && t.isRendered() ? console.warn("[CreateHandler] Quick Tab already exists and is rendered:", e) : (console.log("[CreateHandler] Tab exists but not rendered, rendering now:", e), 
      t.render()), this.currentZIndex.value++, t.updateZIndex(this.currentZIndex.value), 
      {
        tabWindow: t,
        newZIndex: this.currentZIndex.value
      };
    }
    _createNewTab(e, t, n) {
      this.currentZIndex.value++;
      const i = this._getDefaults(), o = function(e) {
        const t = new M(e);
        return t.render(), t;
      }(this._buildTabOptions(e, t, n, i));
      return this.quickTabsMap.set(e, o), this._broadcastCreation(e, t, n, i), this._emitCreationEvent(e, n.url), 
      console.log("[CreateHandler] Quick Tab created successfully:", e), {
        tabWindow: o,
        newZIndex: this.currentZIndex.value
      };
    }
    _getDefaults() {
      return {
        left: 100,
        top: 100,
        width: 800,
        height: 600,
        title: "Quick Tab",
        minimized: !1,
        soloedOnTabs: [],
        mutedOnTabs: []
      };
    }
    _buildTabOptions(e, t, n, i) {
      return {
        id: e,
        url: n.url,
        left: n.left ?? i.left,
        top: n.top ?? i.top,
        width: n.width ?? i.width,
        height: n.height ?? i.height,
        title: n.title ?? i.title,
        cookieStoreId: t,
        minimized: n.minimized ?? i.minimized,
        zIndex: this.currentZIndex.value,
        soloedOnTabs: n.soloedOnTabs ?? i.soloedOnTabs,
        mutedOnTabs: n.mutedOnTabs ?? i.mutedOnTabs,
        onDestroy: n.onDestroy,
        onMinimize: n.onMinimize,
        onFocus: n.onFocus,
        onPositionChange: n.onPositionChange,
        onPositionChangeEnd: n.onPositionChangeEnd,
        onSizeChange: n.onSizeChange,
        onSizeChangeEnd: n.onSizeChangeEnd,
        onSolo: n.onSolo,
        onMute: n.onMute
      };
    }
    _broadcastCreation(e, t, n, i) {
      this.broadcastManager.broadcast("CREATE", {
        id: e,
        url: n.url,
        left: n.left ?? i.left,
        top: n.top ?? i.top,
        width: n.width ?? i.width,
        height: n.height ?? i.height,
        title: n.title ?? i.title,
        cookieStoreId: t,
        minimized: n.minimized ?? i.minimized,
        soloedOnTabs: n.soloedOnTabs ?? i.soloedOnTabs,
        mutedOnTabs: n.mutedOnTabs ?? i.mutedOnTabs
      });
    }
    _emitCreationEvent(e, t) {
      this.eventBus && this.Events && this.eventBus.emit(this.Events.QUICK_TAB_CREATED, {
        id: e,
        url: t
      });
    }
  }
  class _ {
    constructor(e, t, n, i, o, s, a, r, l) {
      this.quickTabsMap = e, this.broadcastManager = t, this.minimizedManager = n, this.eventBus = i, 
      this.currentZIndex = o, this.generateSaveId = s, this.releasePendingSave = a, this.Events = r, 
      this.baseZIndex = l;
    }
    async handleDestroy(e) {
      console.log("[DestroyHandler] Handling destroy for:", e);
      const t = this._getTabInfoAndCleanup(e), n = this.generateSaveId();
      this.broadcastManager.notifyClose(e), await this._sendCloseToBackground(e, t, n), 
      this._emitDestructionEvent(e), this._resetZIndexIfEmpty();
    }
    _getTabInfoAndCleanup(e) {
      const t = this.quickTabsMap.get(e), n = t && t.url ? t.url : null, i = t && t.cookieStoreId || "firefox-default";
      return this.quickTabsMap.delete(e), this.minimizedManager.remove(e), {
        url: n,
        cookieStoreId: i
      };
    }
    async _sendCloseToBackground(e, t, n) {
      if ("undefined" != typeof browser && browser.runtime) try {
        await browser.runtime.sendMessage({
          action: "CLOSE_QUICK_TAB",
          id: e,
          url: t.url,
          cookieStoreId: t.cookieStoreId,
          saveId: n
        });
      } catch (e) {
        console.error("[DestroyHandler] Error closing Quick Tab in background:", e), this.releasePendingSave(n);
      } else this.releasePendingSave(n);
    }
    _emitDestructionEvent(e) {
      this.eventBus && this.Events && this.eventBus.emit(this.Events.QUICK_TAB_CLOSED, {
        id: e
      });
    }
    _resetZIndexIfEmpty() {
      0 === this.quickTabsMap.size && (this.currentZIndex.value = this.baseZIndex, console.log("[DestroyHandler] All tabs closed, reset z-index"));
    }
    closeById(e) {
      const t = this.quickTabsMap.get(e);
      t && t.destroy && t.destroy();
    }
    closeAll() {
      console.log("[DestroyHandler] Closing all Quick Tabs");
      for (const e of this.quickTabsMap.values()) e.destroy && e.destroy();
      this.quickTabsMap.clear(), this.minimizedManager.clear(), this.currentZIndex.value = this.baseZIndex;
    }
  }
  class z {
    constructor(e, t, n, i, o, s) {
      this.quickTabsMap = e, this.broadcastManager = t, this.storageManager = n, this.eventBus = i, 
      this.generateSaveId = o, this.releasePendingSave = s, this.positionChangeThrottle = new Map, 
      this.sizeChangeThrottle = new Map;
    }
    handlePositionChange(e, t, n) {}
    async handlePositionChangeEnd(e, t, n) {
      this.positionChangeThrottle.has(e) && this.positionChangeThrottle.delete(e);
      const i = Math.round(t), o = Math.round(n);
      this.broadcastManager.notifyPositionUpdate(e, i, o);
      const s = this.generateSaveId(), a = this.quickTabsMap.get(e), r = a?.cookieStoreId || "firefox-default";
      if ("undefined" != typeof browser && browser.runtime) try {
        await browser.runtime.sendMessage({
          action: "UPDATE_QUICK_TAB_POSITION_FINAL",
          id: e,
          left: i,
          top: o,
          cookieStoreId: r,
          saveId: s,
          timestamp: Date.now()
        });
      } catch (e) {
        console.error("[UpdateHandler] Final position save error:", e), this.releasePendingSave(s);
      } else this.releasePendingSave(s);
      this.eventBus?.emit("tab:position-updated", {
        id: e,
        left: i,
        top: o
      });
    }
    handleSizeChange(e, t, n) {}
    async handleSizeChangeEnd(e, t, n) {
      this.sizeChangeThrottle.has(e) && this.sizeChangeThrottle.delete(e);
      const i = Math.round(t), o = Math.round(n);
      this.broadcastManager.notifySizeUpdate(e, i, o);
      const s = this.generateSaveId(), a = this.quickTabsMap.get(e), r = a?.cookieStoreId || "firefox-default";
      if ("undefined" != typeof browser && browser.runtime) try {
        await browser.runtime.sendMessage({
          action: "UPDATE_QUICK_TAB_SIZE_FINAL",
          id: e,
          width: i,
          height: o,
          cookieStoreId: r,
          saveId: s,
          timestamp: Date.now()
        });
      } catch (e) {
        console.error("[UpdateHandler] Final size save error:", e), this.releasePendingSave(s);
      } else this.releasePendingSave(s);
      this.eventBus?.emit("tab:size-updated", {
        id: e,
        width: i,
        height: o
      });
    }
  }
  class O {
    constructor(e, t, n, i, o, s, a, r, l, c, d) {
      this.quickTabsMap = e, this.broadcastManager = t, this.storageManager = n, this.minimizedManager = i, 
      this.eventBus = o, this.currentZIndex = s, this.generateSaveId = a, this.trackPendingSave = r, 
      this.releasePendingSave = l, this.currentTabId = c, this.Events = d;
    }
    async handleSoloToggle(e, t) {
      console.log(`[VisibilityHandler] Toggling solo for ${e}:`, t);
      const n = this.quickTabsMap.get(e);
      n && (n.soloedOnTabs = t, n.mutedOnTabs = [], this._updateSoloButton(n, t), this.broadcastManager.notifySolo(e, t), 
      await this._sendToBackground(e, n, "SOLO", {
        soloedOnTabs: t
      }));
    }
    async handleMuteToggle(e, t) {
      console.log(`[VisibilityHandler] Toggling mute for ${e}:`, t);
      const n = this.quickTabsMap.get(e);
      n && (n.mutedOnTabs = t, n.soloedOnTabs = [], this._updateMuteButton(n, t), this.broadcastManager.notifyMute(e, t), 
      await this._sendToBackground(e, n, "MUTE", {
        mutedOnTabs: t
      }));
    }
    async handleMinimize(e) {
      console.log("[VisibilityHandler] Handling minimize for:", e);
      const t = this.quickTabsMap.get(e);
      if (!t) return;
      this.minimizedManager.add(e, t), this.broadcastManager.notifyMinimize(e), this.eventBus && this.Events && this.eventBus.emit(this.Events.QUICK_TAB_MINIMIZED, {
        id: e
      });
      const n = this.generateSaveId();
      this.trackPendingSave(n);
      const i = t.cookieStoreId || "firefox-default";
      if ("undefined" != typeof browser && browser.runtime) try {
        await browser.runtime.sendMessage({
          action: "UPDATE_QUICK_TAB_MINIMIZE",
          id: e,
          minimized: !0,
          cookieStoreId: i,
          saveId: n,
          timestamp: Date.now()
        }), this.releasePendingSave(n);
      } catch (e) {
        console.error("[VisibilityHandler] Error updating minimize state:", e), this.releasePendingSave(n);
      } else this.releasePendingSave(n);
    }
    handleFocus(e) {
      console.log("[VisibilityHandler] Bringing to front:", e);
      const t = this.quickTabsMap.get(e);
      t && (this.currentZIndex.value++, t.updateZIndex(this.currentZIndex.value), this.eventBus && this.Events && this.eventBus.emit(this.Events.QUICK_TAB_FOCUSED, {
        id: e
      }));
    }
    _updateSoloButton(e, t) {
      if (!e.soloButton) return;
      const n = t.length > 0;
      e.soloButton.textContent = n ? "🎯" : "⭕", e.soloButton.title = n ? "Un-solo (show on all tabs)" : "Solo (show only on this tab)", 
      e.soloButton.style.background = n ? "#444" : "transparent";
    }
    _updateMuteButton(e, t) {
      if (!e.muteButton) return;
      const n = t.includes(this.currentTabId);
      e.muteButton.textContent = n ? "🔇" : "🔊", e.muteButton.title = n ? "Unmute (show on this tab)" : "Mute (hide on this tab)", 
      e.muteButton.style.background = n ? "#c44" : "transparent";
    }
    async _sendToBackground(e, t, n, i) {
      const o = this.generateSaveId(), s = t?.cookieStoreId || "firefox-default";
      if ("undefined" != typeof browser && browser.runtime) try {
        await browser.runtime.sendMessage({
          action: `UPDATE_QUICK_TAB_${n}`,
          id: e,
          ...i,
          cookieStoreId: s,
          saveId: o,
          timestamp: Date.now()
        });
      } catch (e) {
        console.error(`[VisibilityHandler] ${n} update error:`, e), this.releasePendingSave(o);
      } else this.releasePendingSave(o);
    }
  }
  class P {
    constructor(e, t = "firefox-default") {
      this.eventBus = e, this.cookieStoreId = t, this.broadcastChannel = null, this.currentChannelName = null, 
      this.broadcastDebounce = new Map, this.BROADCAST_DEBOUNCE_MS = 50;
    }
    setupBroadcastChannel() {
      if ("undefined" != typeof BroadcastChannel) try {
        const e = `quick-tabs-sync-${this.cookieStoreId}`;
        this.broadcastChannel && (console.log(`[BroadcastManager] Closing old channel: ${this.currentChannelName}`), 
        this.broadcastChannel.close()), this.broadcastChannel = new BroadcastChannel(e), 
        this.currentChannelName = e, console.log(`[BroadcastManager] BroadcastChannel created: ${e}`), 
        this.broadcastChannel.onmessage = e => {
          this.handleBroadcastMessage(e.data);
        }, console.log(`[BroadcastManager] Initialized for container: ${this.cookieStoreId}`);
      } catch (e) {
        console.error("[BroadcastManager] Failed to setup BroadcastChannel:", e);
      } else console.warn("[BroadcastManager] BroadcastChannel not available, using storage-only sync");
    }
    handleBroadcastMessage(e) {
      console.log("[BroadcastManager] Message received:", e);
      const {type: t, data: n} = e;
      this.shouldDebounce(t, n) ? console.log("[BroadcastManager] Ignoring duplicate broadcast (debounced):", t, n.id) : this.eventBus?.emit("broadcast:received", {
        type: t,
        data: n
      });
    }
    shouldDebounce(e, t) {
      if (!t || !t.id) return !1;
      const n = `${e}-${t.id}`, i = Date.now(), o = this.broadcastDebounce.get(n);
      return !!(o && i - o < this.BROADCAST_DEBOUNCE_MS) || (this.broadcastDebounce.set(n, i), 
      this._cleanupOldDebounceEntries(i), !1);
    }
    _cleanupOldDebounceEntries(e) {
      if (this.broadcastDebounce.size <= 100) return;
      const t = e - 2 * this.BROADCAST_DEBOUNCE_MS;
      for (const [e, n] of this.broadcastDebounce.entries()) n < t && this.broadcastDebounce.delete(e);
    }
    broadcast(e, t) {
      if (this.broadcastChannel) try {
        this.broadcastChannel.postMessage({
          type: e,
          data: t
        }), console.log(`[BroadcastManager] Broadcasted ${e}:`, t);
      } catch (e) {
        console.error("[BroadcastManager] Failed to broadcast:", e);
      } else console.warn("[BroadcastManager] No broadcast channel available");
    }
    async notifyCreate(e) {
      await this.broadcast("CREATE", e);
    }
    async notifyPositionUpdate(e, t, n) {
      await this.broadcast("UPDATE_POSITION", {
        id: e,
        left: t,
        top: n
      });
    }
    async notifySizeUpdate(e, t, n) {
      await this.broadcast("UPDATE_SIZE", {
        id: e,
        width: t,
        height: n
      });
    }
    async notifyMinimize(e) {
      await this.broadcast("MINIMIZE", {
        id: e
      });
    }
    async notifyRestore(e) {
      await this.broadcast("RESTORE", {
        id: e
      });
    }
    async notifyClose(e) {
      await this.broadcast("CLOSE", {
        id: e
      });
    }
    async notifySolo(e, t) {
      await this.broadcast("SOLO", {
        id: e,
        soloedOnTabs: t
      });
    }
    async notifyMute(e, t) {
      await this.broadcast("MUTE", {
        id: e,
        mutedOnTabs: t
      });
    }
    updateContainer(e) {
      this.cookieStoreId !== e && (console.log(`[BroadcastManager] Updating container: ${this.cookieStoreId} → ${e}`), 
      this.cookieStoreId = e, this.setupBroadcastChannel());
    }
    close() {
      this.broadcastChannel && (console.log(`[BroadcastManager] Closing channel: ${this.currentChannelName}`), 
      this.broadcastChannel.close(), this.broadcastChannel = null, this.currentChannelName = null);
    }
  }
  class B {
    constructor(e, t) {
      this.eventBus = e, this.quickTabsMap = t, this.boundHandlers = {
        visibilityChange: null,
        beforeUnload: null,
        pageHide: null
      };
    }
    setupEmergencySaveHandlers() {
      this.boundHandlers.visibilityChange = () => {
        document.hidden && this.quickTabsMap.size > 0 && (console.log("[EventManager] Tab hidden - triggering emergency save"), 
        this.eventBus?.emit("event:emergency-save", {
          trigger: "visibilitychange"
        }));
      }, this.boundHandlers.beforeUnload = () => {
        this.quickTabsMap.size > 0 && (console.log("[EventManager] Page unloading - triggering emergency save"), 
        this.eventBus?.emit("event:emergency-save", {
          trigger: "beforeunload"
        }));
      }, this.boundHandlers.pageHide = () => {
        this.quickTabsMap.size > 0 && (console.log("[EventManager] Page hiding - triggering emergency save"), 
        this.eventBus?.emit("event:emergency-save", {
          trigger: "pagehide"
        }));
      }, document.addEventListener("visibilitychange", this.boundHandlers.visibilityChange), 
      window.addEventListener("beforeunload", this.boundHandlers.beforeUnload), window.addEventListener("pagehide", this.boundHandlers.pageHide), 
      console.log("[EventManager] Emergency save handlers attached");
    }
    teardown() {
      this.boundHandlers.visibilityChange && document.removeEventListener("visibilitychange", this.boundHandlers.visibilityChange), 
      this.boundHandlers.beforeUnload && window.removeEventListener("beforeunload", this.boundHandlers.beforeUnload), 
      this.boundHandlers.pageHide && window.removeEventListener("pagehide", this.boundHandlers.pageHide), 
      console.log("[EventManager] Event handlers removed");
    }
  }
  function q(e, t) {
    if (!e || "string" != typeof e) throw new Error(`QuickTab requires a valid string ${t}`);
  }
  class A {
    constructor({id: e, url: t, position: n, size: i, visibility: o, container: s, createdAt: a = Date.now(), title: r = "Quick Tab", zIndex: l = 1e3}) {
      (function({id: e, url: t, position: n, size: i}) {
        q(e, "id"), q(t, "url"), function(e) {
          if (!e || "number" != typeof e.left || "number" != typeof e.top) throw new Error("QuickTab requires valid position {left, top}");
        }(n), function(e) {
          if (!e || "number" != typeof e.width || "number" != typeof e.height) throw new Error("QuickTab requires valid size {width, height}");
        }(i);
      })({
        id: e,
        url: t,
        position: n,
        size: i
      }), this.id = e, this.url = t, this.container = s || "firefox-default", this.createdAt = a, 
      this.title = r, this.position = {
        ...n
      }, this.size = {
        ...i
      }, this.zIndex = l, this.visibility = {
        minimized: o?.minimized || !1,
        soloedOnTabs: o?.soloedOnTabs || [],
        mutedOnTabs: o?.mutedOnTabs || []
      };
    }
    shouldBeVisible(e) {
      return !this.visibility.minimized && (this.visibility.soloedOnTabs.length > 0 ? this.visibility.soloedOnTabs.includes(e) : !(this.visibility.mutedOnTabs.length > 0 && this.visibility.mutedOnTabs.includes(e)));
    }
    toggleSolo(e) {
      const t = this.visibility.soloedOnTabs.indexOf(e);
      return -1 === t ? (this.visibility.soloedOnTabs.push(e), this.visibility.mutedOnTabs = [], 
      !0) : (this.visibility.soloedOnTabs.splice(t, 1), !1);
    }
    solo(e) {
      this.visibility.soloedOnTabs.includes(e) || this.visibility.soloedOnTabs.push(e), 
      this.visibility.mutedOnTabs = [];
    }
    unsolo(e) {
      this.visibility.soloedOnTabs = this.visibility.soloedOnTabs.filter(t => t !== e);
    }
    clearSolo() {
      this.visibility.soloedOnTabs = [];
    }
    toggleMute(e) {
      const t = this.visibility.mutedOnTabs.indexOf(e);
      return -1 === t ? (this.visibility.mutedOnTabs.push(e), this.visibility.soloedOnTabs = [], 
      !0) : (this.visibility.mutedOnTabs.splice(t, 1), !1);
    }
    mute(e) {
      this.visibility.mutedOnTabs.includes(e) || this.visibility.mutedOnTabs.push(e), 
      this.visibility.soloedOnTabs = [];
    }
    unmute(e) {
      this.visibility.mutedOnTabs = this.visibility.mutedOnTabs.filter(t => t !== e);
    }
    clearMute() {
      this.visibility.mutedOnTabs = [];
    }
    toggleMinimized() {
      return this.visibility.minimized = !this.visibility.minimized, this.visibility.minimized;
    }
    setMinimized(e) {
      this.visibility.minimized = e;
    }
    updatePosition(e, t) {
      if ("number" != typeof e || "number" != typeof t) throw new Error("Position must be numeric {left, top}");
      this.position = {
        left: e,
        top: t
      };
    }
    updateSize(e, t) {
      if ("number" != typeof e || "number" != typeof t) throw new Error("Size must be numeric {width, height}");
      if (e <= 0 || t <= 0) throw new Error("Size must be positive");
      this.size = {
        width: e,
        height: t
      };
    }
    updateZIndex(e) {
      if ("number" != typeof e) throw new Error("zIndex must be a number");
      this.zIndex = e;
    }
    updateTitle(e) {
      if ("string" != typeof e) throw new Error("Title must be a string");
      this.title = e;
    }
    cleanupDeadTabs(e) {
      const t = new Set(e);
      this.visibility.soloedOnTabs = this.visibility.soloedOnTabs.filter(e => t.has(e)), 
      this.visibility.mutedOnTabs = this.visibility.mutedOnTabs.filter(e => t.has(e));
    }
    belongsToContainer(e) {
      return this.container === e;
    }
    serialize() {
      return {
        id: this.id,
        url: this.url,
        title: this.title,
        position: {
          ...this.position
        },
        size: {
          ...this.size
        },
        visibility: {
          minimized: this.visibility.minimized,
          soloedOnTabs: [ ...this.visibility.soloedOnTabs ],
          mutedOnTabs: [ ...this.visibility.mutedOnTabs ]
        },
        container: this.container,
        zIndex: this.zIndex,
        createdAt: this.createdAt
      };
    }
    static fromStorage(e) {
      return new A({
        id: e.id,
        url: e.url,
        title: e.title || "Quick Tab",
        position: e.position || {
          left: 100,
          top: 100
        },
        size: e.size || {
          width: 800,
          height: 600
        },
        visibility: e.visibility || {
          minimized: !1,
          soloedOnTabs: [],
          mutedOnTabs: []
        },
        container: e.container || e.cookieStoreId || "firefox-default",
        zIndex: e.zIndex || 1e3,
        createdAt: e.createdAt || Date.now()
      });
    }
    static create({id: e, url: t, left: n = 100, top: i = 100, width: o = 800, height: s = 600, container: a, title: r}) {
      if (!e) throw new Error("QuickTab.create requires id");
      if (!t) throw new Error("QuickTab.create requires url");
      return new A({
        id: e,
        url: t,
        title: r || "Quick Tab",
        position: {
          left: n,
          top: i
        },
        size: {
          width: o,
          height: s
        },
        visibility: {
          minimized: !1,
          soloedOnTabs: [],
          mutedOnTabs: []
        },
        container: a || "firefox-default",
        zIndex: 1e3,
        createdAt: Date.now()
      });
    }
  }
  var D = Object.freeze({
    __proto__: null,
    QuickTab: A
  });
  class L {
    constructor(e, t = null) {
      this.eventBus = e, this.currentTabId = t, this.quickTabs = new Map, this.currentZIndex = 1e4;
    }
    add(e) {
      if (!(e instanceof A)) throw new Error("StateManager.add() requires QuickTab instance");
      this.quickTabs.set(e.id, e), this.eventBus?.emit("state:added", e), console.log(`[StateManager] Added Quick Tab: ${e.id}`);
    }
    get(e) {
      return this.quickTabs.get(e);
    }
    has(e) {
      return this.quickTabs.has(e);
    }
    update(e) {
      if (!(e instanceof A)) throw new Error("StateManager.update() requires QuickTab instance");
      this.quickTabs.has(e.id) ? (this.quickTabs.set(e.id, e), this.eventBus?.emit("state:updated", e), 
      console.log(`[StateManager] Updated Quick Tab: ${e.id}`)) : console.warn(`[StateManager] Cannot update non-existent Quick Tab: ${e.id}`);
    }
    delete(e) {
      const t = this.quickTabs.get(e), n = this.quickTabs.delete(e);
      return n && (this.eventBus?.emit("state:deleted", t), console.log(`[StateManager] Deleted Quick Tab: ${e}`)), 
      n;
    }
    getAll() {
      return Array.from(this.quickTabs.values());
    }
    getVisible() {
      return this.currentTabId ? this.getAll().filter(e => e.shouldBeVisible(this.currentTabId)) : this.getAll();
    }
    getMinimized() {
      return this.getAll().filter(e => e.visibility.minimized);
    }
    getByContainer(e) {
      return this.getAll().filter(t => t.belongsToContainer(e));
    }
    hydrate(e) {
      if (!Array.isArray(e)) throw new Error("StateManager.hydrate() requires array of QuickTab instances");
      this.quickTabs.clear();
      for (const t of e) t instanceof A ? this.quickTabs.set(t.id, t) : console.warn("[StateManager] Skipping non-QuickTab instance during hydration");
      this.eventBus?.emit("state:hydrated", {
        count: e.length
      }), console.log(`[StateManager] Hydrated ${e.length} Quick Tabs`);
    }
    clear() {
      const e = this.quickTabs.size;
      this.quickTabs.clear(), this.currentZIndex = 1e4, this.eventBus?.emit("state:cleared", {
        count: e
      }), console.log(`[StateManager] Cleared ${e} Quick Tabs`);
    }
    count() {
      return this.quickTabs.size;
    }
    setCurrentTabId(e) {
      this.currentTabId = e, console.log(`[StateManager] Current tab ID set to: ${e}`);
    }
    getNextZIndex() {
      return this.currentZIndex += 1, this.currentZIndex;
    }
    updateZIndex(e, t) {
      const n = this.quickTabs.get(e);
      n && (n.updateZIndex(t), this.quickTabs.set(e, n), t > this.currentZIndex && (this.currentZIndex = t));
    }
    bringToFront(e) {
      const t = this.getNextZIndex();
      this.updateZIndex(e, t), this.eventBus?.emit("state:z-index-changed", {
        id: e,
        zIndex: t
      });
    }
    cleanupDeadTabs(e) {
      let t = 0;
      for (const n of this.quickTabs.values()) {
        const i = n.visibility.soloedOnTabs.length + n.visibility.mutedOnTabs.length;
        n.cleanupDeadTabs(e), i !== n.visibility.soloedOnTabs.length + n.visibility.mutedOnTabs.length && (this.quickTabs.set(n.id, n), 
        t++);
      }
      t > 0 && (console.log(`[StateManager] Cleaned dead tabs from ${t} Quick Tabs`), 
      this.eventBus?.emit("state:cleaned", {
        count: t
      }));
    }
  }
  class R {
    async save(e, t) {
      throw new Error("StorageAdapter.save() must be implemented by subclass");
    }
    async load(e) {
      throw new Error("StorageAdapter.load() must be implemented by subclass");
    }
    async loadAll() {
      throw new Error("StorageAdapter.loadAll() must be implemented by subclass");
    }
    async delete(e, t) {
      throw new Error("StorageAdapter.delete() must be implemented by subclass");
    }
    async deleteContainer(e) {
      throw new Error("StorageAdapter.deleteContainer() must be implemented by subclass");
    }
    async clear() {
      throw new Error("StorageAdapter.clear() must be implemented by subclass");
    }
  }
  class U extends R {
    constructor() {
      super(), this.STORAGE_KEY = "quick_tabs_state_v2";
    }
    async save(t, n) {
      const i = await this._loadRawState();
      i.containers || (i.containers = {}), i.containers[t] = {
        tabs: n.map(e => e.serialize()),
        lastUpdate: Date.now()
      };
      const o = this._generateSaveId();
      i.saveId = o, i.timestamp = Date.now();
      const s = {
        [this.STORAGE_KEY]: i
      };
      try {
        return await e.storage.session.set(s), console.log(`[SessionStorageAdapter] Saved ${n.length} tabs for container ${t} (saveId: ${o})`), 
        o;
      } catch (e) {
        throw console.error("[SessionStorageAdapter] Save failed:", e), e;
      }
    }
    async load(e) {
      const t = await this._loadRawState();
      return t.containers && t.containers[e] ? t.containers[e] : null;
    }
    async loadAll() {
      return (await this._loadRawState()).containers || {};
    }
    async delete(e, t) {
      const n = await this.load(e);
      if (!n) return void console.warn(`[SessionStorageAdapter] Container ${e} not found for deletion`);
      const i = n.tabs.filter(e => e.id !== t);
      if (i.length === n.tabs.length) return void console.warn(`[SessionStorageAdapter] Quick Tab ${t} not found in container ${e}`);
      const {QuickTab: o} = await Promise.resolve().then(function() {
        return D;
      }), s = i.map(e => o.fromStorage(e));
      await this.save(e, s), console.log(`[SessionStorageAdapter] Deleted Quick Tab ${t} from container ${e}`);
    }
    async deleteContainer(t) {
      const n = await this._loadRawState();
      n.containers && n.containers[t] ? (delete n.containers[t], n.timestamp = Date.now(), 
      n.saveId = this._generateSaveId(), await e.storage.session.set({
        [this.STORAGE_KEY]: n
      }), console.log(`[SessionStorageAdapter] Deleted all Quick Tabs for container ${t}`)) : console.warn(`[SessionStorageAdapter] Container ${t} not found for deletion`);
    }
    async clear() {
      await e.storage.session.remove(this.STORAGE_KEY), console.log("[SessionStorageAdapter] Cleared all Quick Tabs");
    }
    async _loadRawState() {
      try {
        const t = await e.storage.session.get(this.STORAGE_KEY);
        return t[this.STORAGE_KEY] ? t[this.STORAGE_KEY] : {
          containers: {},
          timestamp: Date.now(),
          saveId: this._generateSaveId()
        };
      } catch (e) {
        return console.error("[SessionStorageAdapter] Load failed:", e), {
          containers: {},
          timestamp: Date.now(),
          saveId: this._generateSaveId()
        };
      }
    }
    _generateSaveId() {
      return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
  }
  class N extends R {
    constructor() {
      super(), this.STORAGE_KEY = "quick_tabs_state_v2", this.MAX_SYNC_SIZE = 102400;
    }
    async save(t, n) {
      const i = await this._loadRawState();
      i.containers || (i.containers = {}), i.containers[t] = {
        tabs: n.map(e => e.serialize()),
        lastUpdate: Date.now()
      };
      const o = this._generateSaveId();
      i.saveId = o, i.timestamp = Date.now();
      const s = {
        [this.STORAGE_KEY]: i
      }, a = this._calculateSize(s);
      try {
        if (a > this.MAX_SYNC_SIZE) throw console.warn(`[SyncStorageAdapter] State size ${a} bytes exceeds sync limit of ${this.MAX_SYNC_SIZE} bytes`), 
        new Error(`QUOTA_BYTES: State too large (${a} bytes, max ${this.MAX_SYNC_SIZE} bytes)`);
        return await e.storage.sync.set(s), console.log(`[SyncStorageAdapter] Saved ${n.length} tabs for container ${t} (saveId: ${o})`), 
        o;
      } catch (e) {
        return this._handleSaveError(e, s, o);
      }
    }
    async _handleSaveError(t, n, i) {
      if (!t.message || !t.message.includes("QUOTA_BYTES")) throw console.error("[SyncStorageAdapter] Save failed:", t), 
      t;
      console.error("[SyncStorageAdapter] Sync storage quota exceeded, falling back to local storage");
      try {
        return await e.storage.local.set(n), console.log(`[SyncStorageAdapter] Fallback: Saved to local storage (saveId: ${i})`), 
        i;
      } catch (e) {
        throw console.error("[SyncStorageAdapter] Local storage fallback failed:", e), new Error(`Failed to save: ${e.message}`);
      }
    }
    async load(e) {
      const t = await this._loadRawState();
      return t.containers && t.containers[e] ? t.containers[e] : null;
    }
    async loadAll() {
      return (await this._loadRawState()).containers || {};
    }
    async delete(e, t) {
      const n = await this.load(e);
      if (!n) return void console.warn(`[SyncStorageAdapter] Container ${e} not found for deletion`);
      const i = n.tabs.filter(e => e.id !== t);
      if (i.length === n.tabs.length) return void console.warn(`[SyncStorageAdapter] Quick Tab ${t} not found in container ${e}`);
      const {QuickTab: o} = await Promise.resolve().then(function() {
        return D;
      }), s = i.map(e => o.fromStorage(e));
      await this.save(e, s), console.log(`[SyncStorageAdapter] Deleted Quick Tab ${t} from container ${e}`);
    }
    async deleteContainer(t) {
      const n = await this._loadRawState();
      n.containers && n.containers[t] ? (delete n.containers[t], n.timestamp = Date.now(), 
      n.saveId = this._generateSaveId(), await e.storage.sync.set({
        [this.STORAGE_KEY]: n
      }), console.log(`[SyncStorageAdapter] Deleted all Quick Tabs for container ${t}`)) : console.warn(`[SyncStorageAdapter] Container ${t} not found for deletion`);
    }
    async clear() {
      await e.storage.sync.remove(this.STORAGE_KEY), console.log("[SyncStorageAdapter] Cleared all Quick Tabs");
    }
    async _loadRawState() {
      try {
        const t = await e.storage.sync.get(this.STORAGE_KEY);
        if (t[this.STORAGE_KEY]) return t[this.STORAGE_KEY];
        const n = await e.storage.local.get(this.STORAGE_KEY);
        return n[this.STORAGE_KEY] ? (console.log("[SyncStorageAdapter] Loaded from local storage (fallback)"), 
        n[this.STORAGE_KEY]) : {
          containers: {},
          timestamp: Date.now(),
          saveId: this._generateSaveId()
        };
      } catch (e) {
        return console.error("[SyncStorageAdapter] Load failed:", e), {
          containers: {},
          timestamp: Date.now(),
          saveId: this._generateSaveId()
        };
      }
    }
    _generateSaveId() {
      return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    _calculateSize(e) {
      try {
        const t = JSON.stringify(e);
        return new Blob([ t ]).size;
      } catch (e) {
        return console.error("[SyncStorageAdapter] Size calculation failed:", e), 0;
      }
    }
  }
  class $ {
    constructor(e, t = "firefox-default") {
      this.eventBus = e, this.cookieStoreId = t, this.syncAdapter = new N, this.sessionAdapter = new U, 
      this.pendingSaveIds = new Set, this.saveIdTimers = new Map, this.SAVE_ID_GRACE_MS = 1e3, 
      this.latestStorageSnapshot = null, this.storageSyncTimer = null, this.STORAGE_SYNC_DELAY_MS = 100;
    }
    async save(e) {
      if (!e || 0 === e.length) return console.log("[StorageManager] No Quick Tabs to save"), 
      null;
      try {
        const t = e.map(e => e.serialize()), n = await this.syncAdapter.save(this.cookieStoreId, t);
        return this.trackPendingSave(n), this.eventBus?.emit("storage:saved", {
          cookieStoreId: this.cookieStoreId,
          saveId: n
        }), console.log(`[StorageManager] Saved ${e.length} Quick Tabs for container ${this.cookieStoreId}`), 
        n;
      } catch (e) {
        throw console.error("[StorageManager] Save error:", e), this.eventBus?.emit("storage:error", {
          operation: "save",
          error: e
        }), e;
      }
    }
    async loadAll() {
      try {
        let e = await this.sessionAdapter.load(this.cookieStoreId);
        if (e || (e = await this.syncAdapter.load(this.cookieStoreId)), !e || !e.tabs) return console.log(`[StorageManager] No data found for container ${this.cookieStoreId}`), 
        [];
        const t = e.tabs.map(e => A.fromStorage(e));
        return console.log(`[StorageManager] Loaded ${t.length} Quick Tabs for container ${this.cookieStoreId}`), 
        t;
      } catch (e) {
        return console.error("[StorageManager] Load error:", e), this.eventBus?.emit("storage:error", {
          operation: "load",
          error: e
        }), [];
      }
    }
    setupStorageListeners() {
      "undefined" != typeof browser && browser.storage ? (browser.storage.onChanged.addListener((e, t) => {
        console.log("[StorageManager] Storage changed:", t, Object.keys(e)), "sync" === t && e.quick_tabs_state_v2 && this.handleStorageChange(e.quick_tabs_state_v2.newValue), 
        "session" === t && e.quick_tabs_session && this.handleStorageChange(e.quick_tabs_session.newValue);
      }), console.log("[StorageManager] Storage listeners attached")) : console.warn("[StorageManager] Storage API not available");
    }
    handleStorageChange(e) {
      if (e && !this.shouldIgnoreStorageChange(e?.saveId)) if (this.pendingSaveIds.size > 0 && !e?.saveId) console.log("[StorageManager] Ignoring change while pending saves in-flight:", Array.from(this.pendingSaveIds)); else if (e.containers && this.cookieStoreId) {
        const t = e.containers[this.cookieStoreId];
        if (t) {
          console.log(`[StorageManager] Scheduling sync for container ${this.cookieStoreId}`);
          const e = {
            containers: {
              [this.cookieStoreId]: t
            }
          };
          this.scheduleStorageSync(e);
        }
      } else console.log("[StorageManager] Scheduling sync (legacy format)"), this.scheduleStorageSync(e);
    }
    shouldIgnoreStorageChange(e) {
      return !(!e || !this.pendingSaveIds.has(e) || (console.log("[StorageManager] Ignoring storage change for pending save:", e), 
      0));
    }
    scheduleStorageSync(e) {
      this.latestStorageSnapshot = e, this.storageSyncTimer && clearTimeout(this.storageSyncTimer), 
      this.storageSyncTimer = setTimeout(async () => {
        const e = this.latestStorageSnapshot;
        this.latestStorageSnapshot = null, this.storageSyncTimer = null, this.eventBus?.emit("storage:changed", {
          containerFilter: this.cookieStoreId,
          state: e
        });
      }, this.STORAGE_SYNC_DELAY_MS);
    }
    trackPendingSave(e) {
      if (!e) return;
      this.saveIdTimers.has(e) && (clearTimeout(this.saveIdTimers.get(e)), this.saveIdTimers.delete(e)), 
      this.pendingSaveIds.add(e);
      const t = setTimeout(() => {
        this.releasePendingSave(e);
      }, this.SAVE_ID_GRACE_MS);
      this.saveIdTimers.set(e, t);
    }
    releasePendingSave(e) {
      e && (this.saveIdTimers.has(e) && (clearTimeout(this.saveIdTimers.get(e)), this.saveIdTimers.delete(e)), 
      this.pendingSaveIds.delete(e) && console.log("[StorageManager] Released saveId:", e));
    }
    async delete(e) {
      try {
        await this.syncAdapter.delete(this.cookieStoreId, e), this.eventBus?.emit("storage:deleted", {
          cookieStoreId: this.cookieStoreId,
          quickTabId: e
        });
      } catch (e) {
        throw console.error("[StorageManager] Delete error:", e), this.eventBus?.emit("storage:error", {
          operation: "delete",
          error: e
        }), e;
      }
    }
    async clear() {
      try {
        await this.syncAdapter.deleteContainer(this.cookieStoreId), this.eventBus?.emit("storage:cleared", {
          cookieStoreId: this.cookieStoreId
        });
      } catch (e) {
        throw console.error("[StorageManager] Clear error:", e), this.eventBus?.emit("storage:error", {
          operation: "clear",
          error: e
        }), e;
      }
    }
  }
  class H {
    constructor() {
      this.minimizedTabs = new Map;
    }
    add(e, t) {
      this.minimizedTabs.set(e, t), console.log("[MinimizedManager] Added minimized tab:", e);
    }
    remove(e) {
      this.minimizedTabs.delete(e), console.log("[MinimizedManager] Removed minimized tab:", e);
    }
    restore(e) {
      const t = this.minimizedTabs.get(e);
      if (t) {
        const n = t.left, i = t.top, o = t.width, s = t.height;
        return t.restore(), t.container && (t.container.style.left = `${n}px`, t.container.style.top = `${i}px`, 
        t.container.style.width = `${o}px`, t.container.style.height = `${s}px`), this.minimizedTabs.delete(e), 
        console.log("[MinimizedManager] Restored tab with position:", {
          id: e,
          left: n,
          top: i
        }), !0;
      }
      return !1;
    }
    getAll() {
      return Array.from(this.minimizedTabs.values());
    }
    getCount() {
      return this.minimizedTabs.size;
    }
    isMinimized(e) {
      return this.minimizedTabs.has(e);
    }
    clear() {
      this.minimizedTabs.clear(), console.log("[MinimizedManager] Cleared all minimized tabs");
    }
  }
  let Q = !1;
  const F = [];
  function Z(...e) {
    !function(e, ...t) {
      F.length >= 5e3 && F.shift(), F.push({
        type: e,
        timestamp: Date.now(),
        message: t.map(e => "object" == typeof e ? JSON.stringify(e, null, 2) : String(e)).join(" "),
        args: t
      });
    }("DEBUG", ...e), Q && console.log("[DEBUG]", ...e);
  }
  class G {
    constructor(e, t) {
      this.panel = e, this.uiBuilder = t.uiBuilder, this.stateManager = t.stateManager, 
      this.quickTabsManager = t.quickTabsManager, this.currentContainerId = t.currentContainerId, 
      this.eventListeners = [], this.isOpen = !1;
    }
    setIsOpen(e) {
      this.isOpen = e;
    }
    async updateContent() {
      if (!this.panel || !this.isOpen) return;
      const e = await this._fetchQuickTabsFromStorage();
      if (!e) return;
      const t = e[this.currentContainerId], n = t?.tabs || [], i = t?.lastUpdate || 0;
      if (this._updateStatistics(n.length, i), 0 === n.length) return void this._renderEmptyState();
      const o = await this._fetchContainerInfo();
      this._renderContainerSection(t, o);
    }
    async _fetchQuickTabsFromStorage() {
      try {
        const e = await browser.storage.sync.get("quick_tabs_state_v2");
        if (!e || !e.quick_tabs_state_v2) return null;
        const t = e.quick_tabs_state_v2;
        return t.containers || t;
      } catch (e) {
        return console.error("[PanelContentManager] Error loading Quick Tabs:", e), null;
      }
    }
    async _fetchContainerInfo() {
      const e = {
        name: "Default",
        icon: "📁",
        color: "grey"
      };
      try {
        if ("firefox-default" === this.currentContainerId || void 0 === browser.contextualIdentities) return e;
        const t = (await browser.contextualIdentities.query({})).find(e => e.cookieStoreId === this.currentContainerId);
        return t ? {
          name: t.name,
          icon: this.uiBuilder.getContainerIcon(t.icon),
          color: t.color
        } : e;
      } catch (t) {
        return console.error("[PanelContentManager] Error loading container:", t), e;
      }
    }
    _updateStatistics(e, t) {
      const n = this.panel.querySelector("#panel-totalTabs"), i = this.panel.querySelector("#panel-lastSync");
      if (n && (n.textContent = `${e} Quick Tab${1 !== e ? "s" : ""}`), i) if (t > 0) {
        const e = new Date(t);
        i.textContent = `Last sync: ${e.toLocaleTimeString()}`;
      } else i.textContent = "Last sync: Never";
    }
    _renderEmptyState() {
      const e = this.panel.querySelector("#panel-containersList"), t = this.panel.querySelector("#panel-emptyState");
      e && (e.style.display = "none"), t && (t.style.display = "flex");
    }
    _renderContainerSection(e, t) {
      const n = this.panel.querySelector("#panel-containersList"), i = this.panel.querySelector("#panel-emptyState");
      i && (i.style.display = "none"), n && (n.style.display = "block", n.innerHTML = "", 
      this.uiBuilder.renderContainerSection(n, this.currentContainerId, t, e));
    }
    setupEventListeners() {
      const e = this.panel.querySelector(".panel-close"), t = e => {
        e.stopPropagation(), this.onClose && this.onClose();
      };
      e.addEventListener("click", t), this.eventListeners.push({
        element: e,
        type: "click",
        handler: t
      });
      const n = this.panel.querySelector(".panel-minimize"), i = e => {
        e.stopPropagation(), this.onClose && this.onClose();
      };
      n.addEventListener("click", i), this.eventListeners.push({
        element: n,
        type: "click",
        handler: i
      });
      const o = this.panel.querySelector("#panel-closeMinimized"), s = async e => {
        e.stopPropagation(), await this.handleCloseMinimized();
      };
      o.addEventListener("click", s), this.eventListeners.push({
        element: o,
        type: "click",
        handler: s
      });
      const a = this.panel.querySelector("#panel-closeAll"), r = async e => {
        e.stopPropagation(), await this.handleCloseAll();
      };
      a.addEventListener("click", r), this.eventListeners.push({
        element: a,
        type: "click",
        handler: r
      });
      const l = this.panel.querySelector("#panel-containersList"), c = async e => {
        const t = e.target.closest("button[data-action]");
        if (!t) return;
        e.stopPropagation();
        const n = t.dataset.action, i = t.dataset.quickTabId, o = t.dataset.tabId;
        await this._handleQuickTabAction(n, i, o);
      };
      l.addEventListener("click", c), this.eventListeners.push({
        element: l,
        type: "click",
        handler: c
      }), Z("[PanelContentManager] Event listeners setup");
    }
    async _handleQuickTabAction(e, t, n) {
      switch (e) {
       case "goToTab":
        await this.handleGoToTab(parseInt(n, 10));
        break;

       case "minimize":
        await this.handleMinimizeTab(t);
        break;

       case "restore":
        await this.handleRestoreTab(t);
        break;

       case "close":
        await this.handleCloseTab(t);
        break;

       default:
        console.warn(`[PanelContentManager] Unknown action: ${e}`);
      }
      setTimeout(() => this.updateContent(), 100);
    }
    async handleCloseMinimized() {
      try {
        const e = await browser.storage.sync.get("quick_tabs_state_v2");
        if (!e || !e.quick_tabs_state_v2) return;
        const t = e.quick_tabs_state_v2;
        let n = !1;
        const i = t.containers || t;
        if (Object.keys(i).forEach(e => {
          if ("saveId" === e || "timestamp" === e) return;
          const t = i[e];
          if (!t?.tabs || !Array.isArray(t.tabs)) return;
          const o = t.tabs.length;
          t.tabs = t.tabs.filter(e => !e.minimized), t.tabs.length !== o && (n = !0, t.lastUpdate = Date.now());
        }), n) {
          const e = {
            containers: i,
            saveId: this._generateSaveId(),
            timestamp: Date.now()
          };
          await browser.storage.sync.set({
            quick_tabs_state_v2: e
          }), await this._updateSessionStorage(e), Z("[PanelContentManager] Closed minimized Quick Tabs"), 
          await this.updateContent();
        }
      } catch (e) {
        console.error("[PanelContentManager] Error closing minimized:", e);
      }
    }
    async _updateSessionStorage(e) {
      void 0 !== browser.storage.session && await browser.storage.session.set({
        quick_tabs_session: e
      });
    }
    async handleCloseAll() {
      try {
        const e = {
          containers: {
            "firefox-default": {
              tabs: [],
              lastUpdate: Date.now()
            }
          },
          saveId: this._generateSaveId(),
          timestamp: Date.now()
        };
        await browser.storage.sync.set({
          quick_tabs_state_v2: e
        }), await this._updateSessionStorage(e), browser.runtime.sendMessage({
          action: "CLEAR_ALL_QUICK_TABS"
        }).catch(() => {}), Z("[PanelContentManager] Closed all Quick Tabs"), await this.updateContent();
      } catch (e) {
        console.error("[PanelContentManager] Error closing all:", e);
      }
    }
    async handleGoToTab(e) {
      try {
        await browser.tabs.update(e, {
          active: !0
        }), Z(`[PanelContentManager] Switched to tab ${e}`);
      } catch (e) {
        console.error("[PanelContentManager] Error switching to tab:", e);
      }
    }
    handleMinimizeTab(e) {
      this.quickTabsManager?.minimizeById && this.quickTabsManager.minimizeById(e);
    }
    handleRestoreTab(e) {
      this.quickTabsManager?.restoreById && this.quickTabsManager.restoreById(e);
    }
    handleCloseTab(e) {
      this.quickTabsManager?.closeById && this.quickTabsManager.closeById(e);
    }
    _generateSaveId() {
      return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    setOnClose(e) {
      this.onClose = e;
    }
    destroy() {
      this.eventListeners.forEach(({element: e, type: t, handler: n}) => {
        e && e.removeEventListener(t, n);
      }), this.eventListeners = [], this.panel = null, this.uiBuilder = null, this.stateManager = null, 
      this.quickTabsManager = null, this.onClose = null, Z("[PanelContentManager] Destroyed");
    }
  }
  class W {
    constructor(e, t, n = {}) {
      this.panel = e, this.handle = t, this.onDragEnd = n.onDragEnd || null, this.onBroadcast = n.onBroadcast || null, 
      this.isDragging = !1, this.currentPointerId = null, this.offsetX = 0, this.offsetY = 0, 
      this._setupEventListeners();
    }
    _setupEventListeners() {
      this.handle.addEventListener("pointerdown", this._handlePointerDown.bind(this)), 
      this.handle.addEventListener("pointermove", this._handlePointerMove.bind(this)), 
      this.handle.addEventListener("pointerup", this._handlePointerUp.bind(this)), this.handle.addEventListener("pointercancel", this._handlePointerCancel.bind(this));
    }
    _handlePointerDown(e) {
      if (0 !== e.button) return;
      if (e.target.classList.contains("panel-btn")) return;
      this.isDragging = !0, this.currentPointerId = e.pointerId, this.handle.setPointerCapture(e.pointerId);
      const t = this.panel.getBoundingClientRect();
      this.offsetX = e.clientX - t.left, this.offsetY = e.clientY - t.top, this.handle.style.cursor = "grabbing", 
      e.preventDefault();
    }
    _handlePointerMove(e) {
      if (!this.isDragging || e.pointerId !== this.currentPointerId) return;
      const t = e.clientX - this.offsetX, n = e.clientY - this.offsetY;
      this.panel.style.left = `${t}px`, this.panel.style.top = `${n}px`, e.preventDefault();
    }
    _handlePointerUp(e) {
      if (!this.isDragging || e.pointerId !== this.currentPointerId) return;
      this.isDragging = !1, this.handle.releasePointerCapture(e.pointerId), this.handle.style.cursor = "grab";
      const t = this.panel.getBoundingClientRect(), n = t.left, i = t.top;
      this.onDragEnd && this.onDragEnd(n, i), this.onBroadcast && this.onBroadcast({
        left: n,
        top: i
      });
    }
    _handlePointerCancel(e) {
      if (!this.isDragging) return;
      this.isDragging = !1, this.handle.style.cursor = "grab";
      const t = this.panel.getBoundingClientRect();
      this.onDragEnd && this.onDragEnd(t.left, t.top);
    }
    destroy() {
      this.handle.removeEventListener("pointerdown", this._handlePointerDown), this.handle.removeEventListener("pointermove", this._handlePointerMove), 
      this.handle.removeEventListener("pointerup", this._handlePointerUp), this.handle.removeEventListener("pointercancel", this._handlePointerCancel), 
      this.panel = null, this.handle = null, this.onDragEnd = null, this.onBroadcast = null;
    }
  }
  const Y = {
    nw: {
      cursor: "nw-resize",
      position: {
        top: 0,
        left: 0
      },
      size: {
        width: 10,
        height: 10
      },
      directions: [ "w", "n" ]
    },
    ne: {
      cursor: "ne-resize",
      position: {
        top: 0,
        right: 0
      },
      size: {
        width: 10,
        height: 10
      },
      directions: [ "e", "n" ]
    },
    sw: {
      cursor: "sw-resize",
      position: {
        bottom: 0,
        left: 0
      },
      size: {
        width: 10,
        height: 10
      },
      directions: [ "w", "s" ]
    },
    se: {
      cursor: "se-resize",
      position: {
        bottom: 0,
        right: 0
      },
      size: {
        width: 10,
        height: 10
      },
      directions: [ "e", "s" ]
    },
    n: {
      cursor: "n-resize",
      position: {
        top: 0,
        left: 10,
        right: 10
      },
      size: {
        height: 10
      },
      directions: [ "n" ]
    },
    s: {
      cursor: "s-resize",
      position: {
        bottom: 0,
        left: 10,
        right: 10
      },
      size: {
        height: 10
      },
      directions: [ "s" ]
    },
    e: {
      cursor: "e-resize",
      position: {
        top: 10,
        right: 0,
        bottom: 10
      },
      size: {
        width: 10
      },
      directions: [ "e" ]
    },
    w: {
      cursor: "w-resize",
      position: {
        top: 10,
        left: 0,
        bottom: 10
      },
      size: {
        width: 10
      },
      directions: [ "w" ]
    }
  };
  class K {
    constructor(e, t = {}) {
      this.panel = e, this.callbacks = t, this.handles = [], this.minWidth = 250, this.minHeight = 300, 
      this._attachHandles();
    }
    _attachHandles() {
      Object.entries(Y).forEach(([e, t]) => {
        const n = this._createHandle(e, t);
        this.panel.appendChild(n), this.handles.push({
          direction: e,
          element: n
        });
      }), Z("[PanelResizeController] Attached 8 resize handles");
    }
    _createHandle(e, t) {
      const n = document.createElement("div");
      n.className = `panel-resize-handle ${e}`;
      const i = {
        position: "absolute",
        cursor: t.cursor,
        zIndex: "10",
        ...this._buildPositionStyles(t.position),
        ...this._buildSizeStyles(t.size)
      };
      return n.style.cssText = Object.entries(i).map(([e, t]) => `${this._camelToKebab(e)}: ${t};`).join(" "), 
      this._attachHandleListeners(n, e, t), n;
    }
    _buildPositionStyles(e) {
      const t = {};
      return void 0 !== e.top && (t.top = `${e.top}px`), void 0 !== e.bottom && (t.bottom = `${e.bottom}px`), 
      void 0 !== e.left && (t.left = `${e.left}px`), void 0 !== e.right && (t.right = `${e.right}px`), 
      t;
    }
    _buildSizeStyles(e) {
      const t = {};
      return e.width && (t.width = `${e.width}px`), e.height && (t.height = `${e.height}px`), 
      t;
    }
    _camelToKebab(e) {
      return e.replace(/[A-Z]/g, e => `-${e.toLowerCase()}`);
    }
    _attachHandleListeners(e, t, n) {
      let i = !1, o = null, s = null;
      e.addEventListener("pointerdown", t => {
        s = this._initResize(t, e), s && (i = !0, o = t.pointerId);
      }), e.addEventListener("pointermove", e => {
        i && e.pointerId === o && (this._performResize(e, s, n, t), e.preventDefault());
      }), e.addEventListener("pointerup", t => {
        i && t.pointerId === o && (this._finishResize(e, t.pointerId), i = !1);
      }), e.addEventListener("pointercancel", t => {
        i && (this._finishResize(e, null), i = !1);
      });
    }
    _initResize(e, t) {
      if (0 !== e.button) return null;
      t.setPointerCapture && t.setPointerCapture(e.pointerId);
      const n = this.panel.getBoundingClientRect(), i = {
        x: e.clientX,
        y: e.clientY,
        width: n.width,
        height: n.height,
        left: n.left,
        top: n.top
      };
      return e.preventDefault(), e.stopPropagation(), i;
    }
    _performResize(e, t, n, i) {
      const o = e.clientX - t.x, s = e.clientY - t.y, {newWidth: a, newHeight: r, newLeft: l, newTop: c} = this._calculateNewDimensions(i, n.directions, t, o, s);
      this.panel.style.width = `${a}px`, this.panel.style.height = `${r}px`, this.panel.style.left = `${l}px`, 
      this.panel.style.top = `${c}px`, this.callbacks.onSizeChange && this.callbacks.onSizeChange(a, r), 
      !this.callbacks.onPositionChange || l === t.left && c === t.top || this.callbacks.onPositionChange(l, c);
    }
    _finishResize(e, t) {
      t && e.releasePointerCapture && e.releasePointerCapture(t);
      const n = this.panel.getBoundingClientRect();
      this.callbacks.onResizeEnd && this.callbacks.onResizeEnd(n.width, n.height, n.left, n.top), 
      this.callbacks.onBroadcast && this.callbacks.onBroadcast({
        width: n.width,
        height: n.height,
        left: n.left,
        top: n.top
      }), Z(`[PanelResizeController] Resize end: ${n.width}x${n.height} at (${n.left}, ${n.top})`);
    }
    _calculateNewDimensions(e, t, n, i, o) {
      let s = n.width, a = n.height, r = n.left, l = n.top;
      if (t.includes("e") && (s = Math.max(this.minWidth, n.width + i)), t.includes("w")) {
        const e = n.width - this.minWidth, t = Math.min(i, e);
        s = n.width - t, r = n.left + t;
      }
      if (t.includes("s") && (a = Math.max(this.minHeight, n.height + o)), t.includes("n")) {
        const e = n.height - this.minHeight, t = Math.min(o, e);
        a = n.height - t, l = n.top + t;
      }
      return {
        newWidth: s,
        newHeight: a,
        newLeft: r,
        newTop: l
      };
    }
    destroy() {
      this.handles.forEach(({element: e}) => {
        e.remove();
      }), this.handles = [], Z("[PanelResizeController] Destroyed all handles");
    }
  }
  class j {
    constructor(e = {}) {
      this.callbacks = e, this.currentContainerId = "firefox-default", this.broadcastChannel = null, 
      this.broadcastDebounce = new Map, this.BROADCAST_DEBOUNCE_MS = 50, this.panelState = {
        left: 100,
        top: 100,
        width: 350,
        height: 500,
        isOpen: !1
      };
    }
    async init() {
      await this.detectContainerContext(), this.setupBroadcastChannel(), await this.loadPanelState(), 
      Z("[PanelStateManager] Initialized");
    }
    async detectContainerContext() {
      if (this.currentContainerId = "firefox-default", "undefined" == typeof browser || !browser.tabs) return Z("[PanelStateManager] Browser tabs API not available, using default container"), 
      this.currentContainerId;
      try {
        const e = await browser.tabs.query({
          active: !0,
          currentWindow: !0
        });
        e && e.length > 0 && e[0].cookieStoreId ? (this.currentContainerId = e[0].cookieStoreId, 
        Z(`[PanelStateManager] Container detected: ${this.currentContainerId}`)) : Z("[PanelStateManager] No cookieStoreId, using default container");
      } catch (e) {
        Z("[PanelStateManager] Failed to detect container:", e);
      }
      return this.currentContainerId;
    }
    setupBroadcastChannel() {
      if ("undefined" != typeof BroadcastChannel) try {
        this.broadcastChannel = new BroadcastChannel("quick-tabs-panel-sync"), this.broadcastChannel.onmessage = e => {
          this._handleBroadcast(e.data);
        }, Z("[PanelStateManager] BroadcastChannel initialized");
      } catch (e) {
        console.error("[PanelStateManager] Failed to setup BroadcastChannel:", e);
      } else Z("[PanelStateManager] BroadcastChannel not available");
    }
    _handleBroadcast(e) {
      const {type: t, data: n} = e, i = Date.now(), o = this.broadcastDebounce.get(t);
      o && i - o < this.BROADCAST_DEBOUNCE_MS ? Z(`[PanelStateManager] Ignoring duplicate broadcast: ${t}`) : (this.broadcastDebounce.set(t, i), 
      this.callbacks.onBroadcastReceived && this.callbacks.onBroadcastReceived(t, n));
    }
    async loadPanelState() {
      try {
        const e = await browser.storage.local.get("quick_tabs_panel_state");
        if (!e || !e.quick_tabs_panel_state) return this.panelState;
        this.panelState = {
          ...this.panelState,
          ...e.quick_tabs_panel_state
        }, Z("[PanelStateManager] Loaded panel state:", this.panelState), this.callbacks.onStateLoaded && this.callbacks.onStateLoaded(this.panelState);
      } catch (e) {
        console.error("[PanelStateManager] Error loading panel state:", e);
      }
      return this.panelState;
    }
    async savePanelState(e) {
      if (!e) return;
      const t = e.getBoundingClientRect();
      this.panelState = {
        left: Math.round(t.left),
        top: Math.round(t.top),
        width: Math.round(t.width),
        height: Math.round(t.height),
        isOpen: this.panelState.isOpen
      };
      try {
        await browser.storage.local.set({
          quick_tabs_panel_state: this.panelState
        }), Z("[PanelStateManager] Saved panel state");
      } catch (e) {
        console.error("[PanelStateManager] Error saving panel state:", e);
      }
    }
    savePanelStateLocal(e) {
      if (!e) return;
      const t = e.getBoundingClientRect();
      this.panelState = {
        left: Math.round(t.left),
        top: Math.round(t.top),
        width: Math.round(t.width),
        height: Math.round(t.height),
        isOpen: this.panelState.isOpen
      }, Z("[PanelStateManager] Updated local state (no storage write)");
    }
    broadcast(e, t) {
      if (this.broadcastChannel) try {
        this.broadcastChannel.postMessage({
          type: e,
          data: t,
          timestamp: Date.now()
        }), Z(`[PanelStateManager] Broadcast sent: ${e}`);
      } catch (e) {
        console.error("[PanelStateManager] Error broadcasting:", e);
      }
    }
    setIsOpen(e) {
      this.panelState.isOpen = e;
    }
    getState() {
      return {
        ...this.panelState
      };
    }
    destroy() {
      this.broadcastChannel && (this.broadcastChannel.close(), this.broadcastChannel = null), 
      this.broadcastDebounce.clear(), Z("[PanelStateManager] Destroyed");
    }
  }
  class X {
    static injectStyles() {
      if (document.getElementById("quick-tabs-manager-panel-styles")) return !1;
      const e = document.createElement("style");
      return e.id = "quick-tabs-manager-panel-styles", e.textContent = '\n/* Quick Tabs Manager Floating Panel Styles */\n\n.quick-tabs-manager-panel {\n  position: fixed;\n  top: 100px;\n  right: 20px;\n  width: 350px;\n  height: 500px;\n  background: #2d2d2d;\n  border: 2px solid #555;\n  border-radius: 8px;\n  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);\n  z-index: 999999999; /* Above all Quick Tabs */\n  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\n  font-size: 13px;\n  color: #e0e0e0;\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  min-width: 250px;\n  min-height: 300px;\n}\n\n/* Panel Header (draggable) */\n.panel-header {\n  background: #1e1e1e;\n  border-bottom: 1px solid #555;\n  padding: 10px 12px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  cursor: grab;\n  user-select: none;\n}\n\n.panel-header:active {\n  cursor: grabbing;\n}\n\n.panel-drag-handle {\n  font-size: 18px;\n  color: #888;\n  cursor: grab;\n}\n\n.panel-title {\n  flex: 1;\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n}\n\n.panel-controls {\n  display: flex;\n  gap: 4px;\n}\n\n.panel-btn {\n  width: 24px;\n  height: 24px;\n  background: transparent;\n  color: #e0e0e0;\n  border: none;\n  border-radius: 4px;\n  cursor: pointer;\n  font-size: 16px;\n  font-weight: bold;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  transition: background 0.2s;\n}\n\n.panel-btn:hover {\n  background: #444;\n}\n\n.panel-close:hover {\n  background: #ff5555;\n}\n\n/* Panel Actions */\n.panel-actions {\n  padding: 10px 12px;\n  background: #2d2d2d;\n  border-bottom: 1px solid #555;\n  display: flex;\n  gap: 8px;\n}\n\n.panel-btn-secondary,\n.panel-btn-danger {\n  flex: 1;\n  padding: 6px 12px;\n  border: none;\n  border-radius: 4px;\n  cursor: pointer;\n  font-size: 12px;\n  font-weight: 500;\n  transition: opacity 0.2s;\n}\n\n.panel-btn-secondary {\n  background: #4a90e2;\n  color: white;\n}\n\n.panel-btn-secondary:hover {\n  opacity: 0.8;\n}\n\n.panel-btn-danger {\n  background: #f44336;\n  color: white;\n}\n\n.panel-btn-danger:hover {\n  opacity: 0.8;\n}\n\n/* Panel Stats */\n.panel-stats {\n  padding: 8px 12px;\n  background: #1e1e1e;\n  border-bottom: 1px solid #555;\n  display: flex;\n  justify-content: space-between;\n  font-size: 11px;\n  color: #999;\n}\n\n/* Containers List */\n.panel-containers-list {\n  flex: 1;\n  overflow-y: auto;\n  padding: 10px 0;\n}\n\n/* Container Section */\n.panel-container-section {\n  margin-bottom: 16px;\n}\n\n.panel-container-header {\n  padding: 8px 12px;\n  margin: 0;\n  font-size: 13px;\n  font-weight: 600;\n  background: #1e1e1e;\n  border-top: 1px solid #555;\n  border-bottom: 1px solid #555;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.panel-container-icon {\n  font-size: 14px;\n}\n\n.panel-container-count {\n  margin-left: auto;\n  font-weight: normal;\n  color: #999;\n  font-size: 11px;\n}\n\n/* Quick Tab Items */\n.panel-quick-tab-item {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 12px;\n  border-bottom: 1px solid #555;\n  transition: background 0.2s;\n  cursor: pointer;\n}\n\n.panel-quick-tab-item:hover {\n  background: #3a3a3a;\n}\n\n.panel-quick-tab-item.active {\n  border-left: 3px solid #4CAF50;\n  padding-left: 9px;\n}\n\n.panel-quick-tab-item.minimized {\n  border-left: 3px solid #FFC107;\n  padding-left: 9px;\n}\n\n.panel-status-indicator {\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  flex-shrink: 0;\n}\n\n.panel-status-indicator.green {\n  background: #4CAF50;\n}\n\n.panel-status-indicator.yellow {\n  background: #FFC107;\n}\n\n.panel-favicon {\n  width: 16px;\n  height: 16px;\n  flex-shrink: 0;\n}\n\n.panel-tab-info {\n  flex: 1;\n  min-width: 0;\n}\n\n.panel-tab-title {\n  font-weight: 500;\n  font-size: 12px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.panel-tab-meta {\n  font-size: 10px;\n  color: #999;\n  margin-top: 2px;\n}\n\n.panel-tab-actions {\n  display: flex;\n  gap: 4px;\n  flex-shrink: 0;\n}\n\n.panel-btn-icon {\n  width: 24px;\n  height: 24px;\n  padding: 0;\n  border: none;\n  background: transparent;\n  cursor: pointer;\n  border-radius: 4px;\n  font-size: 12px;\n  transition: background 0.2s;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: #e0e0e0;\n}\n\n.panel-btn-icon:hover {\n  background: #555;\n}\n\n/* Empty State */\n.panel-empty-state {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  padding: 60px 20px;\n  text-align: center;\n  color: #999;\n}\n\n.empty-icon {\n  font-size: 48px;\n  margin-bottom: 16px;\n  opacity: 0.5;\n}\n\n.empty-text {\n  font-size: 16px;\n  font-weight: 500;\n  margin-bottom: 8px;\n}\n\n.empty-hint {\n  font-size: 12px;\n}\n\n/* Resize Handles */\n.panel-resize-handle {\n  position: absolute;\n  z-index: 10;\n}\n\n.panel-resize-handle.n { top: 0; left: 10px; right: 10px; height: 10px; cursor: n-resize; }\n.panel-resize-handle.s { bottom: 0; left: 10px; right: 10px; height: 10px; cursor: s-resize; }\n.panel-resize-handle.e { right: 0; top: 10px; bottom: 10px; width: 10px; cursor: e-resize; }\n.panel-resize-handle.w { left: 0; top: 10px; bottom: 10px; width: 10px; cursor: w-resize; }\n.panel-resize-handle.ne { top: 0; right: 0; width: 10px; height: 10px; cursor: ne-resize; }\n.panel-resize-handle.nw { top: 0; left: 0; width: 10px; height: 10px; cursor: nw-resize; }\n.panel-resize-handle.se { bottom: 0; right: 0; width: 10px; height: 10px; cursor: se-resize; }\n.panel-resize-handle.sw { bottom: 0; left: 0; width: 10px; height: 10px; cursor: sw-resize; }\n\n/* Scrollbar Styling */\n.panel-containers-list::-webkit-scrollbar {\n  width: 8px;\n}\n\n.panel-containers-list::-webkit-scrollbar-track {\n  background: #1e1e1e;\n}\n\n.panel-containers-list::-webkit-scrollbar-thumb {\n  background: #555;\n  border-radius: 4px;\n}\n\n.panel-containers-list::-webkit-scrollbar-thumb:hover {\n  background: #666;\n}\n', 
      document.head.appendChild(e), !0;
    }
    static createPanel(e) {
      const t = document.createElement("div");
      t.innerHTML = '\n<div id="quick-tabs-manager-panel" class="quick-tabs-manager-panel" style="display: none;">\n  <div class="panel-header">\n    <span class="panel-drag-handle">≡</span>\n    <h2 class="panel-title">Quick Tabs Manager</h2>\n    <div class="panel-controls">\n      <button class="panel-btn panel-minimize" title="Minimize Panel">−</button>\n      <button class="panel-btn panel-close" title="Close Panel (Ctrl+Alt+Z)">✕</button>\n    </div>\n  </div>\n  \n  <div class="panel-actions">\n    <button id="panel-closeMinimized" class="panel-btn-secondary" title="Close all minimized Quick Tabs">\n      Close Minimized\n    </button>\n    <button id="panel-closeAll" class="panel-btn-danger" title="Close all Quick Tabs">\n      Close All\n    </button>\n  </div>\n  \n  <div class="panel-stats">\n    <span id="panel-totalTabs">0 Quick Tabs</span>\n    <span id="panel-lastSync">Last sync: Never</span>\n  </div>\n  \n  <div id="panel-containersList" class="panel-containers-list">\n    \x3c!-- Dynamically populated --\x3e\n  </div>\n  \n  <div id="panel-emptyState" class="panel-empty-state" style="display: none;">\n    <div class="empty-icon">📭</div>\n    <div class="empty-text">No Quick Tabs</div>\n    <div class="empty-hint">Press Q while hovering over a link</div>\n  </div>\n</div>\n';
      const n = t.firstElementChild;
      return n.style.left = `${e.left}px`, n.style.top = `${e.top}px`, n.style.width = `${e.width}px`, 
      n.style.height = `${e.height}px`, e.isOpen && (n.style.display = "flex"), n;
    }
    static renderContainerSection(e, t, n) {
      const i = document.createElement("div");
      i.className = "panel-container-section";
      const o = X._createHeader(t, n);
      i.appendChild(o);
      const s = n.tabs.filter(e => !e.minimized), a = n.tabs.filter(e => e.minimized);
      return s.forEach(e => {
        i.appendChild(X.renderQuickTabItem(e, !1));
      }), a.forEach(e => {
        i.appendChild(X.renderQuickTabItem(e, !0));
      }), i;
    }
    static _createHeader(e, t) {
      const n = document.createElement("h3");
      n.className = "panel-container-header";
      const i = t.tabs.length, o = 1 !== i ? "s" : "";
      return n.innerHTML = `\n      <span class="panel-container-icon">${e.icon}</span>\n      <span class="panel-container-name">${e.name}</span>\n      <span class="panel-container-count">(${i} tab${o})</span>\n    `, 
      n;
    }
    static renderQuickTabItem(e, t) {
      const n = Boolean(t), i = document.createElement("div");
      i.className = "panel-quick-tab-item " + (n ? "minimized" : "active");
      const o = X._createIndicator(n);
      i.appendChild(o);
      const s = X._createFavicon(e.url);
      i.appendChild(s);
      const a = X._createInfo(e, n);
      i.appendChild(a);
      const r = X._createActions(e, n);
      return i.appendChild(r), i;
    }
    static _createIndicator(e) {
      const t = document.createElement("span");
      return t.className = "panel-status-indicator " + (e ? "yellow" : "green"), t;
    }
    static _createFavicon(e) {
      const t = document.createElement("img");
      t.className = "panel-favicon";
      try {
        const n = new URL(e);
        t.src = `https://www.google.com/s2/favicons?domain=${n.hostname}&sz=32`, t.onerror = () => t.style.display = "none";
      } catch (e) {
        t.style.display = "none";
      }
      return t;
    }
    static _createInfo(e, t) {
      const n = document.createElement("div");
      n.className = "panel-tab-info";
      const i = document.createElement("div");
      i.className = "panel-tab-title", i.textContent = e.title || "Quick Tab";
      const o = document.createElement("div");
      o.className = "panel-tab-meta";
      const s = [];
      return t && s.push("Minimized"), e.activeTabId && s.push(`Tab ${e.activeTabId}`), 
      e.width && e.height && s.push(`${Math.round(e.width)}×${Math.round(e.height)}`), 
      o.textContent = s.join(" • "), n.appendChild(i), n.appendChild(o), n;
    }
    static _createActions(e, t) {
      const n = document.createElement("div");
      if (n.className = "panel-tab-actions", t) {
        const t = X._createButton("↑", "Restore", "restore", {
          quickTabId: e.id
        });
        n.appendChild(t);
      } else {
        if (e.activeTabId) {
          const t = X._createButton("🔗", "Go to Tab", "goToTab", {
            tabId: e.activeTabId
          });
          n.appendChild(t);
        }
        const t = X._createButton("➖", "Minimize", "minimize", {
          quickTabId: e.id
        });
        n.appendChild(t);
      }
      const i = X._createButton("✕", "Close", "close", {
        quickTabId: e.id
      });
      return n.appendChild(i), n;
    }
    static _createButton(e, t, n, i) {
      const o = document.createElement("button");
      return o.className = "panel-btn-icon", o.textContent = e, o.title = t, o.dataset.action = n, 
      Object.entries(i).forEach(([e, t]) => {
        o.dataset[e] = t;
      }), o;
    }
    static getContainerIcon(e) {
      return {
        fingerprint: "🔒",
        briefcase: "💼",
        dollar: "💰",
        cart: "🛒",
        circle: "⭕",
        gift: "🎁",
        vacation: "🏖️",
        food: "🍴",
        fruit: "🍎",
        pet: "🐾",
        tree: "🌳",
        chill: "❄️",
        fence: "🚧"
      }[e] || "📁";
    }
  }
  class V {
    constructor(e) {
      this.quickTabsManager = e, this.panel = null, this.isOpen = !1, this.currentContainerId = "firefox-default", 
      this.uiBuilder = new X, this.dragController = null, this.resizeController = null, 
      this.stateManager = null, this.contentManager = null, this.updateInterval = null;
    }
    async init() {
      Z("[PanelManager] Initializing..."), await this.detectContainerContext(), this.stateManager = new j({
        onStateLoaded: e => this._applyState(e),
        onBroadcastReceived: (e, t) => this._handleBroadcast(e, t)
      }), await this.stateManager.init(), this.uiBuilder.injectStyles();
      const e = this.stateManager.getState();
      this.panel = this.uiBuilder.createPanel(e), document.body.appendChild(this.panel), 
      this._initializeControllers(), this.setupMessageListener(), Z("[PanelManager] Initialized");
    }
    async detectContainerContext() {
      this.currentContainerId = "firefox-default";
      try {
        const e = await browser.runtime.sendMessage({
          action: "GET_CONTAINER_CONTEXT"
        });
        e && e.success && e.cookieStoreId ? (this.currentContainerId = e.cookieStoreId, 
        Z(`[PanelManager] Container: ${this.currentContainerId}`)) : Z("[PanelManager] Using default container (no response from background)");
      } catch (e) {
        Z("[PanelManager] Failed to detect container:", e);
      }
    }
    _initializeControllers() {
      const e = this.panel.querySelector(".panel-header");
      this.dragController = new W(this.panel, e, {
        onDragEnd: (e, t) => {
          this.stateManager.savePanelState(this.panel);
        },
        onBroadcast: e => {
          this.stateManager.broadcast("PANEL_POSITION_UPDATED", e);
        }
      }), this.resizeController = new K(this.panel, {
        onSizeChange: (e, t) => {},
        onPositionChange: (e, t) => {},
        onResizeEnd: (e, t, n, i) => {
          this.stateManager.savePanelState(this.panel);
        },
        onBroadcast: e => {
          this.stateManager.broadcast("PANEL_SIZE_UPDATED", {
            width: e.width,
            height: e.height
          }), this.stateManager.broadcast("PANEL_POSITION_UPDATED", {
            left: e.left,
            top: e.top
          });
        }
      }), this.contentManager = new G(this.panel, {
        uiBuilder: this.uiBuilder,
        stateManager: this.stateManager,
        quickTabsManager: this.quickTabsManager,
        currentContainerId: this.currentContainerId
      }), this.contentManager.setOnClose(() => this.close()), this.contentManager.setupEventListeners();
    }
    setupMessageListener() {
      browser.runtime.onMessage.addListener((e, t) => "TOGGLE_QUICK_TABS_PANEL" === e.action && (this.toggle(), 
      Promise.resolve({
        success: !0
      })));
    }
    toggle() {
      this.panel ? this.isOpen ? this.close() : this.open() : console.error("[PanelManager] Panel not initialized");
    }
    open() {
      this.panel ? (this.panel.style.display = "flex", this.isOpen = !0, this.stateManager.setIsOpen(!0), 
      this.panel.style.zIndex = "999999999", this.contentManager.setIsOpen(!0), this.contentManager.updateContent(), 
      this.updateInterval || (this.updateInterval = setInterval(() => {
        this.contentManager.updateContent();
      }, 2e3)), this.stateManager.savePanelState(this.panel), this.stateManager.broadcast("PANEL_OPENED", {}), 
      Z("[PanelManager] Panel opened")) : console.error("[PanelManager] Panel not initialized");
    }
    close() {
      this.panel && (this.panel.style.display = "none", this.isOpen = !1, this.stateManager.setIsOpen(!1), 
      this.contentManager.setIsOpen(!1), this.updateInterval && (clearInterval(this.updateInterval), 
      this.updateInterval = null), this.stateManager.savePanelState(this.panel), this.stateManager.broadcast("PANEL_CLOSED", {}), 
      Z("[PanelManager] Panel closed"));
    }
    openSilent() {
      this.panel && (this.panel.style.display = "flex", this.isOpen = !0, this.stateManager.setIsOpen(!0), 
      this.contentManager.setIsOpen(!0), this.contentManager.updateContent(), this.updateInterval || (this.updateInterval = setInterval(() => {
        this.contentManager.updateContent();
      }, 2e3)), Z("[PanelManager] Panel opened (silent)"));
    }
    closeSilent() {
      this.panel && (this.panel.style.display = "none", this.isOpen = !1, this.stateManager.setIsOpen(!1), 
      this.contentManager.setIsOpen(!1), this.updateInterval && (clearInterval(this.updateInterval), 
      this.updateInterval = null), Z("[PanelManager] Panel closed (silent)"));
    }
    _applyState(e) {
      this.panel && (this.panel.style.left = `${e.left}px`, this.panel.style.top = `${e.top}px`, 
      this.panel.style.width = `${e.width}px`, this.panel.style.height = `${e.height}px`, 
      e.isOpen && this.open());
    }
    _handleBroadcast(e, t) {
      const n = {
        PANEL_OPENED: () => !this.isOpen && this.openSilent(),
        PANEL_CLOSED: () => this.isOpen && this.closeSilent(),
        PANEL_POSITION_UPDATED: () => this._updatePosition(t),
        PANEL_SIZE_UPDATED: () => this._updateSize(t)
      }[e];
      n ? n() : Z(`[PanelManager] Unknown broadcast: ${e}`);
    }
    _updatePosition(e) {
      void 0 !== e.left && void 0 !== e.top && (this.panel.style.left = `${e.left}px`, 
      this.panel.style.top = `${e.top}px`, this.stateManager.savePanelStateLocal(this.panel));
    }
    _updateSize(e) {
      void 0 !== e.width && void 0 !== e.height && (this.panel.style.width = `${e.width}px`, 
      this.panel.style.height = `${e.height}px`, this.stateManager.savePanelStateLocal(this.panel));
    }
    destroy() {
      this.updateInterval && (clearInterval(this.updateInterval), this.updateInterval = null), 
      this.dragController && (this.dragController.destroy(), this.dragController = null), 
      this.resizeController && (this.resizeController.destroy(), this.resizeController = null), 
      this.contentManager && (this.contentManager.destroy(), this.contentManager = null), 
      this.stateManager && (this.stateManager.destroy(), this.stateManager = null), this.panel && (this.panel.remove(), 
      this.panel = null), Z("[PanelManager] Destroyed");
    }
  }
  const J = new class {
    constructor() {
      this.tabs = new Map, this.currentZIndex = {
        value: c
      }, this.initialized = !1, this.cookieStoreId = null, this.currentTabId = null, this.pendingSaveIds = new Set, 
      this.internalEventBus = new m, this.storage = null, this.broadcast = null, this.state = null, 
      this.events = null, this.createHandler = null, this.updateHandler = null, this.visibilityHandler = null, 
      this.destroyHandler = null, this.uiCoordinator = null, this.syncCoordinator = null, 
      this.minimizedManager = new H, this.panelManager = null, this.eventBus = null, this.Events = null, 
      this.broadcastChannel = null;
    }
    async init(e, t) {
      this.initialized ? console.log("[QuickTabsManager] Already initialized, skipping") : (this.eventBus = e, 
      this.Events = t, console.log("[QuickTabsManager] Initializing facade..."), await this.detectContainerContext() || console.warn("[QuickTabsManager] Container detection failed, using default container"), 
      await this.detectCurrentTabId(), this._initializeManagers(), this._initializeHandlers(), 
      this.panelManager = new V(this), await this.panelManager.init(), console.log("[QuickTabsManager] Panel manager initialized"), 
      this._initializeCoordinators(), this._setupComponents(), await this._hydrateState(), 
      "undefined" != typeof window && (window.__quickTabsManager = this, console.log("[QuickTabsManager] Manager exposed globally")), 
      this.initialized = !0, console.log("[QuickTabsManager] Facade initialized successfully"));
    }
    _initializeManagers() {
      this.storage = new $(this.internalEventBus, this.cookieStoreId), this.broadcast = new P(this.internalEventBus, this.cookieStoreId), 
      this.state = new L(this.internalEventBus, this.currentTabId), this.events = new B(this.internalEventBus, this.tabs);
    }
    _initializeHandlers() {
      this.createHandler = new x(this.tabs, this.currentZIndex, this.cookieStoreId, this.broadcast, this.eventBus, this.Events, this.generateId.bind(this)), 
      this.updateHandler = new z(this.tabs, this.broadcast, this.storage, this.internalEventBus, this.generateSaveId.bind(this), this.releasePendingSave.bind(this)), 
      this.visibilityHandler = new O(this.tabs, this.broadcast, this.storage, this.minimizedManager, this.internalEventBus, this.currentZIndex, this.generateSaveId.bind(this), this.trackPendingSave.bind(this), this.releasePendingSave.bind(this), this.currentTabId, this.Events), 
      this.destroyHandler = new _(this.tabs, this.broadcast, this.minimizedManager, this.eventBus, this.currentZIndex, this.generateSaveId.bind(this), this.releasePendingSave.bind(this), this.Events, c);
    }
    _initializeCoordinators() {
      this.uiCoordinator = new w(this.state, this.minimizedManager, this.panelManager, this.internalEventBus), 
      this.syncCoordinator = new y(this.state, this.storage, this.broadcast, {
        create: this.createHandler,
        update: this.updateHandler,
        visibility: this.visibilityHandler,
        destroy: this.destroyHandler
      }, this.internalEventBus);
    }
    async _setupComponents() {
      this.storage.setupStorageListeners(), this.broadcast.setupBroadcastChannel(), this.events.setupEmergencySaveHandlers(), 
      this.syncCoordinator.setupListeners(), await this.uiCoordinator.init();
    }
    async detectContainerContext() {
      try {
        const e = await browser.runtime.sendMessage({
          action: "GET_CONTAINER_CONTEXT"
        });
        return e && e.success && e.cookieStoreId ? (this.cookieStoreId = e.cookieStoreId, 
        console.log("[QuickTabsManager] Detected container:", this.cookieStoreId), !0) : (console.error("[QuickTabsManager] Failed to get container from background:", e?.error), 
        this.cookieStoreId = "firefox-default", !1);
      } catch (e) {
        return console.error("[QuickTabsManager] Failed to detect container:", e), this.cookieStoreId = "firefox-default", 
        !1;
      }
    }
    async getCurrentContainer() {
      try {
        const e = await browser.runtime.sendMessage({
          action: "GET_CONTAINER_CONTEXT"
        });
        return e && e.success && e.cookieStoreId ? e.cookieStoreId : this.cookieStoreId || "firefox-default";
      } catch (e) {
        return console.error("[QuickTabsManager] Failed to get current container:", e), 
        this.cookieStoreId || "firefox-default";
      }
    }
    async detectCurrentTabId() {
      try {
        const e = await browser.runtime.sendMessage({
          action: "GET_CURRENT_TAB_ID"
        });
        e && e.tabId && (this.currentTabId = e.tabId, console.log("[QuickTabsManager] Detected current tab ID:", this.currentTabId));
      } catch (e) {
        console.error("[QuickTabsManager] Failed to detect tab ID:", e);
      }
    }
    async _hydrateState() {
      console.log("[QuickTabsManager] Hydrating state from storage...");
      try {
        const e = await this.storage.loadAll();
        this.state.hydrate(e), console.log(`[QuickTabsManager] Hydrated ${e.length} Quick Tabs`);
      } catch (e) {
        console.error("[QuickTabsManager] Failed to hydrate state:", e);
      }
    }
    createQuickTab(e) {
      const t = {
        ...e,
        onDestroy: e => this.handleDestroy(e),
        onMinimize: e => this.handleMinimize(e),
        onFocus: e => this.handleFocus(e),
        onPositionChange: (e, t, n) => this.handlePositionChange(e, t, n),
        onPositionChangeEnd: (e, t, n) => this.handlePositionChangeEnd(e, t, n),
        onSizeChange: (e, t, n) => this.handleSizeChange(e, t, n),
        onSizeChangeEnd: (e, t, n) => this.handleSizeChangeEnd(e, t, n),
        onSolo: (e, t) => this.handleSoloToggle(e, t),
        onMute: (e, t) => this.handleMuteToggle(e, t)
      }, n = this.createHandler.create(t);
      return this.currentZIndex.value = n.newZIndex, n.tabWindow;
    }
    handleDestroy(e) {
      return this.destroyHandler.handleDestroy(e);
    }
    handleMinimize(e) {
      return this.visibilityHandler.handleMinimize(e);
    }
    handleFocus(e) {
      return this.visibilityHandler.handleFocus(e);
    }
    handlePositionChange(e, t, n) {
      return this.updateHandler.handlePositionChange(e, t, n);
    }
    handlePositionChangeEnd(e, t, n) {
      return this.updateHandler.handlePositionChangeEnd(e, t, n);
    }
    handleSizeChange(e, t, n) {
      return this.updateHandler.handleSizeChange(e, t, n);
    }
    handleSizeChangeEnd(e, t, n) {
      return this.updateHandler.handleSizeChangeEnd(e, t, n);
    }
    handleSoloToggle(e, t) {
      return this.visibilityHandler.handleSoloToggle(e, t);
    }
    handleMuteToggle(e, t) {
      return this.visibilityHandler.handleMuteToggle(e, t);
    }
    closeById(e) {
      return this.destroyHandler.closeById(e);
    }
    closeAll() {
      return this.destroyHandler.closeAll();
    }
    restoreQuickTab(e) {
      return this.visibilityHandler.restoreQuickTab(e);
    }
    minimizeById(e) {
      return this.handleMinimize(e);
    }
    restoreById(e) {
      return this.visibilityHandler.restoreById(e);
    }
    getQuickTab(e) {
      return this.tabs.get(e);
    }
    getAllQuickTabs() {
      return Array.from(this.tabs.values());
    }
    getMinimizedQuickTabs() {
      return this.minimizedManager.getAll();
    }
    generateId() {
      return `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    generateSaveId() {
      return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    trackPendingSave(e) {
      this.pendingSaveIds.add(e), console.log("[QuickTabsManager] Tracking pending save:", e);
    }
    releasePendingSave(e) {
      this.pendingSaveIds.delete(e), console.log("[QuickTabsManager] Released pending save:", e);
    }
    updateQuickTabPosition(e, t, n) {
      return this.handlePositionChange(e, t, n);
    }
    updateQuickTabSize(e, t, n) {
      return this.handleSizeChange(e, t, n);
    }
  };
  function ee(e) {
    if (e.href) return e.href;
    const t = e.closest("a[href]");
    if (t?.href) return t.href;
    if (function(e) {
      return "ARTICLE" === e.tagName || "article" === e.getAttribute("role") || "link" === e.getAttribute("role") || e.classList.contains("post") || e.hasAttribute("data-testid") || e.hasAttribute("data-id");
    }(e)) {
      const t = e.querySelector("a[href]");
      if (t?.href) return t.href;
    }
    return null;
  }
  const te = {
    medium: function(e) {
      const t = e.closest("[data-post-id], article");
      if (!t) return ee(e);
      const n = t.querySelector('a[data-action="open-post"], h2 a, h3 a');
      return n?.href ? n.href : null;
    },
    devTo: function(e) {
      const t = e.closest(".crayons-story, [data-article-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[id*="article-link"], h2 a, h3 a');
      return n?.href ? n.href : null;
    },
    hashnode: function(e) {
      const t = e.closest("[data-post-id], .post-card");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/post/"], h1 a, h2 a');
      return n?.href ? n.href : null;
    },
    substack: function(e) {
      const t = e.closest('.post, [data-testid="post-preview"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/p/"], h2 a, h3 a');
      return n?.href ? n.href : null;
    },
    wordpress: function(e) {
      const t = e.closest(".post, .hentry, article");
      if (!t) return ee(e);
      const n = t.querySelector("a.entry-title-link, h2 a, .entry-title a");
      return n?.href ? n.href : null;
    },
    blogger: function(e) {
      const t = e.closest(".post, .post-outer");
      if (!t) return ee(e);
      const n = t.querySelector("h3.post-title a, a.post-title");
      return n?.href ? n.href : null;
    },
    ghost: function(e) {
      const t = e.closest(".post-card, article");
      if (!t) return ee(e);
      const n = t.querySelector(".post-card-title a, h2 a");
      return n?.href ? n.href : null;
    },
    notion: function(e) {
      return window.location.href;
    }
  };
  function ne(e) {
    const t = e.closest(".s-post-summary, .question-summary");
    if (!t) return ee(e);
    const n = t.querySelector('a[href*="/questions/"]');
    return n?.href ? n.href : null;
  }
  const ie = {
    gitHub: function(e) {
      const t = e.closest('[data-testid="issue-row"], .Box-row, .issue, [role="article"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/issues/"], a[href*="/pull/"], a[href*="/discussions/"]');
      return n?.href ? n.href : null;
    },
    gitLab: function(e) {
      const t = e.closest(".issue, .merge-request, [data-qa-selector]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/issues/"], a[href*="/merge_requests/"]');
      return n?.href ? n.href : null;
    },
    bitbucket: function(e) {
      const t = e.closest('[data-testid="issue-row"], .iterable-item');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/issues/"], a[href*="/pull-requests/"]');
      return n?.href ? n.href : null;
    },
    stackOverflow: function(e) {
      const t = e.closest(".s-post-summary, [data-post-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a.s-link[href*="/questions/"]');
      return n?.href ? n.href : null;
    },
    stackExchange: ne,
    serverFault: function(e) {
      return ne(e);
    },
    superUser: function(e) {
      return ne(e);
    },
    codepen: function(e) {
      const t = e.closest("[data-slug], .single-pen");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/pen/"]');
      return n?.href ? n.href : null;
    },
    jSFiddle: function(e) {
      const t = e.closest(".fiddle, [data-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="jsfiddle.net"]');
      return n?.href ? n.href : null;
    },
    replit: function(e) {
      const t = e.closest("[data-repl-id], .repl-item");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/@"]');
      return n?.href ? n.href : null;
    },
    glitch: function(e) {
      const t = e.closest(".project, [data-project-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="glitch.com/~"]');
      return n?.href ? n.href : null;
    },
    codesandbox: function(e) {
      const t = e.closest("[data-id], .sandbox-item");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/s/"]');
      return n?.href ? n.href : null;
    }
  }, oe = {
    amazon: function(e) {
      const t = e.closest('[data-component-type="s-search-result"], .s-result-item, [data-asin]');
      if (!t) return ee(e);
      const n = t.querySelector('a.a-link-normal[href*="/dp/"], h2 a');
      return n?.href ? n.href : null;
    },
    ebay: function(e) {
      const t = e.closest('.s-item, [data-view="mi"]');
      if (!t) return ee(e);
      const n = t.querySelector("a.s-item__link, .vip a");
      return n?.href ? n.href : null;
    },
    etsy: function(e) {
      const t = e.closest("[data-listing-id], .listing-link");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/listing/"]');
      return n?.href ? n.href : null;
    },
    walmart: function(e) {
      const t = e.closest("[data-item-id], .search-result-gridview-item");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/ip/"]');
      return n?.href ? n.href : null;
    },
    flipkart: function(e) {
      const t = e.closest("[data-id], ._2kHMtA");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/p/"]');
      return n?.href ? n.href : null;
    },
    aliexpress: function(e) {
      const t = e.closest("[data-product-id], .product-item");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/item/"]');
      return n?.href ? n.href : null;
    },
    alibaba: function(e) {
      const t = e.closest("[data-content], .organic-list-offer");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/product-detail/"]');
      return n?.href ? n.href : null;
    },
    shopify: function(e) {
      const t = e.closest(".product-item, .grid-item, [data-product-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/products/"]');
      return n?.href ? n.href : null;
    },
    target: function(e) {
      const t = e.closest('[data-test="product-grid-item"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/p/"]');
      return n?.href ? n.href : null;
    },
    bestBuy: function(e) {
      const t = e.closest(".sku-item, [data-sku-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/site/"]');
      return n?.href ? n.href : null;
    },
    newegg: function(e) {
      const t = e.closest(".item-cell, [data-item]");
      if (!t) return ee(e);
      const n = t.querySelector("a.item-title");
      return n?.href ? n.href : null;
    },
    wish: function(e) {
      const t = e.closest("[data-productid], .ProductCard");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/product/"]');
      return n?.href ? n.href : null;
    }
  }, se = {
    wikipedia: function(e) {
      return ee(e);
    },
    imdb: function(e) {
      const t = e.closest('.lister-item, [data-testid="title"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/title/"], a[href*="/name/"]');
      return n?.href ? n.href : null;
    },
    rottenTomatoes: function(e) {
      const t = e.closest('[data-qa="discovery-media-list-item"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/m/"], a[href*="/tv/"]');
      return n?.href ? n.href : null;
    },
    netflix: function(e) {
      return window.location.href;
    },
    letterboxd: function(e) {
      const t = e.closest(".film-poster, [data-film-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/film/"]');
      return n?.href ? n.href : null;
    },
    goodreads: function(e) {
      const t = e.closest(".bookBox, [data-book-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/book/show/"]');
      return n?.href ? n.href : null;
    },
    myAnimeList: function(e) {
      const t = e.closest(".anime_ranking_h3, [data-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/anime/"]');
      return n?.href ? n.href : null;
    },
    aniList: function(e) {
      const t = e.closest(".media-card, [data-media-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/anime/"], a[href*="/manga/"]');
      return n?.href ? n.href : null;
    },
    kitsu: function(e) {
      const t = e.closest(".media-card");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/anime/"], a[href*="/manga/"]');
      return n?.href ? n.href : null;
    },
    lastFm: function(e) {
      const t = e.closest(".chartlist-row, [data-track-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/music/"]');
      return n?.href ? n.href : null;
    },
    spotify: function(e) {
      const t = e.closest('[data-testid="tracklist-row"], .track');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/track/"], a[href*="/album/"]');
      return n?.href ? n.href : null;
    },
    soundcloud: function(e) {
      const t = e.closest(".searchItem, .soundList__item");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="soundcloud.com/"]');
      return n?.href ? n.href : null;
    },
    bandcamp: function(e) {
      const t = e.closest(".item-details, [data-item-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/track/"], a[href*="/album/"]');
      return n?.href ? n.href : null;
    }
  }, ae = {
    steam: function(e) {
      const t = e.closest("[data-ds-appid], .search_result_row");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/app/"]');
      return n?.href ? n.href : null;
    },
    steamPowered: function(e) {
      const t = e.closest("[data-ds-appid], .game_area");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/app/"]');
      return n?.href ? n.href : null;
    },
    epicGames: function(e) {
      const t = e.closest('[data-component="Card"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/p/"]');
      return n?.href ? n.href : null;
    },
    gOG: function(e) {
      const t = e.closest(".product-row, [data-game-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/game/"]');
      return n?.href ? n.href : null;
    },
    itchIo: function(e) {
      const t = e.closest(".game_cell, [data-game_id]");
      if (!t) return ee(e);
      const n = t.querySelector("a.game_link, a.title");
      return n?.href ? n.href : null;
    },
    gameJolt: function(e) {
      const t = e.closest(".game-card, [data-game-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/games/"]');
      return n?.href ? n.href : null;
    }
  }, re = {
    pinterest: function(e) {
      const t = e.closest('[data-test-id="pin"], [role="button"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/pin/"]');
      return n?.href ? n.href : null;
    },
    tumblr: function(e) {
      const t = e.closest("[data-id], article");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/post/"]');
      return n?.href ? n.href : null;
    },
    dribbble: function(e) {
      const t = e.closest("[data-thumbnail-target], .shot-thumbnail");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/shots/"]');
      return n?.href ? n.href : null;
    },
    behance: function(e) {
      const t = e.closest("[data-project-id], .Project");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/gallery/"]');
      return n?.href ? n.href : null;
    },
    deviantart: function(e) {
      const t = e.closest("[data-deviationid], ._2vUXu");
      if (!t) return ee(e);
      const n = t.querySelector('a[data-hook="deviation_link"]');
      return n?.href ? n.href : null;
    },
    flickr: function(e) {
      const t = e.closest(".photo-list-photo-view, [data-photo-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/photos/"]');
      return n?.href ? n.href : null;
    },
    "500px": function(e) {
      const t = e.closest('[data-test="photo-item"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/photo/"]');
      return n?.href ? n.href : null;
    },
    unsplash: function(e) {
      const t = e.closest('figure, [data-test="photo-grid-single-column-figure"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/photos/"]');
      return n?.href ? n.href : null;
    },
    pexels: function(e) {
      const t = e.closest("[data-photo-modal-medium], article");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/photo/"]');
      return n?.href ? n.href : null;
    },
    pixabay: function(e) {
      const t = e.closest("[data-id], .item");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/photos/"], a[href*="/illustrations/"]');
      return n?.href ? n.href : null;
    },
    artstation: function(e) {
      const t = e.closest(".project, [data-project-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/artwork/"]');
      return n?.href ? n.href : null;
    },
    imgur: function(e) {
      const t = e.closest('[id^="post-"], .Post');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/gallery/"]');
      return n?.href ? n.href : null;
    },
    giphy: function(e) {
      const t = e.closest("[data-giphy-id], .gif");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/gifs/"]');
      return n?.href ? n.href : null;
    }
  }, le = {
    coursera: function(e) {
      const t = e.closest('[data-e2e="CourseCard"], .CourseCard');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/learn/"]');
      return n?.href ? n.href : null;
    },
    udemy: function(e) {
      const t = e.closest('[data-purpose="course-card"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/course/"]');
      return n?.href ? n.href : null;
    },
    edX: function(e) {
      const t = e.closest(".course-card, [data-course-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/course/"]');
      return n?.href ? n.href : null;
    },
    khanAcademy: function(e) {
      const t = e.closest("[data-test-id], .link-item");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/math/"], a[href*="/science/"]');
      return n?.href ? n.href : null;
    },
    skillshare: function(e) {
      const t = e.closest("[data-class-id], .class-card");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/classes/"]');
      return n?.href ? n.href : null;
    },
    pluralsight: function(e) {
      const t = e.closest("[data-course-id], .course-card");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/courses/"]');
      return n?.href ? n.href : null;
    },
    udacity: function(e) {
      const t = e.closest('[data-testid="catalog-card"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/course/"]');
      return n?.href ? n.href : null;
    }
  }, ce = {
    hackerNews: function(e) {
      const t = e.closest(".athing");
      if (!t) return ee(e);
      const n = t.querySelector("a.titlelink, .storylink");
      return n?.href ? n.href : null;
    },
    productHunt: function(e) {
      const t = e.closest('[data-test="post-item"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/posts/"]');
      return n?.href ? n.href : null;
    },
    quora: function(e) {
      const t = e.closest("[data-scroll-id], .q-box");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/q/"], a[href*="/question/"], a.question_link');
      return n?.href ? n.href : null;
    },
    discord: function(e) {
      const t = e.closest('[id^="chat-messages-"], .message');
      if (!t) return ee(e);
      const n = t.querySelector("a[href]");
      return n?.href ? n.href : null;
    },
    slack: function(e) {
      const t = e.closest('[data-qa="message_container"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/archives/"]');
      return n?.href ? n.href : null;
    },
    lobsters: function(e) {
      const t = e.closest(".story");
      if (!t) return ee(e);
      const n = t.querySelector("a.u-url");
      return n?.href ? n.href : null;
    },
    googleNews: function(e) {
      const t = e.closest("article, [data-n-tid]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="./articles/"], h3 a, h4 a');
      return n?.href ? n.href : null;
    },
    feedly: function(e) {
      const t = e.closest("[data-entry-id], .entry");
      if (!t) return ee(e);
      const n = t.querySelector("a.entry__title");
      return n?.href ? n.href : null;
    }
  }, de = {
    archiveOrg: function(e) {
      const t = e.closest(".item-ia, [data-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/details/"]');
      return n?.href ? n.href : null;
    },
    patreon: function(e) {
      const t = e.closest('[data-tag="post-card"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/posts/"]');
      return n?.href ? n.href : null;
    },
    koFi: function(e) {
      const t = e.closest(".feed-item, [data-post-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/post/"]');
      return n?.href ? n.href : null;
    },
    buyMeACoffee: function(e) {
      const t = e.closest(".feed-card");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/p/"]');
      return n?.href ? n.href : null;
    },
    gumroad: function(e) {
      const t = e.closest("[data-permalink], .product-card");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="gumroad.com/"]');
      return n?.href ? n.href : null;
    }
  }, he = {
    twitter: function(e) {
      return Z("=== TWITTER URL FINDER ==="), Z("Hovered element: " + e.tagName + " - " + e.className), 
      e && e.href ? (Z(`URL found directly from hovered element: ${e.href}`), e.href) : (Z("No Twitter URL found on the provided element."), 
      null);
    },
    reddit: function(e) {
      const t = e.closest('[data-testid="post-container"], .Post, .post-container, [role="article"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[data-testid="post-title"], h3 a, .PostTitle a, [data-click-id="body"] a');
      return n?.href ? n.href : null;
    },
    linkedIn: function(e) {
      const t = e.closest('[data-id], .feed-shared-update-v2, [data-test="activity-item"]');
      if (!t) return ee(e);
      const n = t.querySelectorAll("a[href]");
      for (const e of n) {
        const t = e.href;
        if (t.includes("/feed/") || t.includes("/posts/")) return t;
      }
      return null;
    },
    instagram: function(e) {
      const t = e.closest('[role="article"], article');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/p/"], a[href*="/reel/"], time a');
      return n?.href ? n.href : null;
    },
    facebook: function(e) {
      const t = e.closest('[role="article"], [data-testid="post"]');
      if (!t) return ee(e);
      const n = t.querySelectorAll('a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"]');
      return n.length > 0 ? n[0].href : null;
    },
    tikTok: function(e) {
      const t = e.closest('[data-e2e="user-post-item"], .video-feed-item');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/@"]');
      return n?.href ? n.href : null;
    },
    threads: function(e) {
      const t = e.closest('[role="article"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/t/"], time a');
      return n?.href ? n.href : null;
    },
    bluesky: function(e) {
      const t = e.closest('[data-testid="postThreadItem"], [role="article"]');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/post/"]');
      return n?.href ? n.href : null;
    },
    mastodon: function(e) {
      const t = e.closest(".status, [data-id]");
      if (!t) return ee(e);
      const n = t.querySelector("a.status__relative-time, a.detailed-status__datetime");
      return n?.href ? n.href : null;
    },
    snapchat: function(e) {
      const t = e.closest('[role="article"], .Story');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/add/"], a[href*="/spotlight/"]');
      return n?.href ? n.href : null;
    },
    whatsapp: function(e) {
      return window.location.href;
    },
    telegram: function(e) {
      const t = e.closest(".message, [data-mid]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="t.me"]');
      return n?.href ? n.href : null;
    }
  }, ue = {
    youTube: function(e) {
      const t = e.closest('ytd-rich-grid-media, ytd-thumbnail, ytd-video-renderer, ytd-grid-video-renderer, a[href*="/watch"]');
      if (!t) return ee(e);
      const n = t.querySelector('a#thumbnail[href*="watch?v="]');
      if (n?.href) return n.href;
      const i = t.querySelector('a[href*="watch?v="]');
      return i?.href ? i.href : null;
    },
    vimeo: function(e) {
      const t = e.closest("[data-clip-id], .clip_grid_item");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/video/"], a[href*="vimeo.com/"]');
      return n?.href ? n.href : null;
    },
    dailyMotion: function(e) {
      const t = e.closest("[data-video], .sd_video_item");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/video/"]');
      return n?.href ? n.href : null;
    },
    twitch: function(e) {
      const t = e.closest('[data-a-target="video-card"], .video-card');
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/videos/"], a[href*="/clip/"]');
      return n?.href ? n.href : null;
    },
    rumble: function(e) {
      const t = e.closest(".video-item, [data-video]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*=".html"]');
      return n?.href ? n.href : null;
    },
    odysee: function(e) {
      const t = e.closest(".claim-preview, [data-id]");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/@"]');
      return n?.href ? n.href : null;
    },
    bitchute: function(e) {
      const t = e.closest(".video-card, .channel-videos-container");
      if (!t) return ee(e);
      const n = t.querySelector('a[href*="/video/"]');
      return n?.href ? n.href : null;
    }
  };
  console.log("[Copy-URL-on-Hover] Script loaded! @", (new Date).toISOString());
  try {
    window.CUO_debug_marker = "JS executed to top of file!", console.log("[Copy-URL-on-Hover] Debug marker set successfully");
  } catch (e) {
    console.error("[Copy-URL-on-Hover] CRITICAL: Failed to set window marker", e);
  }
  window.addEventListener("error", e => {
    console.error("[Copy-URL-on-Hover] GLOBAL ERROR:", {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      error: e.error,
      stack: e.error?.stack
    });
  }), window.addEventListener("unhandledrejection", e => {
    console.error("[Copy-URL-on-Hover] UNHANDLED PROMISE REJECTION:", {
      reason: e.reason,
      promise: e.promise
    });
  }), console.log("[Copy-URL-on-Hover] Global error handlers installed"), console.log("[Copy-URL-on-Hover] Starting module imports..."), 
  console.log("[Copy-URL-on-Hover] All module imports completed successfully"), console.log("[Copy-URL-on-Hover] Initializing core systems...");
  const ge = new class {
    constructor() {
      this.config = {
        ...l
      }, this.listeners = [];
    }
    async load() {
      console.log("[ConfigManager] Starting configuration load...");
      try {
        if (!browser || !browser.storage || !browser.storage.local) return console.error("[ConfigManager] browser.storage.local is not available!"), 
        console.warn("[ConfigManager] Using DEFAULT_CONFIG as fallback"), this.config = {
          ...l
        }, this.config;
        console.log("[ConfigManager] Calling browser.storage.local.get...");
        const e = await browser.storage.local.get(l);
        if (console.log("[ConfigManager] Storage get completed, processing result..."), 
        !e || "object" != typeof e) return console.warn("[ConfigManager] Invalid storage result, using DEFAULT_CONFIG"), 
        this.config = {
          ...l
        }, this.config;
        this.config = {
          ...l,
          ...e
        }, console.log("[ConfigManager] Configuration loaded successfully"), console.log("[ConfigManager] Config summary:", {
          debugMode: this.config.debugMode,
          totalKeys: Object.keys(this.config).length
        });
      } catch (e) {
        console.error("[ConfigManager] Exception during load:", {
          message: e.message,
          stack: e.stack,
          name: e.name
        }), console.warn("[ConfigManager] Falling back to DEFAULT_CONFIG due to exception"), 
        this.config = {
          ...l
        };
      }
      return this.config;
    }
    async save() {
      try {
        await browser.storage.local.set(this.config);
      } catch (e) {
        console.error("[Config] Failed to save configuration:", e);
      }
    }
    get(e) {
      return this.config[e];
    }
    set(e, t) {
      this.config[e] = t, this.notifyListeners(e, t);
    }
    getAll() {
      return {
        ...this.config
      };
    }
    update(e) {
      this.config = {
        ...this.config,
        ...e
      }, this.notifyListeners();
    }
    onChange(e) {
      this.listeners.push(e);
    }
    notifyListeners(e, t) {
      this.listeners.forEach(n => n(e, t, this.config));
    }
  };
  console.log("[Copy-URL-on-Hover] ConfigManager initialized");
  const pe = new class {
    constructor() {
      this.state = {
        currentHoveredLink: null,
        currentHoveredElement: null,
        quickTabWindows: [],
        minimizedQuickTabs: [],
        quickTabZIndex: 1e6,
        lastMouseX: 0,
        lastMouseY: 0,
        isSavingToStorage: !1,
        isPanelOpen: !1
      }, this.listeners = new Map;
    }
    getState() {
      return {
        ...this.state
      };
    }
    get(e) {
      return this.state[e];
    }
    set(e, t) {
      const n = this.state[e];
      this.state[e] = t, this.notifyListeners(e, t, n);
    }
    setState(e) {
      const t = {
        ...this.state
      };
      this.state = {
        ...this.state,
        ...e
      }, Object.keys(e).forEach(n => {
        t[n] !== e[n] && this.notifyListeners(n, e[n], t[n]);
      });
    }
    subscribe(e, t) {
      if ("function" == typeof e) {
        const t = Symbol("listener");
        return this.listeners.set(t, {
          key: "*",
          callback: e
        }), () => this.listeners.delete(t);
      }
      {
        const n = Symbol("listener");
        return this.listeners.set(n, {
          key: e,
          callback: t
        }), () => this.listeners.delete(n);
      }
    }
    notifyListeners(e, t, n) {
      this.listeners.forEach(({key: i, callback: o}) => {
        if ("*" === i || i === e) try {
          o(e, t, n, this.state);
        } catch (e) {
          console.error("[State] Listener error:", e);
        }
      });
    }
    reset() {
      this.state = {
        currentHoveredLink: null,
        currentHoveredElement: null,
        quickTabWindows: [],
        minimizedQuickTabs: [],
        quickTabZIndex: 1e6,
        lastMouseX: 0,
        lastMouseY: 0,
        isSavingToStorage: !1,
        isPanelOpen: !1
      }, this.notifyListeners("*", this.state, {});
    }
  };
  console.log("[Copy-URL-on-Hover] StateManager initialized");
  const fe = new class {
    constructor() {
      this.events = new Map, this.debugMode = !1;
    }
    on(e, t) {
      return this.events.has(e) || this.events.set(e, []), this.events.get(e).push(t), 
      this.debugMode && console.log(`[EventBus] Subscribed to "${e}"`), () => this.off(e, t);
    }
    off(e, t) {
      if (!this.events.has(e)) return;
      const n = this.events.get(e), i = n.indexOf(t);
      -1 !== i && (n.splice(i, 1), this.debugMode && console.log(`[EventBus] Unsubscribed from "${e}"`)), 
      0 === n.length && this.events.delete(e);
    }
    emit(e, t) {
      this.events.has(e) && (this.debugMode && console.log(`[EventBus] Emitting "${e}"`, t), 
      this.events.get(e).forEach(n => {
        try {
          n(t);
        } catch (t) {
          console.error(`[EventBus] Error in "${e}" handler:`, t);
        }
      }));
    }
    once(e, t) {
      const n = i => {
        t(i), this.off(e, n);
      };
      return this.on(e, n);
    }
    enableDebug() {
      this.debugMode = !0;
    }
    disableDebug() {
      this.debugMode = !1;
    }
    clear() {
      this.events.clear();
    }
    getEventNames() {
      return Array.from(this.events.keys());
    }
    listenerCount(e) {
      return this.events.has(e) ? this.events.get(e).length : 0;
    }
  };
  console.log("[Copy-URL-on-Hover] EventBus initialized");
  const be = new class {
    constructor() {
      this.handlers = {
        ...he,
        ...ue,
        ...ie,
        ...te,
        ...oe,
        ...re,
        ...ce,
        ...se,
        ...ae,
        ...le,
        ...de
      };
    }
    findURL(e, t) {
      if ("A" === e.tagName && e.href) return e.href;
      let n = e.parentElement;
      for (let e = 0; e < 20 && n; e++) {
        if ("A" === n.tagName && n.href) return n.href;
        n = n.parentElement;
      }
      if (this.handlers[t]) {
        const n = this.handlers[t](e);
        if (n) return n;
      }
      return ee(e);
    }
    getSupportedDomains() {
      return Object.keys(this.handlers);
    }
    isSupported(e) {
      return e in this.handlers;
    }
  };
  console.log("[Copy-URL-on-Hover] URLHandlerRegistry initialized");
  let me = null, ye = null, we = {
    ...l
  };
  !async function() {
    try {
      console.log("[Copy-URL-on-Hover] STEP: Starting extension initialization..."), we = await async function() {
        console.log("[Copy-URL-on-Hover] STEP: Loading user configuration...");
        try {
          const e = await ge.load();
          return console.log("[Copy-URL-on-Hover] ✓ Configuration loaded successfully"), console.log("[Copy-URL-on-Hover] Config values:", {
            debugMode: e.debugMode,
            quickTabPersistAcrossTabs: e.quickTabPersistAcrossTabs,
            hasDefaultConfig: null != e
          }), e;
        } catch (e) {
          return console.error("[Copy-URL-on-Hover] ERROR: Failed to load configuration:", e), 
          console.log("[Copy-URL-on-Hover] Falling back to DEFAULT_CONFIG"), {
            ...l
          };
        }
      }(), function() {
        if (we.debugMode) {
          console.log("[Copy-URL-on-Hover] STEP: Enabling debug mode...");
          try {
            Q = !0, fe.enableDebug(), Z("Debug mode enabled"), console.log("[Copy-URL-on-Hover] ✓ Debug mode activated");
          } catch (e) {
            console.error("[Copy-URL-on-Hover] ERROR: Failed to enable debug mode:", e);
          }
        }
      }(), console.log("[Copy-URL-on-Hover] STEP: Initializing state..."), pe.setState({
        quickTabZIndex: c
      }), console.log("[Copy-URL-on-Hover] ✓ State initialized"), await async function() {
        console.log("[Copy-URL-on-Hover] STEP: Initializing feature modules...");
        try {
          me = await async function(e, t) {
            return console.log("[QuickTabs] Initializing Quick Tabs feature module..."), await J.init(e, t), 
            console.log("[QuickTabs] Quick Tabs feature module initialized"), J;
          }(fe, d), console.log("[Copy-URL-on-Hover] ✓ Quick Tabs feature initialized");
        } catch (e) {
          console.error("[Copy-URL-on-Hover] ERROR: Failed to initialize Quick Tabs:", e);
        }
        try {
          ye = function(e, t) {
            return console.log("[Notifications] Initializing Notifications feature module..."), 
            p.init(e, t), console.log("[Notifications] Notifications feature module initialized"), 
            p;
          }(we, pe), console.log("[Copy-URL-on-Hover] ✓ Notifications feature initialized");
        } catch (e) {
          console.error("[Copy-URL-on-Hover] ERROR: Failed to initialize Notifications:", e);
        }
      }(), Z("Extension initialized successfully"), console.log("[Copy-URL-on-Hover] STEP: Starting main features..."), 
      await (Z("Loading main features..."), document.addEventListener("mousemove", e => {
        pe.set("lastMouseX", e.clientX), pe.set("lastMouseY", e.clientY);
      }, !0), document.addEventListener("mouseover", e => {
        const t = function() {
          const e = window.location.hostname.toLowerCase(), t = {
            "twitter.com": "twitter",
            "x.com": "twitter",
            "reddit.com": "reddit",
            "linkedin.com": "linkedin",
            "instagram.com": "instagram",
            "facebook.com": "facebook",
            "tiktok.com": "tiktok",
            "threads.net": "threads",
            "bsky.app": "bluesky",
            "youtube.com": "youtube",
            "vimeo.com": "vimeo",
            "github.com": "github",
            "gitlab.com": "gitlab",
            "stackoverflow.com": "stackoverflow",
            "medium.com": "medium",
            "amazon.com": "amazon",
            "ebay.com": "ebay",
            "pinterest.com": "pinterest",
            "wikipedia.org": "wikipedia",
            "netflix.com": "netflix",
            "spotify.com": "spotify",
            "twitch.tv": "twitch",
            steam: "steam"
          };
          for (const [n, i] of Object.entries(t)) if (e.includes(n)) return i;
          return "generic";
        }(), n = e.target, i = be.findURL(n, t);
        pe.setState({
          currentHoveredLink: i || null,
          currentHoveredElement: n
        }), i && fe.emit(d.HOVER_START, {
          url: i,
          element: n,
          domainType: t
        });
      }), document.addEventListener("mouseout", e => {
        pe.setState({
          currentHoveredLink: null,
          currentHoveredElement: null
        }), fe.emit(d.HOVER_END);
      }), void document.addEventListener("keydown", Te)), console.log("[Copy-URL-on-Hover] ✓✓✓ EXTENSION FULLY INITIALIZED ✓✓✓"), 
      window.CUO_initialized = !0, console.log("[Copy-URL-on-Hover] Extension is ready for use!");
    } catch (e) {
      !function(e) {
        console.error("[Copy-URL-on-Hover] ❌ CRITICAL INITIALIZATION ERROR ❌"), console.error("[Copy-URL-on-Hover] Error details:", {
          message: e.message,
          stack: e.stack,
          name: e.name
        });
        try {
          const t = `Copy-URL-on-Hover failed to initialize.\n\nError: ${e.message}\n\nPlease check the browser console (F12) for details.`;
          console.error("[Copy-URL-on-Hover] User will see alert:", t);
        } catch (e) {
          console.error("[Copy-URL-on-Hover] Could not show error alert:", e);
        }
      }(e);
    }
  }();
  const ve = [ {
    name: "copyUrl",
    needsLink: !0,
    needsElement: !1,
    handler: async function(e) {
      try {
        await r(e) ? (fe.emit(d.URL_COPIED, {
          url: e
        }), Ce("✓ URL copied!", "success"), Z("Copied URL:", e)) : Ce("✗ Failed to copy URL", "error");
      } catch (e) {
        console.error("[Copy URL] Failed:", e), Ce("✗ Failed to copy URL", "error");
      }
    }
  }, {
    name: "copyText",
    needsLink: !1,
    needsElement: !0,
    handler: async function(e) {
      try {
        const t = function(e) {
          if (!e) return "";
          if ("A" === e.tagName) {
            const t = e.textContent.trim();
            if (t) return t;
          }
          const t = e.querySelector("a[href]");
          if (t) {
            const e = t.textContent.trim();
            if (e) return e;
          }
          const n = e.textContent.trim();
          return n ? n.substring(0, 100) : "";
        }(e);
        if (!t || 0 === t.trim().length) return console.warn("[Copy Text] No text found to copy"), 
        void Ce("✗ No text found", "error");
        await r(t) ? (fe.emit(d.TEXT_COPIED, {
          text: t
        }), Ce("✓ Text copied!", "success"), Z("Copied text:", t)) : (Ce("✗ Failed to copy text", "error"), 
        console.error("[Copy Text] Clipboard operation returned false"));
      } catch (e) {
        console.error("[Copy Text] Failed:", e), Ce("✗ Failed to copy text", "error");
      }
    }
  }, {
    name: "quickTab",
    needsLink: !0,
    needsElement: !0,
    handler: async function(e, t = null) {
      if (!e) return void console.warn("[Quick Tab] Missing URL for creation");
      Z("Creating Quick Tab for:", e), fe.emit(d.QUICK_TAB_REQUESTED, {
        url: e
      });
      const n = we.quickTabDefaultWidth || 800, i = we.quickTabDefaultHeight || 600, o = function(e, t, n) {
        const i = 16, o = window.innerWidth || document.documentElement.clientWidth || t, s = window.innerHeight || document.documentElement.clientHeight || n;
        let a = pe.get("lastMouseX") ?? i, r = pe.get("lastMouseY") ?? i;
        if (e?.getBoundingClientRect) try {
          const t = e.getBoundingClientRect();
          a = t.right + i, r = t.top;
        } catch (e) {
          console.warn("[Quick Tab] Failed to read target bounds:", e);
        }
        const l = Math.max(i, o - t - i), c = Math.max(i, s - n - i);
        return a = Math.min(Math.max(a, i), l), r = Math.min(Math.max(r, i), c), {
          left: Math.round(a),
          top: Math.round(r)
        };
      }(t, n, i), s = t?.textContent?.trim() || "Quick Tab", {quickTabId: r, saveId: l, canUseManagerSaveId: c} = function() {
        const e = Boolean(me && "function" == typeof me.generateSaveId);
        return {
          quickTabId: me && "function" == typeof me.generateId ? me.generateId() : `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          saveId: e ? me.generateSaveId() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          canUseManagerSaveId: e
        };
      }(), h = function(e, t, n, i, o, s) {
        return {
          id: t,
          url: e,
          left: n.left,
          top: n.top,
          width: i,
          height: o,
          title: s,
          cookieStoreId: "firefox-default",
          minimized: !1,
          pinnedToUrl: null
        };
      }(e, r, o, n, i, s);
      try {
        await async function(e, t, n) {
          me && "function" == typeof me.createQuickTab ? function(e, t, n) {
            n && me.trackPendingSave && me.trackPendingSave(t), me.createQuickTab(e);
          }(e, t, n) : console.warn("[Quick Tab] Manager not available, using legacy creation path"), 
          await async function(e, t) {
            await a({
              action: "CREATE_QUICK_TAB",
              ...e,
              saveId: t
            });
          }(e, t), Ce("✓ Quick Tab created!", "success"), Z("Quick Tab created successfully");
        }(h, l, c);
      } catch (e) {
        !function(e, t, n) {
          console.error("[Quick Tab] Failed:", e), n && me?.releasePendingSave && me.releasePendingSave(t), 
          Ce("✗ Failed to create Quick Tab", "error");
        }(e, l, c);
      }
    }
  }, {
    name: "openNewTab",
    needsLink: !0,
    needsElement: !1,
    handler: async function(e) {
      try {
        await a({
          action: "openTab",
          url: e,
          switchFocus: we.openNewTabSwitchFocus
        }), fe.emit(d.LINK_OPENED, {
          url: e
        }), Ce("✓ Opened in new tab", "success"), Z("Opened in new tab:", e);
      } catch (e) {
        console.error("[Open Tab] Failed:", e), Ce("✗ Failed to open tab", "error");
      }
    }
  } ];
  function Se(e, t, n, i) {
    const o = `${t.name}Key`, s = `${t.name}Ctrl`, a = `${t.name}Alt`, r = `${t.name}Shift`;
    return !(!function(e, t, n, i, o) {
      return e.key.toLowerCase() === t.toLowerCase() && e.ctrlKey === n && e.altKey === i && e.shiftKey === o;
    }(e, we[o], we[s], we[a], we[r]) || t.needsLink && !n || t.needsElement && !i);
  }
  async function Te(e) {
    if ((t = e.target) && ("INPUT" === t.tagName || "TEXTAREA" === t.tagName || t.isContentEditable || t.closest('[contenteditable="true"]'))) return;
    var t;
    const n = pe.get("currentHoveredLink"), i = pe.get("currentHoveredElement");
    for (const t of ve) if (Se(e, t, n, i)) return e.preventDefault(), void await t.handler(n, i);
  }
  function Ce(e, t = "info") {
    Z("Notification:", e, t), ye ? ye.showNotification(e, t) : console.warn("[Content] Notification manager not initialized, skipping notification");
  }
  "undefined" != typeof browser && browser.runtime && browser.runtime.onMessage.addListener((e, o, s) => {
    if ("GET_CONTENT_LOGS" === e.action) {
      console.log("[Content] Received GET_CONTENT_LOGS request");
      try {
        const e = [ ...n ], i = [ ...F ], o = [ ...e, ...i ];
        o.sort((e, t) => e.timestamp - t.timestamp), console.log(`[Content] Sending ${o.length} logs to popup`), 
        console.log(`[Content] Console logs: ${e.length}, Debug logs: ${i.length}`);
        const a = {
          totalLogs: n.length,
          maxSize: t,
          utilizationPercent: (n.length / t * 100).toFixed(2),
          oldestTimestamp: n[0]?.timestamp || null,
          newestTimestamp: n[n.length - 1]?.timestamp || null
        };
        console.log("[Content] Buffer stats:", a), s({
          logs: o,
          stats: a
        });
      } catch (e) {
        console.error("[Content] Error getting log buffer:", e), s({
          logs: [],
          error: e.message
        });
      }
      return !0;
    }
    if ("CLEAR_CONTENT_LOGS" === e.action) {
      try {
        n.length = 0, i.log("[Console Interceptor] Log buffer cleared"), F.length = 0, console.log("[DEBUG] Log buffer cleared"), 
        s({
          success: !0,
          clearedAt: Date.now()
        });
      } catch (e) {
        console.error("[Content] Error clearing log buffer:", e), s({
          success: !1,
          error: e.message
        });
      }
      return !0;
    }
    if ("TOGGLE_QUICK_TABS_PANEL" === e.action) return function(e) {
      console.log("[Content] Received TOGGLE_QUICK_TABS_PANEL request");
      try {
        if (!me) return console.error("[Content] Quick Tabs manager not initialized"), void e({
          success: !1,
          error: "Quick Tabs manager not initialized"
        });
        if (!me.panelManager) return console.error("[Content] Quick Tabs panel manager not available"), 
        void e({
          success: !1,
          error: "Panel manager not available"
        });
        me.panelManager.toggle(), console.log("[Content] ✓ Quick Tabs panel toggled successfully"), 
        e({
          success: !0
        });
      } catch (t) {
        console.error("[Content] Error toggling Quick Tabs panel:", t), e({
          success: !1,
          error: t.message
        });
      }
    }(s), !0;
  }), "undefined" != typeof window && (window.CopyURLExtension = {
    configManager: ge,
    stateManager: pe,
    eventBus: fe,
    urlRegistry: be,
    quickTabsManager: me,
    notificationManager: ye,
    CONFIG: we
  });
}(browser);
