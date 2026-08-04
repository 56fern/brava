import { contextBridge, ipcRenderer } from "electron";
import type { AppData, BravaApi, Harvester, MonitorState, ProductSignal, Task, UpdateState } from "../shared/types.js";

const api: BravaApi = {
  clipboard: {
    writeText: (value) => ipcRenderer.invoke("clipboard:write-text", value),
  },
  external: {
    openOrderStatus: () => ipcRenderer.invoke("external:open-order-status"),
  },
  windowControls: {
    setMode: (mode) => ipcRenderer.invoke("window:set-mode", mode),
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onMaximized: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized);
      ipcRenderer.on("window:maximized", handler);
      return () => ipcRenderer.removeListener("window:maximized", handler);
    },
  },
  data: {
    load: () => ipcRenderer.invoke("data:load") as Promise<AppData>,
    save: (data) => ipcRenderer.invoke("data:save", data) as Promise<AppData>,
  },
  license: {
    device: () => ipcRenderer.invoke("license:device"),
    resume: (apiUrl) => ipcRenderer.invoke("license:resume", apiUrl),
    activate: (key, apiUrl) => ipcRenderer.invoke("license:activate", key, apiUrl),
    heartbeat: (apiUrl) => ipcRenderer.invoke("license:heartbeat", apiUrl),
    deactivate: (apiUrl) => ipcRenderer.invoke("license:deactivate", apiUrl),
    key: () => ipcRenderer.invoke("license:key"),
    copyKey: () => ipcRenderer.invoke("license:copy-key"),
  },
  webhooks: {
    get: () => ipcRenderer.invoke("webhook:get"),
    save: (settings) => ipcRenderer.invoke("webhook:save", settings),
    test: (kind) => ipcRenderer.invoke("webhook:test", kind),
  },
  proxies: {
    test: (id, target) => ipcRenderer.invoke("proxy:test", id, target),
    testMany: (ids, target) => ipcRenderer.invoke("proxy:test-many", ids, target),
  },
  tasks: {
    start: (id) => ipcRenderer.invoke("task:start", id),
    startMany: (ids) => ipcRenderer.invoke("task:start-many", ids),
    stop: (id) => ipcRenderer.invoke("task:stop", id),
    stopMany: (ids) => ipcRenderer.invoke("task:stop-many", ids),
    review: (id) => ipcRenderer.invoke("task:review", id),
    complete: (id) => ipcRenderer.invoke("task:complete", id),
    decline: (id) => ipcRenderer.invoke("task:decline", id),
    markCarted: (id) => ipcRenderer.invoke("task:carted", id),
    updateSku: (id, sku) => ipcRenderer.invoke("task:update-sku", id, sku),
    applyMonitorSignal: (id) => ipcRenderer.invoke("task:apply-monitor-signal", id),
    refreshQueue: (id) => ipcRenderer.invoke("task:refresh-queue", id),
    onUpdate: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, tasks: Task[]) => listener(tasks);
      ipcRenderer.on("task:update-batch", handler);
      return () => ipcRenderer.removeListener("task:update-batch", handler);
    },
  },
  monitor: {
    connect: (apiUrl) => ipcRenderer.invoke("monitor:connect", apiUrl),
    disconnect: () => ipcRenderer.invoke("monitor:disconnect"),
    refresh: () => ipcRenderer.invoke("monitor:refresh"),
    state: () => ipcRenderer.invoke("monitor:state"),
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: MonitorState) => listener(state);
      ipcRenderer.on("monitor:state", handler);
      return () => ipcRenderer.removeListener("monitor:state", handler);
    },
    onSignal: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, signal: ProductSignal) => listener(signal);
      ipcRenderer.on("monitor:signal", handler);
      return () => ipcRenderer.removeListener("monitor:signal", handler);
    },
  },
  harvesters: {
    open: (id) => ipcRenderer.invoke("harvester:open", id),
    close: (id) => ipcRenderer.invoke("harvester:close", id),
    openAll: () => ipcRenderer.invoke("harvester:open-all"),
    closeAll: () => ipcRenderer.invoke("harvester:close-all"),
    reloadCaptcha: (id) => ipcRenderer.invoke("harvester:reload-captcha", id),
    testCaptcha: (id) => ipcRenderer.invoke("harvester:test-captcha", id),
    markSolved: (id) => ipcRenderer.invoke("harvester:mark-solved", id),
    onUpdate: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, harvester: Harvester) => listener(harvester);
      ipcRenderer.on("harvester:update", handler);
      return () => ipcRenderer.removeListener("harvester:update", handler);
    },
  },
  updates: {
    state: () => ipcRenderer.invoke("update:state"),
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
      ipcRenderer.on("update:state", handler);
      return () => ipcRenderer.removeListener("update:state", handler);
    },
  },
};

contextBridge.exposeInMainWorld("brava", api);
