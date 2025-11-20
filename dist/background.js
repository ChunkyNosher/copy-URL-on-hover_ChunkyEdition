!function() {
  "use strict";
  const e = "undefined" != typeof browser && browser.runtime || "undefined" != typeof chrome && chrome.runtime || null, t = "undefined" != typeof browser && browser.downloads || "undefined" != typeof chrome && chrome.downloads || null, a = e?.id || null, s = [];
  function o(e, ...t) {
    s.length >= 2e3 && s.shift(), s.push({
      type: e,
      timestamp: Date.now(),
      message: t.map(e => "object" == typeof e ? JSON.stringify(e, null, 2) : String(e)).join(" "),
      args: t
    });
  }
  const n = console.log, r = console.error, i = console.warn, c = console.info;
  console.log = function(...e) {
    o("DEBUG", ...e), n.apply(console, e);
  }, console.error = function(...e) {
    o("ERROR", ...e), r.apply(console, e);
  }, console.warn = function(...e) {
    o("WARN", ...e), i.apply(console, e);
  }, console.info = function(...e) {
    o("INFO", ...e), c.apply(console, e);
  };
  const l = new Map, d = {
    containers: {
      "firefox-default": {
        tabs: [],
        lastUpdate: 0
      }
    }
  };
  let u = !1;
  const g = new class {
    detect(e) {
      return e ? "object" != typeof e ? "empty" : e.containers ? "v1.5.8.15" : Array.isArray(e.tabs) || e.containers ? e.tabs ? "legacy" : "empty" : "v1.5.8.14" : "empty";
    }
  }, b = {
    "v1.5.8.15": new class {
      migrate(e, t) {
        return e.containers && "object" == typeof e.containers && (t.containers = e.containers), 
        t;
      }
      getFormatName() {
        return "v1.5.8.15 (containers wrapper)";
      }
    },
    "v1.5.8.14": new class {
      migrate(e, t) {
        return t.containers = e, t;
      }
      getFormatName() {
        return "v1.5.8.14 (unwrapped containers)";
      }
    },
    legacy: new class {
      migrate(e, t) {
        return t.containers["firefox-default"] = {
          tabs: e.tabs || [],
          lastUpdate: e.timestamp || Date.now()
        }, t;
      }
      getFormatName() {
        return "legacy (flat tabs array)";
      }
    }
  };
  async function h() {
    if (u) console.log("[Background] State already initialized"); else try {
      if (await async function() {
        if (void 0 === browser.storage.session) return !1;
        const e = await browser.storage.session.get("quick_tabs_session");
        if (!e || !e.quick_tabs_session) return !1;
        const t = g.detect(e.quick_tabs_session), a = b[t];
        return !!a && (b[t].migrate(e.quick_tabs_session, d), T("session storage", a.getFormatName()), 
        u = !0, !0);
      }()) return;
      await async function() {
        const e = await browser.storage.sync.get("quick_tabs_state_v2");
        if (!e || !e.quick_tabs_state_v2) return console.log("[Background] ✓ EAGER LOAD: No saved state found, starting with empty state"), 
        void (u = !0);
        const t = g.detect(e.quick_tabs_state_v2), a = b[t];
        a && (b[t].migrate(e.quick_tabs_state_v2, d), T("sync storage", a.getFormatName()), 
        "legacy" === t && await async function() {
          const e = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          try {
            await browser.storage.sync.set({
              quick_tabs_state_v2: {
                containers: d.containers,
                saveId: e,
                timestamp: Date.now()
              }
            }), console.log("[Background] ✓ Migrated legacy format to v1.5.8.15");
          } catch (e) {
            console.error("[Background] Error saving migrated state:", e);
          }
        }()), u = !0;
      }();
    } catch (e) {
      console.error("[Background] Error initializing global state:", e), u = !0;
    }
  }
  function T(e, t) {
    const a = Object.values(d.containers).reduce((e, t) => e + (t.tabs?.length || 0), 0);
    console.log(`[Background] ✓ EAGER LOAD: Initialized from ${e} (${t}):`, a, "tabs across", Object.keys(d.containers).length, "containers");
  }
  function w(e) {
    let t = !1;
    for (const a of e) f(a) && (t = !0);
    return t;
  }
  function f(e) {
    return "pinnedToUrl" in e && (console.log(`[Background Migration] Converting Quick Tab ${e.id} from pin to solo/mute format`), 
    e.soloedOnTabs = e.soloedOnTabs || [], e.mutedOnTabs = e.mutedOnTabs || [], delete e.pinnedToUrl, 
    !0);
  }
  h(), async function() {
    if (!u) return void console.warn("[Background Migration] State not initialized, skipping migration");
    let e = !1;
    for (const t in d.containers) w(d.containers[t].tabs || []) && (e = !0);
    e ? await async function() {
      console.log("[Background Migration] Saving migrated Quick Tab state");
      const e = {
        containers: d.containers,
        saveId: `migration-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now()
      };
      try {
        await browser.storage.sync.set({
          quick_tabs_state_v2: e
        }), console.log("[Background Migration] ✓ Migration complete");
      } catch (e) {
        console.error("[Background Migration] Error saving migrated state:", e);
      }
    }() : console.log("[Background Migration] No migration needed");
  }();
  const p = new class {
    constructor() {
      this.globalState = {
        tabs: [],
        timestamp: 0,
        version: 1
      }, this.pendingConfirmations = new Map, this.tabVectorClocks = new Map, this.initialized = !1;
    }
    async initialize() {
      if (this.initialized) console.log("[STATE COORDINATOR] Already initialized"); else try {
        if (await this.tryLoadFromSessionStorage()) return;
        await this.tryLoadFromSyncStorage();
      } catch (e) {
        console.error("[STATE COORDINATOR] Error initializing:", e), this.initialized = !0;
      }
    }
    async tryLoadFromSessionStorage() {
      if (void 0 === browser.storage.session) return !1;
      const e = await browser.storage.session.get("quick_tabs_session");
      return !!(e && e.quick_tabs_session && e.quick_tabs_session.tabs) && (this.globalState = e.quick_tabs_session, 
      this.initialized = !0, console.log("[STATE COORDINATOR] Initialized from session storage:", this.globalState.tabs.length, "tabs"), 
      !0);
    }
    async tryLoadFromSyncStorage() {
      const e = await browser.storage.sync.get("quick_tabs_state_v2");
      if (!e || !e.quick_tabs_state_v2) return this.initialized = !0, void console.log("[STATE COORDINATOR] No saved state, starting fresh");
      this.loadStateFromSyncData(e.quick_tabs_state_v2), this.initialized = !0, console.log("[STATE COORDINATOR] Initialized from sync storage:", this.globalState.tabs.length, "tabs");
    }
    _extractContainerTabs(e) {
      return e && e.tabs ? e.tabs : [];
    }
    loadStateFromSyncData(e) {
      if ("object" == typeof e && !Array.isArray(e.tabs)) {
        const t = [];
        for (const a in e) {
          const s = e[a], o = this._extractContainerTabs(s);
          t.push(...o);
        }
        return this.globalState.tabs = t, void (this.globalState.timestamp = Date.now());
      }
      e.tabs && (this.globalState = e);
    }
    async processBatchUpdate(e, t, a) {
      await this.initialize(), console.log(`[STATE COORDINATOR] Processing ${t.length} operations from tab ${e}`);
      const s = new Map;
      t.forEach(e => {
        e.vectorClock && e.vectorClock.forEach(([e, t]) => {
          s.set(e, Math.max(s.get(e) || 0, t));
        });
      }), this.tabVectorClocks.set(a, s);
      for (const e of t) this.processOperation(e);
      return await this.persistState(), await this.broadcastState(), console.log("[STATE COORDINATOR] Batch update complete"), 
      {
        success: !0
      };
    }
    processOperation(e) {
      const {type: t, quickTabId: a, data: s} = e;
      switch (t) {
       case "create":
        this.handleCreateOperation(a, s);
        break;

       case "update":
        this.handleUpdateOperation(a, s);
        break;

       case "delete":
        this.handleDeleteOperation(a);
        break;

       case "minimize":
        this.handleMinimizeOperation(a, s);
        break;

       case "restore":
        this.handleRestoreOperation(a);
        break;

       default:
        console.warn(`[STATE COORDINATOR] Unknown operation type: ${t}`);
      }
      this.globalState.timestamp = Date.now();
    }
    handleCreateOperation(e, t) {
      const a = this.globalState.tabs.findIndex(t => t.id === e);
      -1 === a ? (this.globalState.tabs.push(t), console.log(`[STATE COORDINATOR] Created Quick Tab ${e}`)) : (this.globalState.tabs[a] = {
        ...this.globalState.tabs[a],
        ...t
      }, console.log(`[STATE COORDINATOR] Updated existing Quick Tab ${e}`));
    }
    handleUpdateOperation(e, t) {
      const a = this.globalState.tabs.findIndex(t => t.id === e);
      -1 !== a ? (this.globalState.tabs[a] = {
        ...this.globalState.tabs[a],
        ...t
      }, console.log(`[STATE COORDINATOR] Updated Quick Tab ${e}`)) : console.warn(`[STATE COORDINATOR] Tab ${e} not found for update`);
    }
    handleDeleteOperation(e) {
      const t = this.globalState.tabs.findIndex(t => t.id === e);
      -1 !== t ? (this.globalState.tabs.splice(t, 1), console.log(`[STATE COORDINATOR] Deleted Quick Tab ${e}`)) : console.warn(`[STATE COORDINATOR] Tab ${e} not found for delete`);
    }
    handleMinimizeOperation(e, t) {
      const a = this.globalState.tabs.findIndex(t => t.id === e);
      -1 !== a ? (this.globalState.tabs[a].minimized = !0, console.log(`[STATE COORDINATOR] Minimized Quick Tab ${e}`)) : t && (this.globalState.tabs.push({
        ...t,
        minimized: !0
      }), console.log(`[STATE COORDINATOR] Created minimized Quick Tab ${e}`));
    }
    handleRestoreOperation(e) {
      const t = this.globalState.tabs.findIndex(t => t.id === e);
      -1 !== t ? (this.globalState.tabs[t].minimized = !1, console.log(`[STATE COORDINATOR] Restored Quick Tab ${e}`)) : console.warn(`[STATE COORDINATOR] Tab ${e} not found for restore`);
    }
    async persistState() {
      try {
        await browser.storage.sync.set({
          quick_tabs_state_v2: this.globalState
        }), void 0 !== browser.storage.session && await browser.storage.session.set({
          quick_tabs_session: this.globalState
        }), console.log("[STATE COORDINATOR] Persisted state to storage");
      } catch (e) {
        throw console.error("[STATE COORDINATOR] Error persisting state:", e), e;
      }
    }
    async broadcastState() {
      try {
        const e = await browser.tabs.query({});
        for (const t of e) browser.tabs.sendMessage(t.id, {
          action: "SYNC_STATE_FROM_COORDINATOR",
          state: this.globalState
        }).catch(() => {});
        console.log(`[STATE COORDINATOR] Broadcasted state to ${e.length} tabs`);
      } catch (e) {
        console.error("[STATE COORDINATOR] Error broadcasting state:", e);
      }
    }
    getState() {
      return this.globalState;
    }
  };
  console.log("[Quick Tabs] Initializing Firefox MV3 X-Frame-Options bypass...");
  const m = new Set;
  function _(e, t) {
    let a = !1;
    return e.soloedOnTabs && e.soloedOnTabs.includes(t) && (e.soloedOnTabs = e.soloedOnTabs.filter(e => e !== t), 
    a = !0, console.log(`[Background] Removed tab ${t} from Quick Tab ${e.id} solo list`)), 
    e.mutedOnTabs && e.mutedOnTabs.includes(t) && (e.mutedOnTabs = e.mutedOnTabs.filter(e => e !== t), 
    a = !0, console.log(`[Background] Removed tab ${t} from Quick Tab ${e.id} mute list`)), 
    a;
  }
  function S(e, t) {
    let a = !1;
    for (const s of e) _(s, t) && (a = !0);
    return a;
  }
  browser.webRequest.onHeadersReceived.addListener(e => (console.log(`[Quick Tabs] Processing iframe: ${e.url}`), 
  {
    responseHeaders: e.responseHeaders.filter(t => {
      const a = t.name.toLowerCase();
      if ("x-frame-options" === a) return console.log(`[Quick Tabs] ✓ Removed X-Frame-Options: ${t.value} from ${e.url}`), 
      m.add(e.url), !1;
      if ("content-security-policy" === a) {
        const a = t.value;
        if (t.value = t.value.replace(/frame-ancestors[^;]*(;|$)/gi, ""), "" === t.value.trim() || ";" === t.value.trim()) return console.log(`[Quick Tabs] ✓ Removed empty CSP from ${e.url}`), 
        m.add(e.url), !1;
        t.value !== a && (console.log(`[Quick Tabs] ✓ Modified CSP for ${e.url}`), m.add(e.url));
      }
      if ("cross-origin-resource-policy" === a) {
        const a = t.value.toLowerCase();
        if ("same-origin" === a || "same-site" === a) return console.log(`[Quick Tabs] ✓ Removed CORP: ${t.value} from ${e.url}`), 
        m.add(e.url), !1;
      }
      return !0;
    })
  }), {
    urls: [ "<all_urls>" ],
    types: [ "sub_frame" ]
  }, [ "blocking", "responseHeaders" ]), browser.webRequest.onCompleted.addListener(e => {
    m.has(e.url) && (console.log(`[Quick Tabs] ✅ Successfully loaded iframe: ${e.url}`), 
    m.size > 100 && m.clear());
  }, {
    urls: [ "<all_urls>" ],
    types: [ "sub_frame" ]
  }), browser.webRequest.onErrorOccurred.addListener(e => {
    console.error(`[Quick Tabs] ❌ Failed to load iframe: ${e.url}`), console.error(`[Quick Tabs] Error: ${e.error}`);
  }, {
    urls: [ "<all_urls>" ],
    types: [ "sub_frame" ]
  }), console.log("[Quick Tabs] ✓ Firefox MV3 X-Frame-Options bypass installed"), 
  chrome.tabs.onActivated.addListener(async e => {
    console.log("[Background] Tab activated:", e.tabId), chrome.tabs.sendMessage(e.tabId, {
      action: "tabActivated",
      tabId: e.tabId
    }).catch(e => {
      console.log("[Background] Could not message tab (content script not ready)");
    });
    try {
      const t = (await browser.tabs.get(e.tabId)).cookieStoreId || "firefox-default";
      d.containers[t] && d.containers[t].tabs.length > 0 && chrome.tabs.sendMessage(e.tabId, {
        action: "SYNC_QUICK_TAB_STATE_FROM_BACKGROUND",
        state: {
          tabs: d.containers[t].tabs,
          lastUpdate: d.containers[t].lastUpdate
        },
        cookieStoreId: t
      }).catch(() => {});
    } catch (e) {
      console.error("[Background] Error getting tab info:", e);
    }
  }), chrome.tabs.onUpdated.addListener((e, t, a) => {
    "complete" === t.status && chrome.scripting.executeScript({
      target: {
        tabId: e
      },
      files: [ "content.js" ]
    }).then(() => {
      const t = l.get(e);
      t && t.quickTabs && t.quickTabs.length > 0 && chrome.tabs.sendMessage(e, {
        action: "restoreQuickTabs",
        quickTabs: t.quickTabs
      }).catch(e => {});
    }).catch(e => {});
  }), chrome.tabs.onRemoved.addListener(async e => {
    l.delete(e), console.log(`[Background] Tab ${e} closed - cleaning up Quick Tab references`), 
    await async function(e) {
      if (!u) return !1;
      let t = !1;
      for (const a in d.containers) S(d.containers[a].tabs || [], e) && (t = !0);
      if (!t) return !1;
      const a = {
        containers: d.containers,
        saveId: `cleanup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now()
      };
      try {
        return await browser.storage.sync.set({
          quick_tabs_state_v2: a
        }), console.log("[Background] Cleaned up Quick Tab state after tab closure"), !0;
      } catch (e) {
        return console.error("[Background] Error saving cleaned up state:", e), !1;
      }
    }(e);
  }), console.log("[Background] Initializing MessageRouter and handlers...");
  const I = new class {
    constructor() {
      this.handlers = new Map, this.extensionId = null;
    }
    register(e, t) {
      const a = Array.isArray(e) ? e : [ e ];
      for (const e of a) this.handlers.has(e) && console.warn(`[MessageRouter] Overwriting handler for action: ${e}`), 
      this.handlers.set(e, t);
    }
    setExtensionId(e) {
      this.extensionId = e;
    }
    isAuthorizedSender(e) {
      return !(!e || !e.id || (this.extensionId ? e.id !== this.extensionId : (console.warn("[MessageRouter] Extension ID not set - defaulting to optimistic validation"), 
      0)));
    }
    async route(e, t, a) {
      if (!e || "string" != typeof e.action) return console.error("[MessageRouter] Invalid message format:", e), 
      a({
        success: !1,
        error: "Invalid message format"
      }), !1;
      const s = this.handlers.get(e.action);
      if (!s) return console.warn(`[MessageRouter] No handler for action: ${e.action}`), 
      a({
        success: !1,
        error: `Unknown action: ${e.action}`
      }), !1;
      try {
        const o = await s(e, t);
        return a && a(o), !0;
      } catch (t) {
        return console.error(`[MessageRouter] Handler error for ${e.action}:`, t), a && a({
          success: !1,
          error: t.message || "Handler execution failed"
        }), !0;
      }
    }
    createListener() {
      return (e, t, a) => (this.route(e, t, a), !0);
    }
  };
  I.setExtensionId(a);
  const O = new class {
    constructor(e, t, a) {
      this.logBuffer = e, this.downloadsAPI = t, this.browserAPI = a, this.pendingDownloads = new Map;
    }
    async handleClearLogs(e, t) {
      const a = this.clearBackgroundLogs();
      let s = 0;
      if (this.browserAPI?.tabs?.query) try {
        const e = await this.browserAPI.tabs.query({});
        s = (await Promise.allSettled(e.map(e => this.browserAPI.tabs.sendMessage(e.id, {
          action: "CLEAR_CONTENT_LOGS"
        }).catch(() => ({
          success: !1
        }))))).filter(e => "fulfilled" === e.status && e.value?.success).length;
      } catch (e) {
        console.warn("[LogHandler] Failed to broadcast CLEAR_CONTENT_LOGS:", e);
      }
      return {
        success: !0,
        clearedTabs: s,
        clearedBackgroundEntries: a
      };
    }
    handleGetLogs(e, t) {
      return {
        logs: [ ...this.logBuffer ]
      };
    }
    async handleExportLogs(e, t) {
      if ("string" != typeof e.logText || "string" != typeof e.filename) throw new Error("Invalid log export payload");
      return await this.exportLogsToFile(e.logText, e.filename), {
        success: !0
      };
    }
    clearBackgroundLogs() {
      const e = this.logBuffer.length;
      return this.logBuffer.length = 0, e;
    }
    exportLogsToFile(e, t) {
      if (!this.downloadsAPI || !this.downloadsAPI.download) throw new Error("Downloads API not available");
      const a = new Blob([ e ], {
        type: "text/plain"
      }), s = URL.createObjectURL(a);
      return new Promise((e, a) => {
        let o = null;
        const n = setTimeout(() => {
          URL.revokeObjectURL(s), o && this.pendingDownloads.delete(o), a(new Error("Download timeout after 60 seconds"));
        }, 6e4);
        this.downloadsAPI.download({
          url: s,
          filename: t,
          saveAs: !0
        }, t => {
          if (o = t, !t) {
            clearTimeout(n), URL.revokeObjectURL(s);
            const e = this.downloadsAPI.runtime?.lastError;
            return void a(new Error(e?.message || "Download failed"));
          }
          this.pendingDownloads.set(t, {
            url: s,
            timeoutId: n
          });
          const r = o => {
            o.id === t && ("complete" === o.state?.current ? (clearTimeout(n), URL.revokeObjectURL(s), 
            this.pendingDownloads.delete(t), this.downloadsAPI.onChanged.removeListener(r), 
            e()) : "interrupted" === o.state?.current && (clearTimeout(n), URL.revokeObjectURL(s), 
            this.pendingDownloads.delete(t), this.downloadsAPI.onChanged.removeListener(r), 
            a(new Error("Download interrupted"))));
          };
          this.downloadsAPI.onChanged.addListener(r);
        });
      });
    }
  }(s, t, browser), k = new class {
    constructor(e, t, a, s) {
      this.globalState = e, this.stateCoordinator = t, this.browserAPI = a, this.initializeFn = s, 
      this.isInitialized = !1;
    }
    setInitialized(e) {
      this.isInitialized = e;
    }
    async updateQuickTabProperty(e, t, a = !0) {
      this.isInitialized || await this.initializeFn();
      const s = e.cookieStoreId || "firefox-default", o = this.globalState.containers[s];
      if (!o) return {
        success: !0
      };
      const n = o.tabs.find(t => t.id === e.id);
      return n ? (t(n, e), o.lastUpdate = Date.now(), a && await this.saveStateToStorage(), 
      {
        success: !0
      }) : {
        success: !0
      };
    }
    async handleBatchUpdate(e, t) {
      const a = t.tab?.id;
      return await this.stateCoordinator.processBatchUpdate(a, e.operations, e.tabInstanceId);
    }
    async handleCreate(e, t) {
      console.log("[QuickTabHandler] Create:", e.url, "ID:", e.id, "Container:", e.cookieStoreId), 
      this.isInitialized || await this.initializeFn();
      const a = e.cookieStoreId || "firefox-default";
      this.globalState.containers[a] || (this.globalState.containers[a] = {
        tabs: [],
        lastUpdate: 0
      });
      const s = this.globalState.containers[a], o = s.tabs.findIndex(t => t.id === e.id), n = {
        id: e.id,
        url: e.url,
        left: e.left,
        top: e.top,
        width: e.width,
        height: e.height,
        pinnedToUrl: e.pinnedToUrl || null,
        title: e.title || "Quick Tab",
        minimized: e.minimized || !1
      };
      return -1 !== o ? s.tabs[o] = n : s.tabs.push(n), s.lastUpdate = Date.now(), await this.saveState(e.saveId, a, e), 
      {
        success: !0
      };
    }
    async handleClose(e, t) {
      console.log("[QuickTabHandler] Close:", e.url, "ID:", e.id, "Container:", e.cookieStoreId), 
      this.isInitialized || await this.initializeFn();
      const a = e.cookieStoreId || "firefox-default";
      if (this.globalState.containers[a]) {
        const t = this.globalState.containers[a];
        t.tabs = t.tabs.filter(t => t.id !== e.id), t.lastUpdate = Date.now(), await this.saveStateToStorage(), 
        await this.broadcastToContainer(a, {
          action: "CLOSE_QUICK_TAB_FROM_BACKGROUND",
          id: e.id,
          url: e.url,
          cookieStoreId: a
        });
      }
      return {
        success: !0
      };
    }
    handlePositionUpdate(e, t) {
      const a = "UPDATE_QUICK_TAB_POSITION_FINAL" === e.action;
      return this.updateQuickTabProperty(e, (e, t) => {
        e.left = t.left, e.top = t.top;
      }, a);
    }
    handleSizeUpdate(e, t) {
      const a = "UPDATE_QUICK_TAB_SIZE_FINAL" === e.action;
      return this.updateQuickTabProperty(e, (e, t) => {
        e.width = t.width, e.height = t.height;
      }, a);
    }
    handlePinUpdate(e, t) {
      return this.updateQuickTabProperty(e, (e, t) => {
        e.pinnedToUrl = t.pinnedToUrl;
      });
    }
    handleSoloUpdate(e, t) {
      return this.updateQuickTabProperty(e, (e, t) => {
        e.soloedOnTabs = t.soloedOnTabs || [];
      });
    }
    handleMuteUpdate(e, t) {
      return this.updateQuickTabProperty(e, (e, t) => {
        e.mutedOnTabs = t.mutedOnTabs || [];
      });
    }
    handleMinimizeUpdate(e, t) {
      return this.updateQuickTabProperty(e, (e, t) => {
        e.minimized = t.minimized;
      });
    }
    handleGetCurrentTabId(e, t) {
      const a = t.tab?.id;
      return {
        success: !0,
        tabId: a
      };
    }
    async saveState(e, t, a) {
      const s = e || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, o = {
        containers: this.globalState.containers,
        saveId: s,
        timestamp: Date.now()
      };
      try {
        await this.browserAPI.storage.sync.set({
          quick_tabs_state_v2: o
        }), void 0 !== this.browserAPI.storage.session && await this.browserAPI.storage.session.set({
          quick_tabs_session: o
        }), await this.broadcastToContainer(t, {
          action: "CREATE_QUICK_TAB_FROM_BACKGROUND",
          id: a.id,
          url: a.url,
          left: a.left,
          top: a.top,
          width: a.width,
          height: a.height,
          title: a.title,
          cookieStoreId: t
        });
      } catch (e) {
        console.error("[QuickTabHandler] Error saving state:", e);
      }
    }
    async saveStateToStorage() {
      const e = {
        containers: this.globalState.containers,
        timestamp: Date.now()
      };
      try {
        await this.browserAPI.storage.sync.set({
          quick_tabs_state_v2: e
        }), void 0 !== this.browserAPI.storage.session && await this.browserAPI.storage.session.set({
          quick_tabs_session: e
        });
      } catch (e) {
        console.error("[QuickTabHandler] Error saving state:", e);
      }
    }
    async broadcastToContainer(e, t) {
      try {
        const a = await this.browserAPI.tabs.query({
          cookieStoreId: e
        });
        await Promise.allSettled(a.map(e => this.browserAPI.tabs.sendMessage(e.id, t).catch(() => {})));
      } catch (e) {
        console.error("[QuickTabHandler] Error broadcasting:", e);
      }
    }
  }(d, p, browser, h), A = new class {
    constructor(e, t) {
      this.quickTabStates = e, this.browserAPI = t;
    }
    async handleOpenTab(e, t) {
      if (!e.url) throw new Error("URL is required");
      const a = {
        url: e.url
      };
      return void 0 !== e.active && (a.active = e.active), {
        success: !0,
        tabId: (await this.browserAPI.tabs.create(a)).id
      };
    }
    handleSaveState(e, t) {
      const a = t.tab?.id;
      if (!a) throw new Error("Tab ID not available");
      return this.quickTabStates.set(a, e.state), {
        success: !0
      };
    }
    handleGetState(e, t) {
      const a = t.tab?.id;
      if (!a) throw new Error("Tab ID not available");
      return {
        success: !0,
        state: this.quickTabStates.get(a) || null
      };
    }
    handleClearState(e, t) {
      const a = t.tab?.id;
      if (!a) throw new Error("Tab ID not available");
      return this.quickTabStates.delete(a), {
        success: !0
      };
    }
    handleLegacyCreate(e, t) {
      return console.log("[TabHandler] Legacy createQuickTab action - use CREATE_QUICK_TAB instead"), 
      {
        success: !0,
        message: "Use CREATE_QUICK_TAB action"
      };
    }
  }(l, browser);
  async function y(e, t) {
    const a = await browser.tabs.query({});
    for (const s of a) try {
      await browser.tabs.sendMessage(s.id, {
        action: e,
        ...t
      });
    } catch (e) {}
  }
  u && k.setInitialized(!0), I.register("CLEAR_CONSOLE_LOGS", (e, t) => O.handleClearLogs(e, t)), 
  I.register("GET_BACKGROUND_LOGS", (e, t) => O.handleGetLogs(e, t)), I.register("EXPORT_LOGS", (e, t) => O.handleExportLogs(e, t)), 
  I.register("BATCH_QUICK_TAB_UPDATE", (e, t) => k.handleBatchUpdate(e, t)), I.register("CREATE_QUICK_TAB", (e, t) => k.handleCreate(e, t)), 
  I.register("CLOSE_QUICK_TAB", (e, t) => k.handleClose(e, t)), I.register([ "UPDATE_QUICK_TAB_POSITION", "UPDATE_QUICK_TAB_POSITION_FINAL" ], (e, t) => k.handlePositionUpdate(e, t)), 
  I.register([ "UPDATE_QUICK_TAB_SIZE", "UPDATE_QUICK_TAB_SIZE_FINAL" ], (e, t) => k.handleSizeUpdate(e, t)), 
  I.register("UPDATE_QUICK_TAB_PIN", (e, t) => k.handlePinUpdate(e, t)), I.register("UPDATE_QUICK_TAB_SOLO", (e, t) => k.handleSoloUpdate(e, t)), 
  I.register("UPDATE_QUICK_TAB_MUTE", (e, t) => k.handleMuteUpdate(e, t)), I.register("UPDATE_QUICK_TAB_MINIMIZE", (e, t) => k.handleMinimizeUpdate(e, t)), 
  I.register("GET_CURRENT_TAB_ID", (e, t) => k.handleGetCurrentTabId(e, t)), I.register("openTab", (e, t) => A.handleOpenTab(e, t)), 
  I.register("saveQuickTabState", (e, t) => A.handleSaveState(e, t)), I.register("getQuickTabState", (e, t) => A.handleGetState(e, t)), 
  I.register("clearQuickTabState", (e, t) => A.handleClearState(e, t)), I.register("createQuickTab", (e, t) => A.handleLegacyCreate(e, t)), 
  console.log("[Background] MessageRouter initialized with 21 registered handlers"), 
  chrome.runtime.onMessage.addListener(I.createListener()), chrome.sidePanel && chrome.action.onClicked.addListener(e => {
    chrome.sidePanel.open({
      windowId: e.windowId
    }).catch(e => {
      console.log("Side panel not supported or error:", e);
    });
  }), browser.storage.onChanged.addListener((e, t) => {
    console.log("[Background] Storage changed:", t, Object.keys(e)), "sync" === t && (e.quick_tabs_state_v2 && async function(e) {
      console.log("[Background] Quick Tab state changed, broadcasting to all tabs");
      const t = e.quick_tabs_state_v2.newValue;
      !function(e) {
        if (e) return "object" == typeof e && e.containers ? (d.containers = e.containers, 
        void console.log("[Background] Updated global state from storage (container-aware):", Object.keys(e.containers).length, "containers")) : void (e.tabs && Array.isArray(e.tabs) && (d.containers = {
          "firefox-default": {
            tabs: e.tabs,
            lastUpdate: e.timestamp || Date.now()
          }
        }, console.log("[Background] Updated global state from storage (legacy format):", e.tabs.length, "tabs")));
        console.log("[Background] Storage cleared, checking if intentional...");
      }(t), await y("SYNC_QUICK_TAB_STATE_FROM_BACKGROUND", {
        state: t
      });
    }(e), e.quick_tab_settings && async function(e) {
      console.log("[Background] Settings changed, broadcasting to all tabs"), await y("SETTINGS_UPDATED", {
        settings: e.quick_tab_settings.newValue
      });
    }(e));
  }), browser.commands.onCommand.addListener(async e => {
    "toggle-quick-tabs-manager" === e && await async function() {
      const e = await browser.tabs.query({
        active: !0,
        currentWindow: !0
      });
      if (0 === e.length) return void console.error("[QuickTabsManager] No active tab found");
      const t = e[0];
      try {
        await browser.tabs.sendMessage(t.id, {
          action: "TOGGLE_QUICK_TABS_PANEL"
        }), console.log("[QuickTabsManager] Toggle command sent to tab", t.id);
      } catch (e) {
        console.error("[QuickTabsManager] Error sending toggle message:", e);
        try {
          await browser.tabs.executeScript(t.id, {
            file: "content.js"
          }), await browser.tabs.sendMessage(t.id, {
            action: "TOGGLE_QUICK_TABS_PANEL"
          });
        } catch (e) {
          console.error("[QuickTabsManager] Error injecting content script:", e);
        }
      }
    }();
  });
}();
