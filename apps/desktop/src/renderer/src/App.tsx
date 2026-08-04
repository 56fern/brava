import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { Activity, BarChart3, Box, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, DollarSign, Download, Eye, EyeOff, ExternalLink, Gauge, KeyRound, Maximize2, Minimize2, Minus, Moon, Pencil, Play, Plus, Radio, RotateCcw, Server, Settings, ShieldCheck, ShoppingCart, Square, Sun, Trash2, UserRound, X, XCircle } from "lucide-react";
import type { AppData, Harvester, LicenseSession, MonitorState, Profile, ProxyConfig, ProxyTestResult, ProxyTestTarget, ResourceGroup, SiteId, Task, TaskGroup, TaskStatus, UpdateState, WebhookSettings } from "../../shared/types";
import { validateAppData } from "../../shared/backup";
import { ProfileCsvError, parseProfilesCsv } from "../../shared/profile-csv";
import { createTaskBatch } from "../../shared/task-builder";
import { normalizeCartQuantity } from "../../shared/cart-quantity";
import { getVirtualRange } from "../../shared/virtual-window";
import { harvesterProxyLabel, parseHarvesterProxy } from "../../shared/harvester-proxy";
import bravaLogoUrl from "./assets/brava-logo-v2.png";
import bravaLogoLightUrl from "./assets/brava-logo-light.png";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4310";
const ORDER_STATUS_URL = "https://www.pokemoncenter.com/orders";
const emptyData: AppData = { profileGroups: [], proxyGroups: [], profiles: [], proxies: [], taskGroups: [], tasks: [], harvesters: [] };
type Page = "dashboard" | "tasks" | "profiles" | "proxies" | "challenges" | "settings";
type Theme = "dark" | "light";

function BrandLogo({ large = false }: { large?: boolean }) {
  return <span className={`brand-logo ${large ? "large" : ""}`}><img className="logo-on-dark" src={bravaLogoUrl} alt="Brava" /><img className="logo-on-light" src={bravaLogoLightUrl} alt="" aria-hidden="true" /></span>;
}

function WindowControls({ theme, onTheme, privacyBlur, onPrivacyBlur, allowMaximize = false }: { theme: Theme; onTheme: (theme: Theme) => void; privacyBlur: boolean; onPrivacyBlur: (blurred: boolean) => void; allowMaximize?: boolean }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    void window.brava.windowControls.isMaximized().then(setMaximized);
    return window.brava.windowControls.onMaximized(setMaximized);
  }, []);
  const toggleMaximize = async () => setMaximized(await window.brava.windowControls.toggleMaximize());
  return <div className={`window-controls ${maximized ? "is-maximized" : ""}`} aria-label="Window controls">
    <button type="button" className="window-theme-toggle" title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => onTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={12} strokeWidth={1.8} /> : <Moon size={12} strokeWidth={1.8} />}</button>
    <button type="button" className={`window-privacy-toggle ${privacyBlur ? "active" : ""}`} title={privacyBlur ? "Show order and profile details" : "Blur order and profile details"} aria-label={privacyBlur ? "Show order and profile details" : "Blur order and profile details"} aria-pressed={privacyBlur} onClick={() => onPrivacyBlur(!privacyBlur)}>{privacyBlur ? <EyeOff size={12} strokeWidth={1.8} /> : <Eye size={12} strokeWidth={1.8} />}</button>
    <button type="button" title="Minimize" aria-label="Minimize" onClick={() => void window.brava.windowControls.minimize()}><Minus size={13} strokeWidth={1.8} /></button>
    <button type="button" title={maximized ? "Restore" : "Maximize"} aria-label={maximized ? "Restore" : "Maximize"} disabled={!allowMaximize} onClick={() => void toggleMaximize()}>{maximized ? <Minimize2 size={11} strokeWidth={1.8} /> : <Maximize2 size={11} strokeWidth={1.8} />}</button>
    <button type="button" className="window-close" title="Close" aria-label="Close" onClick={() => void window.brava.windowControls.close()}><X size={13} strokeWidth={1.8} /></button>
  </div>;
}

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem("brava-theme") === "light" ? "light" : "dark");
  const [privacyBlur, setPrivacyBlur] = useState(() => localStorage.getItem("brava-analytics-privacy") === "blurred");
  const [data, setData] = useState<AppData>(emptyData);
  const [session, setSession] = useState<LicenseSession | null>(null);
  const [monitor, setMonitor] = useState<MonitorState>({ status: "disconnected", message: "Monitor is disconnected.", sourceCount: 0, healthySources: 0, signalCount: 0, latestSequence: 0 });
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [resumed, loaded] = await Promise.all([window.brava.license.resume(API_URL), window.brava.data.load()]);
        setData(loaded);
        if (resumed) setSession(resumed);
      } catch { /* The activation view shows a useful retry state. */ }
      finally { setBooting(false); }
    })();
    const stopTaskUpdates = window.brava.tasks.onUpdate((updates) => setData((current) => {
      const changed = new Map(updates.map((task) => [task.id, task]));
      return { ...current, tasks: current.tasks.map((task) => changed.get(task.id) ?? task) };
    }));
    const stopHarvesterUpdates = window.brava.harvesters.onUpdate((updated) => setData((current) => ({ ...current, harvesters: current.harvesters.map((harvester) => harvester.id === updated.id ? updated : harvester) })));
    const stopMonitorUpdates = window.brava.monitor.onState(setMonitor);
    return () => { stopTaskUpdates(); stopHarvesterUpdates(); stopMonitorUpdates(); };
  }, []);

  useEffect(() => {
    if (!session) return;
    void window.brava.monitor.connect(API_URL).then(setMonitor);
    const timer = window.setInterval(() => { void window.brava.license.heartbeat(API_URL).then((valid) => { if (!valid) setSession(null); }); }, 5 * 60_000);
    return () => { window.clearInterval(timer); void window.brava.monitor.disconnect(); };
  }, [session]);

  useEffect(() => {
    if (booting) return;
    void window.brava.windowControls.setMode(session ? "workspace" : "activation");
  }, [booting, session]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("brava-theme", theme);
  }, [theme]);

  useEffect(() => { localStorage.setItem("brava-analytics-privacy", privacyBlur ? "blurred" : "visible"); }, [privacyBlur]);

  const save = async (next: AppData) => { setData(next); await window.brava.data.save(next); };
  if (booting) return <><WindowControls theme={theme} onTheme={setTheme} privacyBlur={privacyBlur} onPrivacyBlur={setPrivacyBlur} /><Splash /></>;
  if (!session) return <><WindowControls theme={theme} onTheme={setTheme} privacyBlur={privacyBlur} onPrivacyBlur={setPrivacyBlur} /><Activation onActivated={setSession} /></>;

  return <div className="shell">
    <div className="window-drag-region" aria-hidden="true" />
    <WindowControls theme={theme} onTheme={setTheme} privacyBlur={privacyBlur} onPrivacyBlur={setPrivacyBlur} allowMaximize />
    <TopNavigation page={page} onPage={setPage} session={session} monitor={monitor} />
    <main>
      <div className="content"><div className={`page-stage page-${page}`} key={page}>
        {page === "dashboard" && <Dashboard data={data} onPage={setPage} monitor={monitor} privacyBlur={privacyBlur} />}
        {page === "tasks" && <Tasks data={data} save={save} />}
        {page === "profiles" && <Profiles data={data} save={save} />}
        {page === "proxies" && <Proxies data={data} save={save} />}
        {page === "challenges" && <ChallengeCenter data={data} save={save} />}
        {page === "settings" && <SettingsWorkspace session={session} data={data} save={save} monitor={monitor} onDeactivated={() => setSession(null)} />}
      </div></div>
    </main>
  </div>;
}

function Splash() { return <div className="center-screen"><BrandLogo large /><p>Opening Brava…</p></div>; }

function Activation({ onActivated }: { onActivated: (session: LicenseSession) => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { onActivated(await window.brava.license.activate(key, API_URL)); }
    catch (cause) { const message = cause instanceof Error ? cause.message : "Activation failed"; setError(message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "")); }
    finally { setBusy(false); }
  };
  return <div className="activation-screen">
    <div className="activation-drag-region" aria-hidden="true" />
    <section className="activation-card">
      <div className="brand-row"><BrandLogo /><div><b>Brava</b></div></div>
      <div className="activation-copy"><h1>Access key</h1></div>
      <form onSubmit={submit}><label>License key</label><div className="key-input"><KeyRound size={18} /><input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="BRVA-XXXXX-XXXXX-XXXXX-XXXXX" autoFocus /></div>{error && <p className="form-error">{error}</p>}<button className="primary wide" disabled={busy || key.length < 12}>{busy ? "Activating…" : "Activate device"}<ChevronRight size={18} /></button></form>
    </section>
  </div>;
}

const navigation: { id: Page; label: string; icon: typeof Gauge }[] = [
  { id: "dashboard", label: "Analytics", icon: BarChart3 }, { id: "tasks", label: "Tasks", icon: Activity },
  { id: "profiles", label: "Profiles", icon: UserRound }, { id: "proxies", label: "Proxies", icon: Server },
  { id: "challenges", label: "Challenges", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

function TopNavigation({ page, onPage, session, monitor }: { page: Page; onPage: (page: Page) => void; session: LicenseSession; monitor: MonitorState }) {
  return <header className="top-nav"><div className="brand-row"><BrandLogo /><div><b>Brava</b></div></div><nav>{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? "active" : ""} onClick={() => onPage(id)}><Icon size={17} /><span>{label}</span></button>)}</nav><div className="nav-right"><div className={`license-pill monitor-${monitor.status}`} title={`${session.label} · ${monitor.message}`}><span className="live-dot" />{monitor.status === "healthy" ? "Live" : monitor.status === "idle" ? "Ready" : "Offline"}</div></div></header>;
}

function Dashboard({ data, onPage, privacyBlur }: { data: AppData; onPage: (page: Page) => void; monitor: MonitorState; privacyBlur: boolean }) {
  const [checkoutRange, setCheckoutRange] = useState<"all" | "week" | "day">("all");
  const [showCheckoutProfiles, setShowCheckoutProfiles] = useState(() => localStorage.getItem("brava-analytics-profiles") === "shown");
  useEffect(() => { localStorage.setItem("brava-analytics-profiles", showCheckoutProfiles ? "shown" : "hidden"); }, [showCheckoutProfiles]);
  const completed = data.tasks.filter((task) => task.status === "completed").length;
  const declines = data.tasks.filter((task) => task.status === "declined").length;
  const totalSpent = data.tasks.filter((task) => task.status === "completed").reduce((total, task) => total + (task.checkoutAmount ?? 0), 0);
  const rangeMilliseconds = checkoutRange === "day" ? 24 * 60 * 60_000 : checkoutRange === "week" ? 7 * 24 * 60 * 60_000 : Infinity;
  const previousCheckouts = data.tasks.filter((task) => task.status === "completed" && Date.now() - new Date(task.updatedAt).getTime() <= rangeMilliseconds).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return <><div className="analytics-heading"><div><h1>Overview</h1></div><button className="primary" onClick={() => onPage("tasks")}><Plus size={16} />Create task</button></div>
    <div className="analytics-layout">
      <aside className="analytics-summary">
        <AnalyticsCard tone="blue" icon={<DollarSign />} label="Total spent" value={totalSpent.toLocaleString(undefined, { style: "currency", currency: "USD" })} />
        <div className="split-cards"><AnalyticsCard tone="violet" icon={<CheckCircle2 />} label="Total checkouts" value={completed} /><AnalyticsCard tone="coral" icon={<XCircle />} label="Total declines" value={declines} /></div>
        <section className="panel site-panel"><div className="panel-head"><div><h2>Sites</h2></div></div><div className="site-stat-row"><div className="site-orb" role="img" aria-label="Poké Ball" /><div><b>Pokémon Center</b></div><Stat label="Checkouts" value={completed} /><Stat label="Spent" value={totalSpent.toLocaleString(undefined, { style: "currency", currency: "USD" })} /></div></section>
      </aside>
      <section className="panel activity-panel"><div className="panel-head activity-head"><div><h2>Checkouts</h2></div><div className="checkout-controls"><button type="button" className={`profile-visibility-toggle ${showCheckoutProfiles ? "active" : ""}`} aria-pressed={showCheckoutProfiles} title={showCheckoutProfiles ? "Hide checkout profiles" : "Show checkout profiles"} onClick={() => setShowCheckoutProfiles((current) => !current)}>{showCheckoutProfiles ? <Eye size={13} /> : <EyeOff size={13} />}Profiles</button><div className="filter-pills"><button className={checkoutRange === "all" ? "active" : ""} onClick={() => setCheckoutRange("all")}>All</button><button className={checkoutRange === "week" ? "active" : ""} onClick={() => setCheckoutRange("week")}>Week</button><button className={checkoutRange === "day" ? "active" : ""} onClick={() => setCheckoutRange("day")}>Day</button></div></div></div>
        <div className={`activity-columns ${showCheckoutProfiles ? "show-profiles" : ""}`}><span>Item</span><span>Site</span><span>Variant</span>{showCheckoutProfiles && <span>Profile</span>}<span>Order</span></div>
        {previousCheckouts.length ? <div className="analytics-task-list">{previousCheckouts.slice(0, 12).map((task) => <AnalyticsCheckoutRow key={task.id} task={task} profile={data.profiles.find((profile) => profile.id === task.profileId)} showProfile={showCheckoutProfiles} privacyBlur={privacyBlur} />)}</div> : <Empty icon={<ShoppingCart />} title="No checkouts" />}
      </section>
    </div>
  </>;
}

function AnalyticsCard({ tone, icon, label, value, detail }: { tone: "blue" | "violet" | "coral"; icon: ReactNode; label: string; value: ReactNode; detail?: string }) { return <article className={`analytics-card ${tone}`}><div className="analytics-card-icon">{icon}</div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>; }
function Stat({ label, value }: { label: string; value: ReactNode }) { return <div className="mini-stat"><span>{label}</span><b>{value}</b></div>; }
function MonitorStrip({ monitor, compact = false }: { monitor: MonitorState; compact?: boolean }) {
  const live = monitor.status === "healthy";
  return <section className={`monitor-strip ${compact ? "compact" : ""} ${monitor.status}`}><div className="monitor-orb"><Server size={16} /></div><div><b>Monitor</b><small>{live ? "Live" : monitor.status === "idle" ? "Ready" : monitor.status === "connecting" ? "Connecting" : "Offline"}</small></div><div className="monitor-strip-stats"><span><b>{monitor.healthySources}/{monitor.sourceCount}</b>Sources</span><span><b>{monitor.signalCount}</b>Signals</span>{monitor.latestSignal && <span className="latest-signal"><b>{monitor.latestSignal.sku}</b>{monitor.latestSignal.name}</span>}</div><button className="ghost icon-only" aria-label="Refresh monitor" title="Refresh" disabled={monitor.status === "connecting"} onClick={() => void window.brava.monitor.refresh()}><RotateCcw size={13} /></button></section>;
}
function AnalyticsCheckoutRow({ task, profile, showProfile, privacyBlur }: { task: Task; profile?: Profile; showProfile: boolean; privacyBlur: boolean }) {
  return <div className={`analytics-task-row checkout-row ${showProfile ? "show-profiles" : ""}`}><div><span className="task-dot completed" /><b>{task.name}</b><small>{task.sku || "Pokémon Center item"}</small></div><span>Pokémon Center</span><span>{task.variant || "Any"}</span>{showProfile && <span className={privacyBlur ? "sensitive-blur" : ""}>{profile?.name || "Unassigned"}</span>}{task.orderNumber ? <div className="order-status-cell"><a className="order-status-link" href={ORDER_STATUS_URL} title="Open Pokémon Center order status" onClick={(event) => { event.preventDefault(); void window.brava.external.openOrderStatus(); }}><span className={privacyBlur ? "sensitive-blur" : ""}>{task.orderNumber}</span><ExternalLink size={11} /></a><small className={privacyBlur ? "sensitive-blur" : ""}>ZIP {profile?.postalCode || "N/A"}</small></div> : <span>Confirmed</span>}</div>;
}

function Metric({ label, value, icon, accent = false }: { label: string; value: number; icon: ReactNode; accent?: boolean }) { return <div className={`metric ${accent ? "accent" : ""}`}><div className="metric-icon">{icon}</div><span>{label}</span><strong>{String(value).padStart(2, "0")}</strong></div>; }
function Title({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) { return <div className="title-row"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }

type TaskSelectionContextValue = {
  selectedTaskIds: string[];
  selectedTasks: Task[];
  selectTask: (taskId: string, shiftKey: boolean, additive: boolean) => void;
  openTaskMenu: (taskId: string, x: number, y: number) => void;
  duplicateTasks: (tasks: Task[]) => void;
  restartTasks: (tasks: Task[]) => Promise<void>;
  copyProfileEmails: (tasks: Task[]) => Promise<void>;
  removeTasks: (tasks: Task[]) => void;
};

const TaskSelectionContext = createContext<TaskSelectionContextValue | null>(null);

type ContextPoint = { x: number; y: number };

function ContextMenuSurface({ x, y, label, eyebrow, title, onClose, children }: { x: number; y: number; label: string; eyebrow?: string; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const dismiss = (event: MouseEvent) => { if (!(event.target as Element | null)?.closest?.(".task-context-menu")) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("mousedown", dismiss);
    window.addEventListener("blur", onClose);
    window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", dismiss); window.removeEventListener("blur", onClose); window.removeEventListener("keydown", escape); };
  }, [onClose]);
  const left = Math.max(8, Math.min(x, window.innerWidth - 232));
  const top = Math.max(8, Math.min(y, window.innerHeight - 390));
  return createPortal(<div className="task-context-menu" style={{ left, top }} role="menu" aria-label={label} onContextMenu={(event) => event.preventDefault()}>
    <div className="task-context-head"><span>{eyebrow ?? "1 selected"}</span><b>{title}</b></div>{children}
  </div>, document.body);
}

function MenuButton({ icon, children, danger = false, disabled = false, title, onClick }: { icon: ReactNode; children: ReactNode; danger?: boolean; disabled?: boolean; title?: string; onClick: () => void }) {
  return <button className={danger ? "danger" : ""} disabled={disabled} title={title} onClick={onClick}>{icon}<span>{children}</span></button>;
}

function MenuSeparator() { return <div className="task-context-separator" />; }

function Tasks({ data, save }: { data: AppData; save: (data: AppData) => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(data.taskGroups[0]?.id ?? "");
  const [filter, setFilter] = useState<"all" | "carted" | "completed" | "declined">("all");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const [groupContext, setGroupContext] = useState<(ContextPoint & { groupId: string }) | null>(null);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [duplicatingGroup, setDuplicatingGroup] = useState<TaskGroup | null>(null);
  const [editingTask, setEditingTask] = useState<{ task: Task; mode: "full" | "product" } | null>(null);
  const [editingAllTasks, setEditingAllTasks] = useState(false);
  const [logTaskId, setLogTaskId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<"tasks" | "group" | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!data.taskGroups.some((group) => group.id === selectedGroupId)) setSelectedGroupId(data.taskGroups[0]?.id ?? ""); }, [data.taskGroups, selectedGroupId]);
  useEffect(() => { setSelectedTaskIds([]); setSelectionAnchorId(null); setContextMenu(null); }, [selectedGroupId, filter]);
  useEffect(() => { setSelectedTaskIds((current) => { const next = current.filter((id) => data.tasks.some((task) => task.id === id)); return next.length === current.length ? current : next; }); }, [data.tasks]);
  const selectedGroup = data.taskGroups.find((group) => group.id === selectedGroupId);
  const groupTasks = selectedGroup ? data.tasks.filter((task) => task.groupId === selectedGroup.id) : [];
  const remove = (id: string) => void save({ ...data, tasks: data.tasks.filter((task) => task.id !== id) });
  const add = (tasks: Task[]) => { if (!selectedGroup) return; void save({ ...data, tasks: [...tasks.map((task) => ({ ...task, groupId: selectedGroup.id })), ...data.tasks] }); setCreating(false); };
  const addGroup = (group: TaskGroup) => { void save({ ...data, taskGroups: [...data.taskGroups, group] }); setSelectedGroupId(group.id); setFilter("all"); setCreatingGroup(false); };
  const startAll = () => void window.brava.tasks.startMany(groupTasks.map((task) => task.id));
  const stopAll = () => void window.brava.tasks.stopMany(groupTasks.map((task) => task.id));
  const counts = { carted: groupTasks.filter((task) => task.status === "carted").length, completed: groupTasks.filter((task) => task.status === "completed").length, declined: groupTasks.filter((task) => task.status === "declined").length };
  const visible = filter === "all" ? groupTasks : groupTasks.filter((task) => task.status === filter);
  const contextTask = contextMenu ? data.tasks.find((task) => task.id === contextMenu.taskId) : undefined;
  const selectedTasks = data.tasks.filter((task) => selectedTaskIds.includes(task.id));
  const logTask = logTaskId ? data.tasks.find((task) => task.id === logTaskId) : undefined;
  const clearSelection = () => { setSelectedTaskIds([]); setSelectionAnchorId(null); setContextMenu(null); };
  const deleteAllTasks = async () => {
    if (!selectedGroup) return;
    await save({ ...data, tasks: data.tasks.filter((task) => task.groupId !== selectedGroup.id) });
    clearSelection();
    setDeleteTarget(null);
  };
  const deleteSelectedGroup = async () => {
    if (!selectedGroup) return;
    const remainingGroups = data.taskGroups.filter((group) => group.id !== selectedGroup.id);
    await save({ ...data, taskGroups: remainingGroups, tasks: data.tasks.filter((task) => task.groupId !== selectedGroup.id) });
    setSelectedGroupId(remainingGroups[0]?.id ?? "");
    clearSelection();
    setDeleteTarget(null);
  };
  const duplicateGroup = async (source: TaskGroup, replacement?: TaskGroup) => {
    const nextGroup = replacement ?? { ...source, id: crypto.randomUUID(), name: `${source.name} copy` };
    const at = new Date().toISOString();
    const copies = data.tasks.filter((task) => task.groupId === source.id).map((task) => ({ ...task, id: crypto.randomUUID(), groupId: nextGroup.id, status: "idle" as const, statusMessage: "Duplicated - ready to start", updatedAt: at, history: [{ status: "idle" as const, message: `Duplicated from ${source.name}`, at }] }));
    await save({ ...data, taskGroups: [...data.taskGroups, nextGroup], tasks: [...copies, ...data.tasks] });
    setSelectedGroupId(nextGroup.id);
    setDuplicatingGroup(null);
  };
  const updateGroupName = async (value: ResourceGroup) => {
    if (!editingGroup) return;
    await save({ ...data, taskGroups: data.taskGroups.map((group) => group.id === editingGroup.id ? { ...group, name: value.name } : group) });
    setEditingGroup(null);
  };
  const restartAll = async (tasks: Task[]) => {
    const ids = tasks.map((task) => task.id);
    await window.brava.tasks.stopMany(ids);
    await window.brava.tasks.startMany(ids);
  };
  const selectTask = (taskId: string, shiftKey: boolean, additive: boolean) => {
    if (shiftKey && selectionAnchorId) {
      const anchorIndex = visible.findIndex((task) => task.id === selectionAnchorId);
      const targetIndex = visible.findIndex((task) => task.id === taskId);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const first = Math.min(anchorIndex, targetIndex);
        const last = Math.max(anchorIndex, targetIndex);
        setSelectedTaskIds(visible.slice(first, last + 1).map((task) => task.id));
        setContextMenu(null);
        return;
      }
    }
    if (additive) {
      setSelectedTaskIds((current) => current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]);
      setSelectionAnchorId(taskId);
    } else {
      setSelectedTaskIds([taskId]);
      setSelectionAnchorId(taskId);
    }
    setContextMenu(null);
  };
  const openTaskMenu = (taskId: string, x: number, y: number) => {
    if (!selectedTaskIds.includes(taskId)) {
      setSelectedTaskIds([taskId]);
      setSelectionAnchorId(taskId);
    }
    setContextMenu({ taskId, x, y });
  };
  const updateTask = (updated: Task) => {
    void save({ ...data, tasks: data.tasks.map((task) => task.id === updated.id ? updated : task) });
    setEditingTask(null);
  };
  const updateAllTasks = (template: Task) => {
    if (!selectedGroup) return;
    const at = new Date().toISOString();
    const common: Partial<Task> = {
      name: template.name,
      productUrl: template.productUrl,
      sku: template.sku,
      usePlaceholder: template.usePlaceholder,
      monitorKeywords: template.monitorKeywords,
      autoApplyMonitorSignal: template.autoApplyMonitorSignal,
      variant: template.variant,
      quantity: template.quantity,
      effectiveQuantity: template.effectiveQuantity,
      maxCartQuantity: template.maxCartQuantity,
      profileId: template.profileId,
      proxyId: template.proxyId,
      proxyPoolIds: template.proxyPoolIds,
      waitForQueue: template.waitForQueue,
      queueCheckIntervalMinutes: template.queueCheckIntervalMinutes,
      loopProfiles: template.loopProfiles,
      offerProfileFallback: template.offerProfileFallback,
    };
    const tasks = data.tasks.map((task) => task.groupId === selectedGroup.id
      ? { ...task, ...common, updatedAt: at, history: [...(task.history ?? []), { status: task.status, message: "Task settings updated with Edit all", at }].slice(-30) }
      : task);
    void save({ ...data, tasks });
    setEditingAllTasks(false);
  };
  const duplicateTask = (task: Task) => {
    const at = new Date().toISOString();
    const duplicate: Task = { ...task, id: crypto.randomUUID(), name: `${task.name} copy`, status: "idle", statusMessage: "Duplicated Â· ready to start", updatedAt: at, history: [{ status: "idle", message: `Duplicated from ${task.name}`, at }] };
    void save({ ...data, tasks: [duplicate, ...data.tasks] });
  };
  const restartTask = async (task: Task) => {
    await window.brava.tasks.stop(task.id);
    await window.brava.tasks.start(task.id);
  };
  const copyProfileEmail = async (task: Task) => {
    const email = data.profiles.find((profile) => profile.id === task.profileId)?.email;
    if (email) await window.brava.clipboard.writeText(email);
  };
  const removeTasks = (tasks: Task[]) => {
    const ids = new Set(tasks.map((task) => task.id));
    void save({ ...data, tasks: data.tasks.filter((task) => !ids.has(task.id)) });
    clearSelection();
  };
  const duplicateSelectedTasks = (tasks: Task[]) => {
    const at = new Date().toISOString();
    const duplicates: Task[] = tasks.map((task) => ({ ...task, id: crypto.randomUUID(), name: `${task.name} copy`, status: "idle", statusMessage: "Duplicated - ready to start", updatedAt: at, history: [{ status: "idle", message: `Duplicated from ${task.name}`, at }] }));
    void save({ ...data, tasks: [...duplicates, ...data.tasks] });
  };
  const restartSelectedTasks = async (tasks: Task[]) => {
    await Promise.all(tasks.map(async (task) => { await window.brava.tasks.stop(task.id); await window.brava.tasks.start(task.id); }));
  };
  const copySelectedProfileEmails = async (tasks: Task[]) => {
    const emails = [...new Set(tasks.map((task) => data.profiles.find((profile) => profile.id === task.profileId)?.email).filter((email): email is string => Boolean(email)))];
    if (emails.length) await window.brava.clipboard.writeText(emails.join("\n"));
  };
  const useNext = (task: Task, field: "profileId" | "proxyId", options: { id: string; name: string }[]) => {
    const available = field === "proxyId" && task.proxyPoolIds?.length ? options.filter((item) => task.proxyPoolIds!.includes(item.id)) : options;
    if (available.length < 2) return;
    const current = available.findIndex((item) => item.id === task[field]);
    const next = available[(current + 1 + available.length) % available.length]!;
    const updatedAt = new Date().toISOString();
    const label = field === "profileId" ? "profile" : "route";
    const event = { status: "idle" as const, message: `Changed ${label} to ${next.name}`, at: updatedAt };
    const updated: Task = { ...task, [field]: next.id, status: "idle", statusMessage: `${next.name} selected manually · ready to retry`, updatedAt, history: [...(task.history ?? []), event].slice(-30) };
    void save({ ...data, tasks: data.tasks.map((item) => item.id === task.id ? updated : item) });
  };
  return <TaskSelectionContext.Provider value={{ selectedTaskIds, selectedTasks, selectTask, openTaskMenu, duplicateTasks: duplicateSelectedTasks, restartTasks: restartSelectedTasks, copyProfileEmails: copySelectedProfileEmails, removeTasks }}><div className="manager-shell">
    <TaskSidebar groups={data.taskGroups} tasks={data.tasks} selectedGroupId={selectedGroupId} counts={counts} filter={filter} onFilter={setFilter} onSelect={(id) => { setSelectedGroupId(id); setFilter("all"); }} onCreateGroup={() => setCreatingGroup(true)} onDeleteGroup={() => setDeleteTarget("group")} onContextGroup={(groupId, x, y) => { setSelectedGroupId(groupId); setFilter("all"); setGroupContext({ groupId, x, y }); }} />
    <section className="manager-main"><ManagerHeader title={selectedGroup?.name ?? "Task groups"} count={selectedGroup ? `${visible.length} of ${groupTasks.length} tasks · ${siteLabel(selectedGroup.site)}` : "Create a site group to begin"} site={selectedGroup?.site} onAdd={selectedGroup ? () => setCreating(true) : undefined} actions={selectedGroup ? <><button className="manager-action" disabled={!groupTasks.length} onClick={() => setEditingAllTasks(true)}><Pencil size={14} />Edit all</button><button className="manager-action play" onClick={startAll}><Play size={15} />Start all</button><button className="manager-action" onClick={stopAll}><Square size={14} />Stop all</button><button className="manager-action danger" disabled={!groupTasks.length} onClick={() => setDeleteTarget("tasks")}><Trash2 size={14} />Delete all</button></> : <button className="manager-action play" onClick={() => setCreatingGroup(true)}><Plus size={15} />Create group</button>} />
      {selectedGroup && <div className="manager-columns task-columns"><span>Mode</span><span>Item/s</span><span>Profile</span><span>Proxy</span><span>Wait for queue</span><span>Loop profiles</span><span>Status</span><span>Actions</span></div>}
      {visible.length ? <VirtualTaskRows tasks={visible} profileGroups={data.profileGroups} proxyGroups={data.proxyGroups} profiles={data.profiles} proxies={data.proxies} now={now} contextTaskId={contextMenu?.taskId} onOpenMenu={(taskId, x, y) => setContextMenu({ taskId, x, y })} onDelete={remove} onNextProfile={(task) => useNext(task, "profileId", data.profiles)} onNextProxy={(task) => useNext(task, "proxyId", data.proxies)} /> : <div className="manager-rows"><Empty icon={<Activity />} title={!selectedGroup ? "No group" : filter === "all" ? "No tasks" : `No ${filter.replace("completed", "checkouts")}`} action={!selectedGroup ? "Create group" : filter === "all" ? "Create task" : "Show all"} onAction={() => !selectedGroup ? setCreatingGroup(true) : filter === "all" ? setCreating(true) : setFilter("all")} /></div>}
    </section>
    {creating && selectedGroup && <TaskForm profileGroups={data.profileGroups} profiles={data.profiles} proxyGroups={data.proxyGroups} proxies={data.proxies} onCancel={() => setCreating(false)} onSave={add} />}
    {creatingGroup && <TaskGroupForm onCancel={() => setCreatingGroup(false)} onSave={addGroup} />}
    {contextMenu && contextTask && <TaskContextMenu task={contextTask} profileEmail={data.profiles.find((profile) => profile.id === contextTask.profileId)?.email} x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} onStart={() => void window.brava.tasks.start(contextTask.id)} onStop={() => void window.brava.tasks.stop(contextTask.id)} onRestart={() => void restartTask(contextTask)} onDuplicate={() => duplicateTask(contextTask)} onCopyProfileEmail={() => void copyProfileEmail(contextTask)} onEdit={() => setEditingTask({ task: contextTask, mode: "full" })} onManageProduct={() => setEditingTask({ task: contextTask, mode: "product" })} onViewLogs={() => setLogTaskId(contextTask.id)} onDelete={() => remove(contextTask.id)} />}
    {groupContext && selectedGroup && <ContextMenuSurface x={groupContext.x} y={groupContext.y} label={`Actions for task group ${selectedGroup.name}`} eyebrow="Task group" title={selectedGroup.name} onClose={() => setGroupContext(null)}>
      <MenuButton icon={<Play size={14} />} disabled={!groupTasks.length} onClick={() => { startAll(); setGroupContext(null); }}>Start all</MenuButton>
      <MenuButton icon={<Square size={13} />} disabled={!groupTasks.length} onClick={() => { stopAll(); setGroupContext(null); }}>Stop all</MenuButton>
      <MenuButton icon={<RotateCcw size={14} />} disabled={!groupTasks.length} onClick={() => { void restartAll(groupTasks); setGroupContext(null); }}>Restart all</MenuButton>
      <MenuSeparator />
      <MenuButton icon={<Pencil size={14} />} onClick={() => { setEditingGroup(selectedGroup); setGroupContext(null); }}>Edit group</MenuButton>
      <MenuButton icon={<Copy size={14} />} onClick={() => { void duplicateGroup(selectedGroup); setGroupContext(null); }}>Duplicate</MenuButton>
      <MenuButton icon={<Box size={14} />} onClick={() => { setDuplicatingGroup(selectedGroup); setGroupContext(null); }}>Duplicate with site</MenuButton>
      <MenuSeparator />
      <MenuButton icon={<Trash2 size={14} />} danger disabled={!groupTasks.length} onClick={() => { setDeleteTarget("tasks"); setGroupContext(null); }}>Delete all tasks</MenuButton>
      <MenuButton icon={<Trash2 size={14} />} danger onClick={() => { setDeleteTarget("group"); setGroupContext(null); }}>Delete group</MenuButton>
    </ContextMenuSurface>}
    {editingGroup && <GroupNameForm title="Edit task group" initialName={editingGroup.name} onCancel={() => setEditingGroup(null)} onSave={(group) => void updateGroupName(group)} />}
    {duplicatingGroup && <TaskGroupForm initialName={`${duplicatingGroup.name} copy`} initialSite={duplicatingGroup.site} onCancel={() => setDuplicatingGroup(null)} onSave={(group) => void duplicateGroup(duplicatingGroup, group)} />}
    {editingTask && <TaskEditModal task={editingTask.task} mode={editingTask.mode} profiles={data.profiles} proxies={data.proxies} onCancel={() => setEditingTask(null)} onSave={updateTask} />}
    {editingAllTasks && groupTasks[0] && <TaskEditModal task={groupTasks[0]} mode="full" profiles={data.profiles} proxies={data.proxies} bulkCount={groupTasks.length} onCancel={() => setEditingAllTasks(false)} onSave={updateAllTasks} />}
    {logTask && <TaskLogsModal task={logTask} onClose={() => setLogTaskId(null)} />}
    {deleteTarget === "tasks" && selectedGroup && <DeleteConfirmModal title={`Delete all ${groupTasks.length} tasks?`} body={`This removes every task in ${selectedGroup.name}. The task group will remain.`} confirmLabel="Delete all tasks" onCancel={() => setDeleteTarget(null)} onConfirm={deleteAllTasks} />}
    {deleteTarget === "group" && selectedGroup && <DeleteConfirmModal title={`Delete ${selectedGroup.name}?`} body={`This removes the task group and all ${groupTasks.length} tasks inside it.`} confirmLabel="Delete group" onCancel={() => setDeleteTarget(null)} onConfirm={deleteSelectedGroup} />}
  </div></TaskSelectionContext.Provider>;
}

const taskRowHeight = 72;
const taskRowOverscan = 8;

function VirtualTaskRows({ tasks, profileGroups, proxyGroups, profiles, proxies, now, contextTaskId, onOpenMenu, onDelete, onNextProfile, onNextProxy }: { tasks: Task[]; profileGroups: ResourceGroup[]; proxyGroups: ResourceGroup[]; profiles: Profile[]; proxies: ProxyConfig[]; now: number; contextTaskId?: string; onOpenMenu: (taskId: string, x: number, y: number) => void; onDelete: (taskId: string) => void; onNextProfile: (task: Task) => void; onNextProxy: (task: Task) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight || 600);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setScrollTop(0); if (viewport.current) viewport.current.scrollTop = 0; }, [tasks[0]?.groupId]);
  const range = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / taskRowHeight) - taskRowOverscan);
    const end = Math.min(tasks.length, Math.ceil((scrollTop + viewportHeight) / taskRowHeight) + taskRowOverscan);
    return { start, end, visible: tasks.slice(start, end) };
  }, [scrollTop, tasks, viewportHeight]);
  const onScroll = (event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop);
  return <div ref={viewport} className="manager-rows virtual-task-rows" onScroll={onScroll} data-total-rows={tasks.length} data-rendered-rows={range.visible.length}>
    <div className="virtual-task-spacer" style={{ height: tasks.length * taskRowHeight }}>
      <div className="virtual-task-window" style={{ transform: `translateY(${range.start * taskRowHeight}px)` }}>
        {range.visible.map((task) => <TaskTableRow key={task.id} task={task} profileGroups={profileGroups} proxyGroups={proxyGroups} profiles={profiles} proxies={proxies} now={now} selected={contextTaskId === task.id} onContextMenu={(x, y) => onOpenMenu(task.id, x, y)} onDelete={() => onDelete(task.id)} onNextProfile={() => onNextProfile(task)} onNextProxy={() => onNextProxy(task)} />)}
      </div>
    </div>
  </div>;
}

function TaskSidebar({ groups, tasks, selectedGroupId, counts, filter, onFilter, onSelect, onCreateGroup, onDeleteGroup, onContextGroup }: { groups: TaskGroup[]; tasks: Task[]; selectedGroupId: string; counts: { carted: number; completed: number; declined: number }; filter: "all" | "carted" | "completed" | "declined"; onFilter: (filter: "all" | "carted" | "completed" | "declined") => void; onSelect: (id: string) => void; onCreateGroup: () => void; onDeleteGroup: () => void; onContextGroup: (id: string, x: number, y: number) => void }) {
  useEffect(() => {
    const open = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest?.(".task-group-button");
      if (!button) return;
      const buttons = [...document.querySelectorAll(".task-group-list .task-group-button")];
      const group = groups[buttons.indexOf(button)];
      if (!group) return;
      event.preventDefault();
      onContextGroup(group.id, event.clientX, event.clientY);
    };
    document.addEventListener("contextmenu", open);
    return () => document.removeEventListener("contextmenu", open);
  }, [groups, onContextGroup]);
  return <aside className="manager-sidebar task-group-sidebar"><div className="manager-side-title"><div><h2>Task groups</h2><span>{groups.length} total</span></div><button aria-label="Create task group" title="Create task group" onClick={onCreateGroup}><Plus size={16} /></button></div><div className="task-group-list">{groups.map((group) => { const total = tasks.filter((task) => task.groupId === group.id).length; const active = selectedGroupId === group.id; return <div key={group.id} className={`group-card group-card-with-delete ${active ? "active" : ""}`}><button className="group-card-select task-group-button" onClick={() => onSelect(group.id)}><SiteMark site={group.site} tiny /><span><b>{group.name}</b><small>{siteLabel(group.site)} · {total} tasks</small></span></button>{active && <button className="group-card-delete" aria-label={`Delete task group ${group.name}`} title="Delete task group" onClick={onDeleteGroup}><Trash2 size={13} /></button>}</div>; })}</div>{selectedGroupId && <div className="task-filter-strip"><button className={filter === "carted" ? "active carted" : ""} aria-label={`Show carted tasks (${counts.carted})`} title="Show carted tasks" onClick={() => onFilter(filter === "carted" ? "all" : "carted")}><ShoppingCart size={13} /><b>{counts.carted}</b></button><button className={filter === "completed" ? "active completed" : ""} aria-label={`Show successful checkouts (${counts.completed})`} title="Show successful checkouts" onClick={() => onFilter(filter === "completed" ? "all" : "completed")}><Check size={14} /><b>{counts.completed}</b></button><button className={filter === "declined" ? "active declined" : ""} aria-label={`Show declined tasks (${counts.declined})`} title="Show declined tasks" onClick={() => onFilter(filter === "declined" ? "all" : "declined")}><X size={14} /><b>{counts.declined}</b></button></div>}</aside>;
}

function siteLabel(site: SiteId): string { return site === "pokemon_center_us" ? "Pokémon Center US" : site; }
function SiteMark({ site, tiny = false }: { site: SiteId; tiny?: boolean }) { return site === "pokemon_center_us" ? <div className={`site-orb ${tiny ? "tiny" : ""}`} role="img" aria-label="Poké Ball" /> : <div className="site-fallback-mark"><Box size={14} /></div>; }

function TaskGroupForm({ onCancel, onSave, initialName = "", initialSite = "" }: { onCancel: () => void; onSave: (group: TaskGroup) => void; initialName?: string; initialSite?: SiteId | "" }) {
  const [name, setName] = useState(initialName);
  const [site, setSite] = useState<SiteId | "">(initialSite);
  const submit = (event: FormEvent) => { event.preventDefault(); if (!site) return; onSave({ id: crypto.randomUUID(), name: name.trim(), site }); };
  return createPortal(<div className="modal-backdrop group-builder-backdrop" onMouseDown={onCancel}><form className="group-builder-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><header><div className="task-builder-icon"><Box size={18} /></div><div><h2>New group</h2></div><button type="button" aria-label="Close group builder" onClick={onCancel}><X size={17} /></button></header><div className="group-builder-body"><label className="task-builder-field"><span>Group name</span><input required autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Pokémon drop" /></label><label className="task-builder-field"><span>Site</span><select required value={site} onChange={(event) => setSite(event.target.value as SiteId | "")}><option value="">Choose a site…</option><option value="pokemon_center_us">Pokémon Center US</option><option disabled>More sites coming later</option></select></label><div className="group-site-preview">{site ? <SiteMark site={site} /> : <div className="site-fallback-mark"><Box size={14} /></div>}<div><b>{site ? siteLabel(site) : "Choose a site"}</b></div></div></div><footer><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button type="submit" className="primary" disabled={!name.trim() || !site}>Create group</button></footer></form></div>, document.body);
}

const taskStatusLabel: Record<TaskStatus, string> = { idle: "Idle", queued: "In queue", monitoring: "Monitoring", found: "Found", adding_to_cart: "Adding to cart", carted: "Carted", awaiting_user: "Needs you", completed: "Checked out", declined: "Declined", stopped: "Stopped", error: "Error" };

function TaskTableRow({ task, profileGroups, proxyGroups, profiles, proxies, now, selected, onContextMenu, onDelete, onNextProfile, onNextProxy }: { task: Task; profileGroups: ResourceGroup[]; proxyGroups: ResourceGroup[]; profiles: Profile[]; proxies: ProxyConfig[]; now: number; selected: boolean; onContextMenu: (x: number, y: number) => void; onDelete: () => void; onNextProfile: () => void; onNextProxy: () => void }) {
  const selection = useContext(TaskSelectionContext);
  const isSelected = selection?.selectedTaskIds.includes(task.id) ?? selected;
  return <div className={`task-row-context-shell ${isSelected ? "context-selected" : ""}`} onClick={(event) => { if ((event.target as Element).closest("button, input, select, a")) return; selection?.selectTask(task.id, event.shiftKey, event.ctrlKey || event.metaKey); }} onContextMenu={(event) => { event.preventDefault(); if (selection) selection.openTaskMenu(task.id, event.clientX, event.clientY); else onContextMenu(event.clientX, event.clientY); }}><TaskTableRowContent task={task} profileGroups={profileGroups} proxyGroups={proxyGroups} profiles={profiles} proxies={proxies} now={now} onDelete={onDelete} onNextProfile={onNextProfile} onNextProxy={onNextProxy} /></div>;
}

function TaskTableRowContent({ task, profileGroups, proxyGroups, profiles, proxies, now, onDelete, onNextProfile, onNextProxy }: { task: Task; profileGroups: ResourceGroup[]; proxyGroups: ResourceGroup[]; profiles: Profile[]; proxies: ProxyConfig[]; now: number; onDelete: () => void; onNextProfile: () => void; onNextProxy: () => void }) {
  const profile = profiles.find((item) => item.id === task.profileId);
  const proxy = proxies.find((item) => item.id === task.proxyId);
  const profileGroup = profileGroups.find((group) => group.id === profile?.groupId)?.name ?? (profile ? "Profiles" : "No profile");
  const proxyGroup = proxyGroups.find((group) => group.id === proxy?.groupId)?.name ?? (proxy ? "Proxies" : "Localhost");
  const idle = ["idle", "stopped", "completed", "declined", "error"].includes(task.status);
  const [editing, setEditing] = useState(false);
  const [sku, setSku] = useState(task.usePlaceholder ? "" : task.sku ?? "");
  const applySku = async () => { await window.brava.tasks.updateSku(task.id, sku); setEditing(false); };
  const queue = queueDisplay(task, now);
  const quantityLabel = task.effectiveQuantity != null && task.effectiveQuantity < task.quantity ? `${task.effectiveQuantity}/${task.quantity}` : String(task.quantity);
  return <div className="manager-row task-columns" title={task.statusMessage}>
    <div className="task-mode-cell"><b>Default</b><small title={task.maxCartQuantity ? `Store limit ${task.maxCartQuantity}` : undefined}>Qty {quantityLabel}</small></div>
    <div className="sku-cell task-product-cell">{editing ? <div className="inline-sku"><input autoFocus value={sku} onChange={(event) => setSku(event.target.value)} placeholder="Enter live SKU" onKeyDown={(event) => { if (event.key === "Enter") void applySku(); if (event.key === "Escape") setEditing(false); }} /><button disabled={!sku.trim()} onClick={() => void applySku()}><Check size={13} /></button></div> : <><b>{task.usePlaceholder ? "PLACEHOLDER" : task.sku || "No SKU"}</b><small>{task.pendingMonitorSignal ? `Match: ${task.pendingMonitorSignal.sku}` : task.productUrl ? task.productUrl.replace(/^https?:\/\//, "").slice(0, 34) : "No product"}</small></>}<button className="sku-edit" title="Edit SKU" onClick={() => setEditing((value) => !value)}><Pencil size={12} /></button></div>
    <div className="task-profile-cell"><b>{profileGroup}</b><small>{profile?.name ?? "Not assigned"}</small></div>
    <div className="task-proxy-cell"><b>{proxyGroup}</b><small>{proxy?.name ?? "No proxy"}</small></div>
    <span className={`task-boolean task-queue-cell ${task.waitForQueue ? "enabled" : ""}`} title={task.waitForQueue ? queue.title : "Queue waiting disabled"}><i />{task.waitForQueue ? "On" : "Off"}</span>
    <span className={`task-boolean task-loop-cell ${task.offerProfileFallback ? "enabled" : ""}`} title="Loop profiles after a checkout decline"><i />{task.offerProfileFallback ? "On" : "Off"}</span>
    <span className={`task-status-cell status ${task.status}`}>{taskStatusLabel[task.status]}{task.status === "queued" && <small>{queue.primary}</small>}</span>
    <div className="table-actions">
      {task.pendingMonitorSignal && <button className="monitor-match-action" title={`Apply monitor match ${task.pendingMonitorSignal.sku}`} onClick={() => void window.brava.tasks.applyMonitorSignal(task.id)}><Radio size={14} /></button>}
      {idle ? <button title="Start" onClick={() => void window.brava.tasks.start(task.id)}><Play size={14} /></button> : <button title="Stop" onClick={() => void window.brava.tasks.stop(task.id)}><Square size={13} /></button>}
      {["awaiting_user", "carted"].includes(task.status) && <button className="review" title="Open in harvester" onClick={() => void window.brava.tasks.review(task.id)}><ExternalLink size={14} /></button>}
      {task.status === "awaiting_user" && <button title="Mark carted" onClick={() => void window.brava.tasks.markCarted(task.id)}><ShoppingCart size={14} /></button>}
      {task.status === "carted" && <button title="Confirm successful checkout" onClick={() => void window.brava.tasks.complete(task.id)}><Check size={14} /></button>}
      {["awaiting_user", "carted"].includes(task.status) && <button title="Mark declined" onClick={() => void window.brava.tasks.decline(task.id)}><X size={14} /></button>}
      {task.status === "declined" && task.offerProfileFallback && profiles.length > 1 && <button title="Select next profile manually" onClick={onNextProfile}><RotateCcw size={14} /></button>}
      <button title="Delete" onClick={onDelete}><Trash2 size={14} /></button>
    </div>
  </div>;
}

function TaskContextMenu({ task, profileEmail, x, y, onClose, onStart, onStop, onRestart, onDuplicate, onCopyProfileEmail, onEdit, onManageProduct, onViewLogs, onDelete }: { task: Task; profileEmail?: string; x: number; y: number; onClose: () => void; onStart: () => void; onStop: () => void; onRestart: () => void; onDuplicate: () => void; onCopyProfileEmail: () => void; onEdit: () => void; onManageProduct: () => void; onViewLogs: () => void; onDelete: () => void }) {
  const selection = useContext(TaskSelectionContext);
  useEffect(() => {
    const dismiss = (event: MouseEvent) => { if (!(event.target as Element | null)?.closest?.(".task-context-menu")) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("mousedown", dismiss);
    window.addEventListener("blur", onClose);
    window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", dismiss); window.removeEventListener("blur", onClose); window.removeEventListener("keydown", escape); };
  }, [onClose]);
  const tasks = selection?.selectedTasks.length ? selection.selectedTasks : [task];
  const count = tasks.length;
  const idleTasks = tasks.filter((item) => ["idle", "stopped", "completed", "declined", "error"].includes(item.status));
  const activeTasks = tasks.filter((item) => !["idle", "stopped", "completed", "declined", "error"].includes(item.status));
  const run = (action: () => void) => { action(); onClose(); };
  const left = Math.max(8, Math.min(x, window.innerWidth - 232));
  const top = Math.max(8, Math.min(y, window.innerHeight - 426));
  const singular = count === 1;
  return createPortal(<div className="task-context-menu" style={{ left, top }} role="menu" aria-label={`Actions for ${count} selected ${count === 1 ? "task" : "tasks"}`} onContextMenu={(event) => event.preventDefault()}><div className="task-context-head"><span>{count} {count === 1 ? "task" : "tasks"} selected</span><b>{singular ? task.name : `${tasks[0]?.name} through ${tasks[tasks.length - 1]?.name}`}</b></div><button disabled={!idleTasks.length} onClick={() => run(() => idleTasks.forEach((item) => void window.brava.tasks.start(item.id)))}><Play size={14} /><span>Start</span></button><button disabled={!activeTasks.length} onClick={() => run(() => activeTasks.forEach((item) => void window.brava.tasks.stop(item.id)))}><Square size={13} /><span>Stop</span></button><button onClick={() => run(() => selection ? void selection.restartTasks(tasks) : onRestart())}><RotateCcw size={14} /><span>Restart {singular ? "task" : "tasks"}</span></button><div className="task-context-separator" /><button onClick={() => run(() => selection ? selection.duplicateTasks(tasks) : onDuplicate())}><Copy size={14} /><span>Duplicate</span></button><button disabled={!tasks.some((item) => Boolean(item.profileId)) && !profileEmail} onClick={() => run(() => selection ? void selection.copyProfileEmails(tasks) : onCopyProfileEmail())}><UserRound size={14} /><span>Copy profile {singular ? "email" : "emails"}</span></button><button disabled={!singular} title={singular ? "Edit task" : "Select one task to edit"} onClick={() => run(onEdit)}><Pencil size={14} /><span>Edit</span></button><button disabled={!singular} title={singular ? "Manage product" : "Select one task to manage its product"} onClick={() => run(onManageProduct)}><Box size={14} /><span>Manage product</span></button><button disabled={!singular} title={singular ? "View task logs" : "Select one task to view its logs"} onClick={() => run(onViewLogs)}><Activity size={14} /><span>View task logs</span></button><div className="task-context-separator" /><button className="danger" onClick={() => run(() => selection ? selection.removeTasks(tasks) : onDelete())}><Trash2 size={14} /><span>Delete</span></button></div>, document.body);
}

function TaskContextMenuLegacy({ task, profileEmail, x, y, onClose, onStart, onStop, onRestart, onDuplicate, onCopyProfileEmail, onEdit, onManageProduct, onViewLogs, onDelete }: { task: Task; profileEmail?: string; x: number; y: number; onClose: () => void; onStart: () => void; onStop: () => void; onRestart: () => void; onDuplicate: () => void; onCopyProfileEmail: () => void; onEdit: () => void; onManageProduct: () => void; onViewLogs: () => void; onDelete: () => void }) {
  useEffect(() => {
    const dismiss = (event: MouseEvent) => { if (!(event.target as Element | null)?.closest?.(".task-context-menu")) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("mousedown", dismiss);
    window.addEventListener("blur", onClose);
    window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", dismiss); window.removeEventListener("blur", onClose); window.removeEventListener("keydown", escape); };
  }, [onClose]);
  const idle = ["idle", "stopped", "completed", "declined", "error"].includes(task.status);
  const run = (action: () => void) => { action(); onClose(); };
  const left = Math.max(8, Math.min(x, window.innerWidth - 232));
  const top = Math.max(8, Math.min(y, window.innerHeight - 426));
  return createPortal(<div className="task-context-menu" style={{ left, top }} role="menu" aria-label={`Actions for ${task.name}`} onContextMenu={(event) => event.preventDefault()}><div className="task-context-head"><span>1 task selected</span><b>{task.name}</b></div><button disabled={!idle} onClick={() => run(onStart)}><Play size={14} /><span>Start</span></button><button disabled={idle} onClick={() => run(onStop)}><Square size={13} /><span>Stop</span></button><button onClick={() => run(onRestart)}><RotateCcw size={14} /><span>Restart task</span></button><div className="task-context-separator" /><button onClick={() => run(onDuplicate)}><Copy size={14} /><span>Duplicate</span></button><button disabled={!profileEmail} title={profileEmail ? `Copy ${profileEmail}` : "No profile email assigned"} onClick={() => run(onCopyProfileEmail)}><UserRound size={14} /><span>Copy profile email</span></button><button onClick={() => run(onEdit)}><Pencil size={14} /><span>Edit</span></button><button onClick={() => run(onManageProduct)}><Box size={14} /><span>Manage product</span></button><button onClick={() => run(onViewLogs)}><Activity size={14} /><span>View task logs</span></button><div className="task-context-separator" /><button className="danger" onClick={() => run(onDelete)}><Trash2 size={14} /><span>Delete</span></button></div>, document.body);
}

function TaskEditModal({ task, mode, profiles, proxies, bulkCount: _bulkCount, onCancel, onSave }: { task: Task; mode: "full" | "product"; profiles: Profile[]; proxies: ProxyConfig[]; bulkCount?: number; onCancel: () => void; onSave: (task: Task) => void }) {
  const [form, setForm] = useState<TaskEditForm>({ productInput: task.productUrl || task.sku || "", sku: task.sku ?? "", usePlaceholder: task.usePlaceholder ?? false, monitorKeywords: task.monitorKeywords ?? task.name, autoApplyMonitorSignal: task.autoApplyMonitorSignal ?? false, productUrl: task.productUrl, variant: task.variant, quantity: task.quantity, profileId: task.profileId, proxyId: task.proxyId, waitForQueue: task.waitForQueue ?? false, queueCheckIntervalMinutes: 3, loopProfiles: task.loopProfiles ?? task.offerProfileFallback ?? false, offerProfileFallback: task.loopProfiles ?? task.offerProfileFallback ?? false });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const at = new Date().toISOString();
    const message = mode === "product" ? "Product settings updated" : "Task settings updated";
    const { productInput, ...stored } = form;
    const value = productInput.trim();
    const isUrl = /^https?:\/\//i.test(value);
    const quantity = normalizeCartQuantity(form.quantity);
    onSave({ ...task, ...stored, name: value, productUrl: isUrl ? value : "", sku: isUrl ? "" : value, usePlaceholder: false, variant: "", quantity, effectiveQuantity: quantity, maxCartQuantity: undefined, monitorKeywords: value, proxyPoolIds: form.proxyId ? [form.proxyId] : [], queueCheckIntervalMinutes: 3, offerProfileFallback: form.loopProfiles, updatedAt: at, history: [...(task.history ?? []), { status: task.status, message, at }].slice(-30) });
  };
  return createPortal(<div className="modal-backdrop task-builder-backdrop" onMouseDown={onCancel}><form className="task-builder-modal task-edit-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><header className="task-builder-head"><div className="task-builder-title"><div className="task-builder-icon">{mode === "product" ? <Box size={18} /> : <Pencil size={18} />}</div><div><h2>{mode === "product" ? "Product" : "Edit task"}</h2></div></div><button type="button" className="task-builder-close" aria-label="Close task editor" onClick={onCancel}><X size={18} /></button></header><div className="task-builder-body"><section className="task-builder-section"><div className="task-builder-section-head"><div><b>Setup</b></div></div><div className="task-builder-grid"><label className="task-builder-field wide"><span>SKU / Product URL</span><input required autoFocus value={form.productInput} onChange={(event) => setForm({ ...form, productInput: event.target.value })} /></label><label className="task-builder-field"><span>Mode</span><input readOnly value="Default" /></label><label className="task-builder-field"><span>Cart quantity</span><input aria-label="Cart quantity" type="number" min="1" max="999" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} /></label></div></section>{mode === "full" && <TaskEditOptions form={form} setForm={setForm} profiles={profiles} proxies={proxies} />}</div><footer className="task-builder-actions"><span /><div><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button type="submit" className="primary">Save</button></div></footer></form></div>, document.body);
}

type TaskEditForm = { productInput: string; sku: string; usePlaceholder: boolean; monitorKeywords: string; autoApplyMonitorSignal: boolean; productUrl: string; variant: string; quantity: number; profileId: string; proxyId: string; waitForQueue: boolean; queueCheckIntervalMinutes: number; loopProfiles: boolean; offerProfileFallback: boolean; offerProxyFallback?: boolean };

function TaskEditOptions({ form, setForm, profiles, proxies }: { form: TaskEditForm; setForm: (form: TaskEditForm) => void; profiles: Profile[]; proxies: ProxyConfig[] }) {
  return <section className="task-builder-section">
    <div className="task-builder-section-head"><div><b>Assignment</b></div></div>
    <div className="task-builder-grid">
      <label className="task-builder-field"><span>Profiles</span><select value={form.profileId} onChange={(event) => setForm({ ...form, profileId: event.target.value })}><option value="">No profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      <label className="task-builder-field"><span>Proxies</span><select value={form.proxyId} onChange={(event) => setForm({ ...form, proxyId: event.target.value })}><option value="">Localhost (no proxy)</option>{proxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name}</option>)}</select></label>
    </div>
    <div className="task-builder-section-head"><div><b>Options</b></div></div>
    <div className="task-builder-grid task-toggle-grid">
      <label className="task-option-card compact"><input type="checkbox" checked={form.autoApplyMonitorSignal} onChange={(event) => setForm({ ...form, autoApplyMonitorSignal: event.target.checked })} /><span><b>Auto-apply match</b><small>Use exact matches automatically.</small></span><i className="task-switch" /></label>
      <label className="task-option-card compact"><input type="checkbox" checked={form.waitForQueue} onChange={(event) => setForm({ ...form, waitForQueue: event.target.checked })} /><span><b>Wait for queue</b><small>Check queue status automatically.</small></span><i className="task-switch" /></label>
      <label className="task-option-card compact"><input type="checkbox" checked={form.loopProfiles} onChange={(event) => setForm({ ...form, loopProfiles: event.target.checked, offerProfileFallback: event.target.checked })} /><span><b>Loop profiles</b><small>Try the next profile after a decline.</small></span><i className="task-switch" /></label>
    </div>
  </section>;
}

function TaskEditOptionsLegacy({ form, setForm, profiles, proxies }: { form: TaskEditForm; setForm: (form: TaskEditForm) => void; profiles: Profile[]; proxies: ProxyConfig[] }) {
  return <section className="task-builder-section"><div className="task-builder-section-head"><div><b>Queue & checkout</b><span>Timing, profile, and route</span></div><small>Task options</small></div><div className="task-builder-grid"><label className="task-option-card wide"><input type="checkbox" checked={form.waitForQueue} onChange={(event) => setForm({ ...form, waitForQueue: event.target.checked })} /><span><b>Track the official queue</b><small>Show position or estimated time and refresh periodically.</small></span><i className="task-switch" /></label><label className="task-builder-field"><span>Queue refresh</span><select disabled={!form.waitForQueue} value={form.queueCheckIntervalMinutes} onChange={(event) => setForm({ ...form, queueCheckIntervalMinutes: Number(event.target.value) })}><option value={2}>Every 2 minutes</option><option value={3}>Every 3 minutes</option><option value={5}>Every 5 minutes</option><option value={10}>Every 10 minutes</option></select></label><label className="task-builder-field"><span>Profile</span><select value={form.profileId} onChange={(event) => setForm({ ...form, profileId: event.target.value })}><option value="">No profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label className="task-builder-field"><span>Network route</span><select value={form.proxyId} onChange={(event) => setForm({ ...form, proxyId: event.target.value })}><option value="">Localhost (no proxy)</option>{proxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name}</option>)}</select></label><label className="task-option-card compact"><input type="checkbox" checked={form.offerProfileFallback} onChange={(event) => setForm({ ...form, offerProfileFallback: event.target.checked })} /><span><b>Profile fallback</b><small>Offer another after a decline.</small></span><i className="task-switch" /></label><label className="task-option-card compact"><input type="checkbox" checked={form.offerProxyFallback} onChange={(event) => setForm({ ...form, offerProxyFallback: event.target.checked })} /><span><b>Route fallback</b><small>Offer another after an error.</small></span><i className="task-switch" /></label></div></section>;
}

function TaskLogsModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const events = (task.history?.length ? [...task.history] : [{ status: task.status, message: task.statusMessage || "No status message", at: task.updatedAt }]).reverse();
  return createPortal(<div className="modal-backdrop task-log-backdrop" onMouseDown={onClose}><section className="task-log-modal" role="dialog" aria-modal="true" aria-label={`Task logs for ${task.name}`} onMouseDown={(event) => event.stopPropagation()}><header><div className="task-builder-title"><div className="task-builder-icon"><Activity size={18} /></div><div><span className="eyebrow">TASK LOGS</span><h2>{task.name}</h2><p>{task.sku || "No SKU"} &middot; {events.length} recorded {events.length === 1 ? "event" : "events"}</p></div></div><button type="button" aria-label="Close task logs" onClick={onClose}><X size={18} /></button></header><div className="task-log-current"><div><span>Current status</span><b>{taskStatusLabel[task.status]}</b></div><p>{task.statusMessage || "No current status message"}</p></div><div className="task-log-list">{events.map((event, index) => <article className="task-log-row" key={`${event.at}-${index}`}><span className={`task-log-dot ${event.status}`} /><div><div><b>{taskStatusLabel[event.status]}</b><time>{new Date(event.at).toLocaleString()}</time></div><p>{event.message}</p></div></article>)}</div><footer><span>Logs shown only for this task</span><button type="button" className="primary" onClick={onClose}>Close</button></footer></section></div>, document.body);
}

function queueDisplay(task: Task, now: number): { primary: string; secondary: string; title: string } {
  if (task.status !== "queued") return task.waitForQueue
    ? { primary: "Ready", secondary: "Queue wait enabled", title: "Queue tracking will begin when this task starts." }
    : { primary: "Skip", secondary: "No queue wait", title: "This task is not configured to wait for a queue." };

  const lastChecked = task.queueLastCheckedAt ? new Date(task.queueLastCheckedAt).getTime() : now;
  const secondsSinceCheck = Math.max(0, Math.floor((now - lastChecked) / 1_000));
  const etaSeconds = task.queueEtaSeconds == null ? undefined : Math.max(0, task.queueEtaSeconds - secondsSinceCheck);
  const position = task.queuePosition == null ? undefined : `#${task.queuePosition.toLocaleString()}`;
  const eta = etaSeconds == null ? undefined : etaSeconds < 60 ? "<1m" : `~${Math.ceil(etaSeconds / 60)}m`;
  const primary = [position, eta].filter(Boolean).join(" · ") || "Estimating";
  const nextCheck = task.queueNextCheckAt ? new Date(task.queueNextCheckAt).getTime() : undefined;
  const checkedLabel = secondsSinceCheck < 60 ? "now" : `${Math.floor(secondsSinceCheck / 60)}m ago`;
  const nextLabel = nextCheck == null ? "pending" : nextCheck <= now ? "due" : `${Math.max(1, Math.ceil((nextCheck - now) / 60_000))}m`;
  return {
    primary,
    secondary: `Checked ${checkedLabel} · next ${nextLabel}`,
    title: task.statusMessage || "Queue telemetry refreshes periodically.",
  };
}

function TaskRow({ task, actions = false, onDelete }: { task: Task; actions?: boolean; onDelete?: () => void }) {
  const start = () => void window.brava.tasks.start(task.id);
  return <div className="task-row"><div className={`status-icon ${task.status}`}><Activity size={18} /></div><div className="task-main"><b>{task.name}</b><span>{task.variant || "Any variant"} · Qty {task.quantity}</span><small>{task.statusMessage || "Ready to start"}</small></div><span className={`status ${task.status}`}>{taskStatusLabel[task.status]}</span>{actions && <div className="row-actions">
    {["idle", "stopped", "completed", "declined", "error"].includes(task.status) ? <button title="Start" onClick={start}><Play size={16} /></button> : <button title="Stop" onClick={() => void window.brava.tasks.stop(task.id)}><Square size={15} /></button>}
    {task.status === "awaiting_user" && <><button className="review" onClick={() => void window.brava.tasks.review(task.id)}><ExternalLink size={15} />Review</button><button title="Mark complete" onClick={() => void window.brava.tasks.complete(task.id)}><Check size={16} /></button></>}
    <button title="Delete" onClick={onDelete}><Trash2 size={16} /></button></div>}</div>;
}

function TaskForm({ profileGroups, profiles, proxyGroups, proxies, onCancel, onSave }: { profileGroups: ResourceGroup[]; profiles: Profile[]; proxyGroups: ResourceGroup[]; proxies: ProxyConfig[]; onCancel: () => void; onSave: (tasks: Task[]) => void }) {
  const [form, setForm] = useState({ productInput: "", profileIds: [] as string[], proxyIds: [] as string[], batchQuantity: 1, cartQuantity: 1, autoApplyMonitorSignal: false, waitForQueue: false, loopProfiles: false });
  const taskCount = Math.max(1, form.profileIds.length) * form.batchQuantity;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(createTaskBatch(form));
  };
  return createPortal(<div className="modal-backdrop task-builder-backdrop" onMouseDown={onCancel}><form className="task-builder-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <header className="task-builder-head"><div className="task-builder-title"><div className="task-builder-icon"><ShoppingCart size={18} /></div><div><h2>Create task</h2></div></div><button type="button" className="task-builder-close" aria-label="Close task builder" onClick={onCancel}><X size={18} /></button></header>
    <div className="task-builder-body">
      <section className="task-builder-section"><div className="task-builder-section-head"><div><b>Setup</b></div></div><div className="task-builder-grid task-builder-setup-grid">
        <label className="task-builder-field"><span>Mode</span><input value="Default" readOnly /></label>
        <label className="task-builder-field"><span>Cart quantity</span><input aria-label="Cart quantity" type="number" min="1" max="999" value={form.cartQuantity} onChange={(event) => setForm({ ...form, cartQuantity: Number(event.target.value) })} /></label>
        <label className="task-builder-field wide"><span>SKU / Product URL</span><input required autoFocus value={form.productInput} onChange={(event) => setForm({ ...form, productInput: event.target.value })} placeholder="Enter a SKU or Pokémon Center product URL" /></label>
        <div className="task-builder-field"><span>Profiles</span><GroupedResourceMultiSelect groups={profileGroups} items={profiles.map((profile) => ({ id: profile.id, groupId: profile.groupId, name: profile.name, detail: profile.email }))} selectedIds={form.profileIds} noun="profile" emptyLabel="No profiles available" noSelectionLabel="No profiles selected" onChange={(profileIds) => setForm({ ...form, profileIds })} /></div>
        <div className="task-builder-field"><span>Proxies</span><GroupedResourceMultiSelect groups={proxyGroups} items={proxies.map((proxy) => ({ id: proxy.id, groupId: proxy.groupId, name: proxy.name, detail: `${proxy.host}:${proxy.port}` }))} selectedIds={form.proxyIds} noun="proxy" emptyLabel="No proxies available" noSelectionLabel="Localhost (no proxy)" emptyOptionLabel="Localhost (no proxy)" onChange={(proxyIds) => setForm({ ...form, proxyIds })} /></div>
      </div></section>
      <section className="task-builder-section"><div className="task-builder-section-head"><div><b>Options</b></div></div><div className="task-builder-grid task-toggle-grid">
        <label className="task-option-card compact"><input type="checkbox" checked={form.autoApplyMonitorSignal} onChange={(event) => setForm({ ...form, autoApplyMonitorSignal: event.target.checked })} /><span><b>Auto-apply match</b><small>Use an exact monitor match automatically.</small></span><i className="task-switch" /></label>
        <label className="task-option-card compact"><input type="checkbox" checked={form.waitForQueue} onChange={(event) => setForm({ ...form, waitForQueue: event.target.checked })} /><span><b>Wait for queue</b><small>Follow queue status when one is active.</small></span><i className="task-switch" /></label>
        <label className="task-option-card compact"><input type="checkbox" checked={form.loopProfiles} onChange={(event) => setForm({ ...form, loopProfiles: event.target.checked })} /><span><b>Loop profiles</b><small>Try the next profile after a decline.</small></span><i className="task-switch" /></label>
      </div></section>
    </div>
    <footer className="task-builder-actions"><span>{form.profileIds.length ? `${form.profileIds.length} ${form.profileIds.length === 1 ? "profile" : "profiles"} selected` : "No profile selected"}</span><div><div className="task-quantity-stepper" aria-label="Task quantity"><span>Task copies</span><button type="button" aria-label="Decrease quantity" disabled={form.batchQuantity <= 1} onClick={() => setForm({ ...form, batchQuantity: Math.max(1, form.batchQuantity - 1) })}><Minus size={13} /></button><b>{form.batchQuantity}</b><button type="button" aria-label="Increase quantity" disabled={form.batchQuantity >= 1_000} onClick={() => setForm({ ...form, batchQuantity: Math.min(1_000, form.batchQuantity + 1) })}><Plus size={13} /></button></div><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button type="submit" className="primary">Create task ({taskCount})</button></div></footer>
  </form></div>, document.body);
}

type GroupedResourceItem = { id: string; groupId?: string; name: string; detail: string };

function GroupedResourceMultiSelect({ groups, items, selectedIds, noun, emptyLabel, noSelectionLabel, emptyOptionLabel, onChange }: { groups: ResourceGroup[]; items: GroupedResourceItem[]; selectedIds: string[]; noun: string; emptyLabel: string; noSelectionLabel: string; emptyOptionLabel?: string; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const pluralNoun = noun === "proxy" ? "proxies" : `${noun}s`;
  const groupedItems = useMemo(() => {
    const knownGroupIds = new Set(groups.map((group) => group.id));
    const result = groups.map((group) => ({ ...group, items: items.filter((item) => item.groupId === group.id) }));
    const ungrouped = items.filter((item) => !item.groupId || !knownGroupIds.has(item.groupId));
    return ungrouped.length ? [...result, { id: "__ungrouped", name: "Ungrouped", items: ungrouped }] : result;
  }, [groups, items]);
  const selected = items.filter((item) => selectedSet.has(item.id));
  const label = selected.length === 0 ? noSelectionLabel : selected.length === 1 ? selected[0]!.name : `${selected.length} ${pluralNoun} selected`;
  const toggleItem = (id: string) => onChange(selectedSet.has(id) ? selectedIds.filter((itemId) => itemId !== id) : [...selectedIds, id]);
  const toggleGroup = (groupItems: GroupedResourceItem[]) => {
    const groupIds = groupItems.map((item) => item.id);
    const allSelected = groupIds.length > 0 && groupIds.every((id) => selectedSet.has(id));
    if (allSelected) onChange(selectedIds.filter((id) => !groupIds.includes(id)));
    else onChange([...new Set([...selectedIds, ...groupIds])]);
  };
  const toggleExpanded = (id: string) => setExpandedIds((current) => current.includes(id) ? current.filter((groupId) => groupId !== id) : [...current, id]);
  return <div className={`profile-multi-select ${open ? "open" : ""}`} ref={root}>
    <button type="button" className="profile-multi-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={!items.length && !emptyOptionLabel} onClick={() => setOpen((value) => !value)}><span>{items.length || emptyOptionLabel ? label : emptyLabel}</span><ChevronDown size={14} /></button>
    {open && <div className="profile-multi-menu grouped-resource-menu" role="listbox" aria-multiselectable="true">{emptyOptionLabel && <button type="button" role="option" aria-selected={!selectedIds.length} className={`resource-localhost-option ${selectedIds.length ? "" : "selected"}`} onClick={() => onChange([])}><span><b>{emptyOptionLabel}</b><small>Use this computer's connection</small></span>{!selectedIds.length && <Check size={13} />}</button>}<div className="profile-multi-actions"><span>{groupedItems.length} {groupedItems.length === 1 ? "group" : "groups"}</span><button type="button" disabled={!selectedIds.length} onClick={() => onChange([])}>Clear</button></div><div className="resource-group-list">{groupedItems.map((group) => {
      const expanded = expandedIds.includes(group.id);
      const selectedCount = group.items.filter((item) => selectedSet.has(item.id)).length;
      const allSelected = group.items.length > 0 && selectedCount === group.items.length;
      return <div className={`resource-picker-group ${expanded ? "expanded" : ""}`} key={group.id}><div className="resource-picker-group-head"><label className="resource-group-select" title={`Select every ${noun} in ${group.name}`}><input type="checkbox" aria-label={`Select all ${pluralNoun} in ${group.name}`} checked={allSelected} disabled={!group.items.length} onChange={() => toggleGroup(group.items)} /><span><b>{group.name}</b><small>{selectedCount} of {group.items.length} selected</small></span></label><button type="button" className="resource-group-expand" aria-label={`${expanded ? "Hide" : "Show"} ${pluralNoun} in ${group.name}`} aria-expanded={expanded} onClick={() => toggleExpanded(group.id)}><ChevronRight size={13} /></button></div>{expanded && <VirtualResourceOptions items={group.items} selectedSet={selectedSet} onToggle={toggleItem} />}</div>;
    })}</div></div>}
  </div>;
}

function VirtualResourceOptions({ items, selectedSet, onToggle }: { items: GroupedResourceItem[]; selectedSet: Set<string>; onToggle: (id: string) => void }) {
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = 43;
  const viewportHeight = Math.min(176, Math.max(rowHeight, items.length * rowHeight));
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 3);
  const end = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 3);
  return <div className="profile-multi-options virtual-resource-options" style={{ height: viewportHeight }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}><div className="virtual-resource-spacer" style={{ height: items.length * rowHeight }}><div className="virtual-resource-window" style={{ transform: `translateY(${start * rowHeight}px)` }}>{items.slice(start, end).map((item) => <label key={item.id} className={selectedSet.has(item.id) ? "selected" : ""}><input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => onToggle(item.id)} /><span><b>{item.name}</b><small>{item.detail}</small></span><Check size={13} /></label>)}</div></div></div>;
}

function TaskFormLegacy({ profiles, proxies, onCancel, onSave }: { profiles: Profile[]; proxies: ProxyConfig[]; onCancel: () => void; onSave: (task: Task) => void }) {
  const [form, setForm] = useState({ name: "", productUrl: "", sku: "", usePlaceholder: true, variant: "", quantity: 1, profileId: profiles[0]?.id ?? "", proxyId: "", waitForQueue: true, queueCheckIntervalMinutes: 3, offerProfileFallback: false, offerProxyFallback: false });
  const submit = (event: FormEvent) => { event.preventDefault(); const updatedAt = new Date().toISOString(); onSave({ ...form, sku: form.usePlaceholder && !form.sku.trim() ? "PLACEHOLDER" : form.sku.trim(), id: crypto.randomUUID(), status: "idle", statusMessage: "Ready to start", updatedAt, history: [{ status: "idle", message: "Task created", at: updatedAt }] }); };
  return createPortal(<div className="modal-backdrop task-builder-backdrop" onMouseDown={onCancel}><form className="task-builder-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><header className="task-builder-head"><div className="task-builder-title"><div className="task-builder-icon"><Box size={18} /></div><div><span className="eyebrow">POKÉMON CENTER</span><h2>Create task</h2><p>Configure one monitored product and its checkout handoff.</p></div></div><button type="button" className="task-builder-close" aria-label="Close task builder" onClick={onCancel}><X size={18} /></button></header><div className="task-builder-body"><section className="task-builder-section"><div className="task-builder-section-head"><div><b>Product</b><span>What Brava should watch</span></div><small>Required fields</small></div><div className="task-builder-grid"><label className="task-builder-field"><span>Task name</span><input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Celebration drop" /></label><label className="task-builder-field"><span>Mode</span><select value={form.usePlaceholder ? "placeholder" : "live"} onChange={(event) => setForm({ ...form, usePlaceholder: event.target.value === "placeholder" })}><option value="placeholder">Placeholder SKU</option><option value="live">Live SKU</option></select></label><label className="task-builder-field wide"><span>{form.usePlaceholder ? "Placeholder / SKU" : "Live SKU"}</span><input required={!form.usePlaceholder} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder={form.usePlaceholder ? "PLACEHOLDER — update while queued" : "Enter the live product SKU"} /></label><label className="task-builder-field wide"><span>Official product URL <i>Optional</i></span><input type="url" pattern="https://(www\.)?pokemoncenter\.com/.*" value={form.productUrl} onChange={(event) => setForm({ ...form, productUrl: event.target.value })} placeholder="https://www.pokemoncenter.com/product/..." /></label><label className="task-builder-field"><span>Variant</span><input value={form.variant} onChange={(event) => setForm({ ...form, variant: event.target.value })} placeholder="Any or exact label" /></label><label className="task-builder-field"><span>Quantity</span><input type="number" min="1" max="4" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} /></label></div></section><section className="task-builder-section"><div className="task-builder-section-head"><div><b>Queue & checkout</b><span>Timing, profile, and route</span></div><small>Task options</small></div><div className="task-builder-grid"><label className="task-option-card wide"><input type="checkbox" checked={form.waitForQueue} onChange={(event) => setForm({ ...form, waitForQueue: event.target.checked })} /><span><b>Track the official queue</b><small>Show position or estimated time and refresh periodically.</small></span><i className="task-switch" /></label><label className="task-builder-field"><span>Queue refresh</span><select disabled={!form.waitForQueue} value={form.queueCheckIntervalMinutes} onChange={(event) => setForm({ ...form, queueCheckIntervalMinutes: Number(event.target.value) })}><option value={2}>Every 2 minutes</option><option value={3}>Every 3 minutes</option><option value={5}>Every 5 minutes</option><option value={10}>Every 10 minutes</option></select></label><label className="task-builder-field"><span>Profile</span><select value={form.profileId} onChange={(event) => setForm({ ...form, profileId: event.target.value })}><option value="">No profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label className="task-builder-field"><span>Network route</span><select value={form.proxyId} onChange={(event) => setForm({ ...form, proxyId: event.target.value })}><option value="">Localhost (no proxy)</option>{proxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name}</option>)}</select></label><div className="task-builder-note"><Radio size={15} /><span>Queue tracking and routing can be changed later.</span></div><label className="task-option-card compact"><input type="checkbox" checked={form.offerProfileFallback} onChange={(event) => setForm({ ...form, offerProfileFallback: event.target.checked })} /><span><b>Profile fallback</b><small>Offer another after a decline.</small></span><i className="task-switch" /></label><label className="task-option-card compact"><input type="checkbox" checked={form.offerProxyFallback} onChange={(event) => setForm({ ...form, offerProxyFallback: event.target.checked })} /><span><b>Route fallback</b><small>Offer another after an error.</small></span><i className="task-switch" /></label></div></section></div><footer className="task-builder-actions"><span><span className="live-dot" />Ready to create one task</span><div><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button type="submit" className="primary">Create task</button></div></footer></form></div>, document.body);
}

function Profiles({ data, save }: { data: AppData; save: (data: AppData) => Promise<void> }) {
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(data.profileGroups[0]?.id ?? "");
  const [pendingImport, setPendingImport] = useState<{ fileName: string; groupName: string; profiles: Profile[] } | null>(null);
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<"profiles" | "group" | null>(null);
  useEffect(() => { if (!data.profileGroups.some((group) => group.id === selectedGroupId)) setSelectedGroupId(data.profileGroups[0]?.id ?? ""); }, [data.profileGroups, selectedGroupId]);
  const selectedGroup = data.profileGroups.find((group) => group.id === selectedGroupId);
  const profiles = data.profiles.filter((profile) => profile.groupId === selectedGroupId);
  const addGroup = (group: ResourceGroup) => { void save({ ...data, profileGroups: [...data.profileGroups, group] }); setSelectedGroupId(group.id); setCreatingGroup(false); };
  const addProfile = (profile: Profile) => { void save({ ...data, profiles: [...data.profiles, profile] }); setCreatingProfile(false); };
  const deleteOneProfile = (profileId: string) => void save({ ...data, profiles: data.profiles.filter((profile) => profile.id !== profileId), tasks: data.tasks.map((task) => task.profileId === profileId ? { ...task, profileId: "" } : task) });
  const deleteProfiles = async (deleteGroup: boolean) => {
    if (!selectedGroup) return;
    const ids = new Set(profiles.map((profile) => profile.id));
    const remainingGroups = deleteGroup ? data.profileGroups.filter((group) => group.id !== selectedGroup.id) : data.profileGroups;
    await save({ ...data, profileGroups: remainingGroups, profiles: data.profiles.filter((profile) => !ids.has(profile.id)), tasks: data.tasks.map((task) => ids.has(task.profileId) ? { ...task, profileId: "" } : task) });
    if (deleteGroup) setSelectedGroupId(remainingGroups[0]?.id ?? "");
    setDeleteTarget(null);
  };
  const renameGroup = (groupId: string, name: string) => void save({ ...data, profileGroups: data.profileGroups.map((group) => group.id === groupId ? { ...group, name } : group) });
  const duplicateGroup = (groupId: string) => {
    const source = data.profileGroups.find((group) => group.id === groupId);
    if (!source) return;
    const nextGroup = { ...source, id: crypto.randomUUID(), name: `${source.name} copy` };
    const copies = data.profiles.filter((profile) => profile.groupId === groupId).map((profile) => ({ ...profile, id: crypto.randomUUID(), groupId: nextGroup.id }));
    void save({ ...data, profileGroups: [...data.profileGroups, nextGroup], profiles: [...copies, ...data.profiles] });
    setSelectedGroupId(nextGroup.id);
  };
  const chooseCsv = () => {
    if (!selectedGroup) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = () => void (async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImportIssues([]);
      setImportMessage("");
      try {
        const imported = parseProfilesCsv(await file.text(), selectedGroup.id);
        setPendingImport({ fileName: file.name, groupName: selectedGroup.name, profiles: imported });
      } catch (cause) {
        setImportIssues(cause instanceof ProfileCsvError ? cause.issues : [cleanIpcError(cause, "Could not read this profile CSV.")]);
      }
    })();
    input.click();
  };
  const confirmImport = async () => {
    if (!pendingImport) return;
    setImporting(true);
    try {
      await save({ ...data, profiles: [...data.profiles, ...pendingImport.profiles] });
      setImportMessage(`Imported ${pendingImport.profiles.length} ${pendingImport.profiles.length === 1 ? "profile" : "profiles"} into ${pendingImport.groupName}.`);
      setImportIssues([]);
      setPendingImport(null);
    } catch (cause) {
      setImportIssues([cleanIpcError(cause, "Could not save the imported profiles.")]);
      setPendingImport(null);
    } finally {
      setImporting(false);
    }
  };
  return <div className="manager-shell"><ResourceGroupSidebar title="Profile groups" groups={data.profileGroups} selectedId={selectedGroupId} icon={<UserRound />} itemLabel="profiles" items={data.profiles} onSelect={setSelectedGroupId} onAdd={() => setCreatingGroup(true)} onRename={renameGroup} onDuplicate={duplicateGroup} onDeleteAll={(id) => { setSelectedGroupId(id); setDeleteTarget("profiles"); }} onDelete={(id) => { setSelectedGroupId(id); setDeleteTarget("group"); }} /><section className="manager-main"><ManagerHeader title={selectedGroup?.name ?? "Profiles"} count={selectedGroup ? `${profiles.length} profiles` : "Select or create a group"} onAdd={() => setCreatingProfile(true)} addDisabled={!selectedGroup} leadingActions={<button className="manager-action" disabled={!selectedGroup} onClick={chooseCsv}><Download size={14} />Import</button>} actions={<button className="manager-action danger" disabled={!profiles.length} onClick={() => setDeleteTarget("profiles")}><Trash2 size={14} />Delete all</button>} />
    {importMessage && <div className="profile-import-feedback success"><CheckCircle2 size={15} /><span>{importMessage}</span><button aria-label="Dismiss import message" onClick={() => setImportMessage("")}><X size={13} /></button></div>}
    {importIssues.length > 0 && <div className="profile-import-feedback error"><X size={15} /><div><b>Import failed</b>{importIssues.slice(0, 4).map((issue) => <span key={issue}>{issue}</span>)}{importIssues.length > 4 && <span>Plus {importIssues.length - 4} more row errors.</span>}</div><button aria-label="Dismiss import error" onClick={() => setImportIssues([])}><X size={13} /></button></div>}
    <div className="manager-columns profile-columns"><span>Profile</span><span>Shipping contact</span><span>Shipping address</span><span>Billing</span><span>Payment</span><span>Actions</span></div>{profiles.length ? <VirtualProfileRows profiles={profiles} groupId={selectedGroupId} onDelete={deleteOneProfile} /> : <div className="manager-rows">{selectedGroup ? <Empty icon={<UserRound />} title="No profiles" action="Create profile" onAction={() => setCreatingProfile(true)} /> : <Empty icon={<UserRound />} title="Create a profile group" />}</div>}
  </section>{creatingGroup && <GroupNameForm title="Add profile group" onCancel={() => setCreatingGroup(false)} onSave={addGroup} />}{creatingProfile && selectedGroup && <GroupedProfileForm groupId={selectedGroup.id} onCancel={() => setCreatingProfile(false)} onSave={addProfile} />}{pendingImport && createPortal(<div className="modal-backdrop" onMouseDown={() => !importing && setPendingImport(null)}><section className="panel import-confirm-card profile-import-card" onMouseDown={(event) => event.stopPropagation()}><div className="profile-import-icon"><Download size={18} /></div><h2>Import {pendingImport.profiles.length} {pendingImport.profiles.length === 1 ? "profile" : "profiles"}?</h2><p><b>{pendingImport.fileName}</b> will be added to <b>{pendingImport.groupName}</b>.</p><div className="import-warning"><CheckCircle2 size={15} /><span>Every row passed validation. Existing profiles will stay unchanged.</span></div><div className="form-actions"><button className="ghost" disabled={importing} onClick={() => setPendingImport(null)}>Cancel</button><button className="primary" disabled={importing} onClick={() => void confirmImport()}>{importing ? "Importing…" : "Import"}</button></div></section></div>, document.body)}{deleteTarget === "profiles" && selectedGroup && <DeleteConfirmModal title={`Delete all ${profiles.length} profiles?`} body={`This removes every profile in ${selectedGroup.name}. Tasks using them will be unassigned.`} confirmLabel="Delete all profiles" onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteProfiles(false)} />}{deleteTarget === "group" && selectedGroup && <DeleteConfirmModal title={`Delete ${selectedGroup.name}?`} body={`This removes the profile group and all ${profiles.length} profiles inside it.`} confirmLabel="Delete group" onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteProfiles(true)} />}</div>;
}

const profileRowHeight = 65;
const profileRowOverscan = 8;

function VirtualProfileRows({ profiles, groupId, onDelete }: { profiles: Profile[]; groupId: string; onDelete: (profileId: string) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight || 600);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setScrollTop(0); if (viewport.current) viewport.current.scrollTop = 0; }, [groupId]);
  const range = useMemo(() => getVirtualRange(profiles.length, scrollTop, viewportHeight, profileRowHeight, profileRowOverscan), [profiles.length, scrollTop, viewportHeight]);
  const visible = profiles.slice(range.start, range.end);
  return <div ref={viewport} className="manager-rows virtual-profile-rows" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} data-total-rows={profiles.length} data-rendered-rows={visible.length}>
    <div className="virtual-profile-spacer" style={{ height: profiles.length * profileRowHeight }}>
      <div className="virtual-profile-window" style={{ transform: `translateY(${range.start * profileRowHeight}px)` }}>
        {visible.map((profile) => <ProfileTableRow key={profile.id} profile={profile} onDelete={() => onDelete(profile.id)} />)}
      </div>
    </div>
  </div>;
}

function ProfileTableRow({ profile, onDelete }: { profile: Profile; onDelete: () => void }) {
  return <div className="manager-row profile-columns"><div><b>{profile.name}</b><small>{profile.email}</small></div><div><b>{profile.firstName} {profile.lastName}</b><small>{profile.phone}</small></div><div><b>{profile.address1}</b><small>{profile.city}, {profile.region} {profile.postalCode}</small></div>{profile.payment?.billingSameAsShipping !== false ? <span className="indicator yes">Same</span> : <div><b>{profile.billing?.address1 || "Separate"}</b><small>{profile.billing ? `${profile.billing.city}, ${profile.billing.region}` : "Billing address"}</small></div>}<div><b>{profile.payment?.brand ?? "Browser entry"} {profile.payment?.last4 ? `•••• ${profile.payment.last4}` : ""}</b><small>{profile.payment?.expiryMonth ? `${profile.payment.expiryMonth}/${profile.payment.expiryYear}` : "Not stored"}</small></div><div className="table-actions"><button title="Delete profile" aria-label={`Delete profile ${profile.name}`} onClick={onDelete}><Trash2 size={14} /></button></div></div>;
}

function ProfilesLegacy({ data, save }: { data: AppData; save: (data: AppData) => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const add = (profile: Profile) => { void save({ ...data, profiles: [...data.profiles, profile] }); setCreating(false); };
  if (true) return <div className="manager-shell"><ManagerSidebar title="Profile groups" total={data.profiles.length} icon={<UserRound />} groupName="Personal" meta={`${data.profiles.length} profiles`} addLabel="Create profile" onAdd={() => setCreating(true)} /><section className="manager-main"><ManagerHeader title="Personal" count={`${data.profiles.length} profiles`} onAdd={() => setCreating(true)} />
    <div className="manager-columns profile-columns"><span>Profile</span><span>Shipping contact</span><span>Shipping address</span><span>Billing</span><span>Payment</span><span>Actions</span></div><div className="manager-rows">{data.profiles.map((profile) => <div className="manager-row profile-columns" key={profile.id}><div><b>{profile.name}</b><small>{profile.email}</small></div><div><b>{profile.firstName} {profile.lastName}</b><small>{profile.phone}</small></div><div><b>{profile.address1}</b><small>{profile.city}, {profile.region} {profile.postalCode}</small></div><span className="indicator yes">Same</span><div><b>{profile.payment?.brand ?? "Browser entry"} {profile.payment?.last4 ? `•••• ${profile.payment.last4}` : ""}</b><small>{profile.payment?.expiryMonth ? `${profile.payment.expiryMonth}/${profile.payment.expiryYear}` : "Not stored"}</small></div><div className="table-actions"><button title="Delete profile" onClick={() => void save({ ...data, profiles: data.profiles.filter((item) => item.id !== profile.id) })}><Trash2 size={14} /></button></div></div>)}{!data.profiles.length && <Empty icon={<UserRound />} title="No profiles" action="Create profile" onAction={() => setCreating(true)} />}</div>
  </section>{creating && <ProfileForm onCancel={() => setCreating(false)} onSave={add} />}</div>;
  return <><Title title="Profiles" subtitle="Shipping and payment-method preferences for checkout." action={<button className="primary" onClick={() => setCreating(true)}><Plus size={17} />New profile</button>} />{creating && <ProfileForm onCancel={() => setCreating(false)} onSave={add} />}<CardGrid>{data.profiles.map((profile) => <InfoCard key={profile.id} title={profile.name} lines={[`${profile.firstName} ${profile.lastName}`, profile.email, `${profile.city}, ${profile.region} ${profile.postalCode}`, profile.payment?.last4 ? `${profile.payment.brand} ending in ${profile.payment.last4} · ${profile.payment.expiryMonth}/${profile.payment.expiryYear}` : "No payment preference"]} onDelete={() => void save({ ...data, profiles: data.profiles.filter((item) => item.id !== profile.id) })} />)}</CardGrid>{!data.profiles.length && !creating && <Empty icon={<UserRound />} title="No profiles" body="Add shipping and payment preferences for checkout." action="Add profile" onAction={() => setCreating(true)} />}</>;
}

function ProfileForm({ onCancel, onSave }: { onCancel: () => void; onSave: (profile: Profile) => void }) {
  const [form, setForm] = useState<Omit<Profile, "id">>({ name: "", email: "", firstName: "", lastName: "", address1: "", address2: "", city: "", region: "", postalCode: "", country: "US", phone: "", payment: { cardholderName: "", brand: "Visa", last4: "", expiryMonth: "", expiryYear: "", billingSameAsShipping: true } });
  const set = (key: keyof Omit<Profile, "id">, value: string) => setForm({ ...form, [key]: value });
  const setPayment = (key: keyof NonNullable<Profile["payment"]>, value: string | boolean) => setForm({ ...form, payment: { ...form.payment!, [key]: value } });
  return <FormCard title="New profile" onSubmit={(event) => { event.preventDefault(); onSave({ id: crypto.randomUUID(), ...form }); }} onCancel={onCancel}>
    <FormSection title="Profile & contact" />
    <Field label="Profile name"><input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Personal" /></Field>
    <Field label="Email"><input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
    <Field label="Phone"><input required type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
    <FormSection title="Shipping address" />
    <Field label="First name"><input required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
    <Field label="Last name"><input required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
    <Field label="Address line 1"><input required value={form.address1} onChange={(e) => set("address1", e.target.value)} /></Field>
    <Field label="Address line 2"><input value={form.address2} onChange={(e) => set("address2", e.target.value)} /></Field>
    <Field label="City"><input required value={form.city} onChange={(e) => set("city", e.target.value)} /></Field>
    <Field label="State / region"><input required value={form.region} onChange={(e) => set("region", e.target.value)} /></Field>
    <Field label="Postal code"><input required value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)} /></Field>
    <Field label="Country"><select value={form.country} onChange={(e) => set("country", e.target.value)}><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option></select></Field>
    <FormSection title="Payment preference" note="Card label and checkout preferences" />
    <Field label="Cardholder name"><input required value={form.payment!.cardholderName} onChange={(e) => setPayment("cardholderName", e.target.value)} /></Field>
    <Field label="Card brand"><select value={form.payment!.brand} onChange={(e) => setPayment("brand", e.target.value)}><option>Visa</option><option>Mastercard</option><option>Amex</option><option>Discover</option><option>Other</option></select></Field>
    <Field label="Last 4 digits"><input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={form.payment!.last4} onChange={(e) => setPayment("last4", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" /></Field>
    <Field label="Expiry month"><input required inputMode="numeric" pattern="0[1-9]|1[0-2]" maxLength={2} value={form.payment!.expiryMonth} onChange={(e) => setPayment("expiryMonth", e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="MM" /></Field>
    <Field label="Expiry year"><input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={form.payment!.expiryYear} onChange={(e) => setPayment("expiryYear", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="YYYY" /></Field>
    <label className="check-field"><input type="checkbox" checked={form.payment!.billingSameAsShipping} onChange={(e) => setPayment("billingSameAsShipping", e.target.checked)} /><span>Billing address matches shipping</span></label>
  </FormCard>;
}

function GroupedProfileForm({ groupId, onCancel, onSave }: { groupId: string; onCancel: () => void; onSave: (profile: Profile) => void }) {
  const blankBilling = { firstName: "", lastName: "", address1: "", address2: "", city: "", region: "", postalCode: "", country: "US" };
  const [form, setForm] = useState<Omit<Profile, "id">>({ groupId, name: "", email: "", firstName: "", lastName: "", address1: "", address2: "", city: "", region: "", postalCode: "", country: "US", phone: "", payment: { cardholderName: "", brand: "Visa", last4: "", expiryMonth: "", expiryYear: "", billingSameAsShipping: true }, billing: blankBilling });
  const set = (key: keyof Omit<Profile, "id">, value: string) => setForm({ ...form, [key]: value });
  const setPayment = (key: keyof NonNullable<Profile["payment"]>, value: string | boolean) => setForm({ ...form, payment: { ...form.payment!, [key]: value } });
  const setBilling = (key: keyof NonNullable<Profile["billing"]>, value: string) => setForm({ ...form, billing: { ...form.billing!, [key]: value } });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const billing = form.payment!.billingSameAsShipping ? { firstName: form.firstName, lastName: form.lastName, address1: form.address1, address2: form.address2, city: form.city, region: form.region, postalCode: form.postalCode, country: form.country } : form.billing;
    onSave({ id: crypto.randomUUID(), ...form, billing });
  };
  return <FormCard title="New profile" onSubmit={submit} onCancel={onCancel}>
    <FormSection title="Profile & contact" />
    <Field label="Profile name"><input required autoFocus value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Personal" /></Field><Field label="Email"><input required type="email" value={form.email} onChange={(event) => set("email", event.target.value)} /></Field><Field label="Phone"><input required type="tel" value={form.phone} onChange={(event) => set("phone", event.target.value)} /></Field>
    <FormSection title="Shipping address" />
    <Field label="First name"><input required value={form.firstName} onChange={(event) => set("firstName", event.target.value)} /></Field><Field label="Last name"><input required value={form.lastName} onChange={(event) => set("lastName", event.target.value)} /></Field><Field label="Address line 1"><input required value={form.address1} onChange={(event) => set("address1", event.target.value)} /></Field><Field label="Address line 2"><input value={form.address2} onChange={(event) => set("address2", event.target.value)} /></Field><Field label="City"><input required value={form.city} onChange={(event) => set("city", event.target.value)} /></Field><Field label="State / region"><input required value={form.region} onChange={(event) => set("region", event.target.value)} /></Field><Field label="Postal code"><input required value={form.postalCode} onChange={(event) => set("postalCode", event.target.value)} /></Field><Field label="Country"><select value={form.country} onChange={(event) => set("country", event.target.value)}><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option></select></Field>
    <FormSection title="Payment" />
    <Field label="Cardholder name"><input required value={form.payment!.cardholderName} onChange={(event) => setPayment("cardholderName", event.target.value)} /></Field><Field label="Card brand"><select value={form.payment!.brand} onChange={(event) => setPayment("brand", event.target.value)}><option>Visa</option><option>Mastercard</option><option>Amex</option><option>Discover</option><option>Other</option></select></Field><Field label="Last 4 digits"><input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={form.payment!.last4} onChange={(event) => setPayment("last4", event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" /></Field><Field label="Expiry month"><input required inputMode="numeric" pattern="0[1-9]|1[0-2]" maxLength={2} value={form.payment!.expiryMonth} onChange={(event) => setPayment("expiryMonth", event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="MM" /></Field><Field label="Expiry year"><input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={form.payment!.expiryYear} onChange={(event) => setPayment("expiryYear", event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="YYYY" /></Field>
    <label className="check-field billing-match"><input type="checkbox" checked={form.payment!.billingSameAsShipping} onChange={(event) => setPayment("billingSameAsShipping", event.target.checked)} /><span>Billing address matches shipping</span></label>
    <FormSection title="Billing address" note={form.payment!.billingSameAsShipping ? "Using shipping address" : "Separate address"} />
    <fieldset className="billing-fields" disabled={form.payment!.billingSameAsShipping}><Field label="First name"><input required value={form.billing!.firstName} onChange={(event) => setBilling("firstName", event.target.value)} /></Field><Field label="Last name"><input required value={form.billing!.lastName} onChange={(event) => setBilling("lastName", event.target.value)} /></Field><Field label="Address line 1"><input required value={form.billing!.address1} onChange={(event) => setBilling("address1", event.target.value)} /></Field><Field label="Address line 2"><input value={form.billing!.address2} onChange={(event) => setBilling("address2", event.target.value)} /></Field><Field label="City"><input required value={form.billing!.city} onChange={(event) => setBilling("city", event.target.value)} /></Field><Field label="State / region"><input required value={form.billing!.region} onChange={(event) => setBilling("region", event.target.value)} /></Field><Field label="Postal code"><input required value={form.billing!.postalCode} onChange={(event) => setBilling("postalCode", event.target.value)} /></Field><Field label="Country"><select value={form.billing!.country} onChange={(event) => setBilling("country", event.target.value)}><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option></select></Field></fieldset>
  </FormCard>;
}

function Proxies({ data, save }: { data: AppData; save: (data: AppData) => Promise<void> }) {
  const [creatingProxies, setCreatingProxies] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(data.proxyGroups[0]?.id ?? "");
  const [deleteTarget, setDeleteTarget] = useState<"proxies" | "group" | null>(null);
  const [testResults, setTestResults] = useState<Map<string, ProxyTestResult>>(() => new Map());
  const [testTarget, setTestTarget] = useState<ProxyTestTarget>("pokemon_center");
  const [testingIds, setTestingIds] = useState<Set<string>>(() => new Set());
  const [testingGroupId, setTestingGroupId] = useState<string | null>(null);
  const [testError, setTestError] = useState("");
  useEffect(() => { if (!data.proxyGroups.some((group) => group.id === selectedGroupId)) setSelectedGroupId(data.proxyGroups[0]?.id ?? ""); }, [data.proxyGroups, selectedGroupId]);
  const selectedGroup = data.proxyGroups.find((group) => group.id === selectedGroupId);
  const proxies = data.proxies.filter((proxy) => proxy.groupId === selectedGroupId);
  const addGroup = (group: ResourceGroup) => { void save({ ...data, proxyGroups: [...data.proxyGroups, group] }); setSelectedGroupId(group.id); setCreatingGroup(false); };
  const addProxies = (items: ProxyConfig[]) => { void save({ ...data, proxies: [...data.proxies, ...items] }); setCreatingProxies(false); };
  const deleteOneProxy = (proxyId: string) => void save({ ...data, proxies: data.proxies.filter((proxy) => proxy.id !== proxyId), tasks: data.tasks.map((task) => task.proxyId === proxyId ? { ...task, proxyId: "" } : task) });
  const deleteProxies = async (deleteGroup: boolean) => {
    if (!selectedGroup) return;
    const ids = new Set(proxies.map((proxy) => proxy.id));
    const remainingGroups = deleteGroup ? data.proxyGroups.filter((group) => group.id !== selectedGroup.id) : data.proxyGroups;
    await save({ ...data, proxyGroups: remainingGroups, proxies: data.proxies.filter((proxy) => !ids.has(proxy.id)), tasks: data.tasks.map((task) => ids.has(task.proxyId) ? { ...task, proxyId: "" } : task) });
    if (deleteGroup) setSelectedGroupId(remainingGroups[0]?.id ?? "");
    setDeleteTarget(null);
  };
  const renameGroup = (groupId: string, name: string) => void save({ ...data, proxyGroups: data.proxyGroups.map((group) => group.id === groupId ? { ...group, name } : group) });
  const duplicateGroup = (groupId: string) => {
    const source = data.proxyGroups.find((group) => group.id === groupId);
    if (!source) return;
    const nextGroup = { ...source, id: crypto.randomUUID(), name: `${source.name} copy` };
    const copies = data.proxies.filter((proxy) => proxy.groupId === groupId).map((proxy) => ({ ...proxy, id: crypto.randomUUID(), groupId: nextGroup.id }));
    void save({ ...data, proxyGroups: [...data.proxyGroups, nextGroup], proxies: [...copies, ...data.proxies] });
    setSelectedGroupId(nextGroup.id);
  };
  const testOne = async (proxy: ProxyConfig) => {
    setTestError("");
    setTestingIds((current) => new Set(current).add(proxy.id));
    try {
      const result = await window.brava.proxies.test(proxy.id, testTarget);
      setTestResults((current) => new Map(current).set(proxy.id, result));
    } catch (error) {
      setTestResults((current) => new Map(current).set(proxy.id, { proxyId: proxy.id, status: "failed", message: error instanceof Error ? error.message : "Test failed" }));
    } finally {
      setTestingIds((current) => { const next = new Set(current); next.delete(proxy.id); return next; });
    }
  };
  const testAll = async () => {
    if (!proxies.length || testingGroupId) return;
    setTestError("");
    setTestingGroupId(selectedGroupId);
    try {
      const results = await window.brava.proxies.testMany(proxies.map((proxy) => proxy.id), testTarget);
      setTestResults((current) => { const next = new Map(current); results.forEach((result) => next.set(result.proxyId, result)); return next; });
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "Proxy test failed.");
    } finally {
      setTestingGroupId(null);
    }
  };
  return <div className="manager-shell"><ResourceGroupSidebar title="Proxy groups" groups={data.proxyGroups} selectedId={selectedGroupId} icon={<Server />} itemLabel="proxies" items={data.proxies} onSelect={setSelectedGroupId} onAdd={() => setCreatingGroup(true)} onRename={renameGroup} onDuplicate={duplicateGroup} onDeleteAll={(id) => { setSelectedGroupId(id); setDeleteTarget("proxies"); }} onDelete={(id) => { setSelectedGroupId(id); setDeleteTarget("group"); }} /><section className="manager-main"><ManagerHeader title={selectedGroup?.name ?? "Proxies"} count={testError || (selectedGroup ? `${proxies.length} proxies` : "Select or create a group")} onAdd={() => setCreatingProxies(true)} addDisabled={!selectedGroup} actions={<><label className="proxy-test-target"><span>Test on</span><select aria-label="Proxy test target" value={testTarget} disabled={Boolean(testingGroupId) || testingIds.size > 0} onChange={(event) => { setTestTarget(event.target.value as ProxyTestTarget); setTestResults(new Map()); }}><option value="pokemon_center">Pokémon Center</option><option value="google">Google</option><option value="cloudflare">Cloudflare</option></select></label><button className="manager-action" disabled={!proxies.length || Boolean(testingGroupId) || testingIds.size > 0} onClick={() => void testAll()}><Gauge size={14} />{testingGroupId === selectedGroupId ? `Testing ${proxies.length.toLocaleString()}…` : testingGroupId || testingIds.size > 0 ? "Test in progress" : "Test all"}</button><button className="manager-action danger" disabled={!proxies.length || Boolean(testingGroupId)} onClick={() => setDeleteTarget("proxies")}><Trash2 size={14} />Delete all</button></>} />
    <div className="manager-columns proxy-columns"><span>Proxy</span><span>Protocol</span><span>Authentication</span><span>Speed</span><span>Actions</span></div>{proxies.length ? <VirtualProxyRows proxies={proxies} groupId={selectedGroupId} testResults={testResults} testingIds={testingIds} testingGroupId={testingGroupId} testTarget={testTarget} onTest={testOne} onDelete={deleteOneProxy} /> : <div className="manager-rows">{selectedGroup ? <Empty icon={<Server />} title="No proxies" action="Add proxies" onAction={() => setCreatingProxies(true)} /> : <Empty icon={<Server />} title="Create a proxy group" />}</div>}
  </section>{creatingGroup && <GroupNameForm title="Add proxy group" onCancel={() => setCreatingGroup(false)} onSave={addGroup} />}{creatingProxies && selectedGroup && <BulkProxyForm groupId={selectedGroup.id} onCancel={() => setCreatingProxies(false)} onSave={addProxies} />}{deleteTarget === "proxies" && selectedGroup && <DeleteConfirmModal title={`Delete all ${proxies.length} proxies?`} body={`This removes every proxy in ${selectedGroup.name}. Tasks using them will switch to Localhost.`} confirmLabel="Delete all proxies" onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteProxies(false)} />}{deleteTarget === "group" && selectedGroup && <DeleteConfirmModal title={`Delete ${selectedGroup.name}?`} body={`This removes the proxy group and all ${proxies.length} proxies inside it.`} confirmLabel="Delete group" onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteProxies(true)} />}</div>;
}

const proxyRowHeight = 65;
const proxyRowOverscan = 8;

function VirtualProxyRows({ proxies, groupId, testResults, testingIds, testingGroupId, testTarget, onTest, onDelete }: { proxies: ProxyConfig[]; groupId: string; testResults: Map<string, ProxyTestResult>; testingIds: Set<string>; testingGroupId: string | null; testTarget: ProxyTestTarget; onTest: (proxy: ProxyConfig) => void; onDelete: (proxyId: string) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight || 600);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setScrollTop(0); if (viewport.current) viewport.current.scrollTop = 0; }, [groupId]);
  const range = useMemo(() => getVirtualRange(proxies.length, scrollTop, viewportHeight, proxyRowHeight, proxyRowOverscan), [proxies.length, scrollTop, viewportHeight]);
  const visible = proxies.slice(range.start, range.end);
  return <div ref={viewport} className="manager-rows virtual-proxy-rows" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} data-total-rows={proxies.length} data-rendered-rows={visible.length}>
    <div className="virtual-proxy-spacer" style={{ height: proxies.length * proxyRowHeight }}>
      <div className="virtual-proxy-window" style={{ transform: `translateY(${range.start * proxyRowHeight}px)` }}>
        {visible.map((proxy) => <ProxyTableRow key={proxy.id} proxy={proxy} result={testResults.get(proxy.id)} testing={testingGroupId === proxy.groupId || testingIds.has(proxy.id)} testDisabled={Boolean(testingGroupId) || testingIds.has(proxy.id)} deleteDisabled={Boolean(testingGroupId)} testTarget={testTarget} onTest={() => onTest(proxy)} onDelete={() => onDelete(proxy.id)} />)}
      </div>
    </div>
  </div>;
}

function ProxyTableRow({ proxy, result, testing, testDisabled, deleteDisabled, testTarget, onTest, onDelete }: { proxy: ProxyConfig; result?: ProxyTestResult; testing: boolean; testDisabled: boolean; deleteDisabled: boolean; testTarget: ProxyTestTarget; onTest: () => void; onDelete: () => void }) {
  const statusClass = testing ? "testing" : result?.status ?? "idle";
  const statusText = testing ? "Testing…" : result?.status === "working" && result.latencyMs != null ? `${result.latencyMs} ms` : result ? "Failed" : "—";
  const targetLabel = testTarget === "pokemon_center" ? "Pokémon Center" : testTarget === "google" ? "Google" : "Cloudflare";
  return <div className="manager-row proxy-columns"><div><b>{proxy.name}</b><small>{proxy.host}:{proxy.port}</small></div><span>{proxy.protocol.toUpperCase()}</span><div><b>{proxy.username || "None"}</b><small>{proxy.username ? "Login" : "Open"}</small></div><span className={`status ${statusClass}`} title={result?.message}>{statusText}</span><div className="table-actions"><button title={`Test proxy on ${targetLabel}`} aria-label={`Test proxy ${proxy.name}`} disabled={testDisabled} onClick={onTest}><Gauge size={14} /></button><button title="Delete proxy" aria-label={`Delete proxy ${proxy.name}`} disabled={deleteDisabled} onClick={onDelete}><Trash2 size={14} /></button></div></div>;
}

function ProxiesLegacy({ data, save }: { data: AppData; save: (data: AppData) => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const add = (proxy: ProxyConfig) => { void save({ ...data, proxies: [...data.proxies, proxy] }); setCreating(false); };
  if (true) return <div className="manager-shell"><ManagerSidebar title="Proxy groups" total={data.proxies.length} icon={<Server />} groupName="Static routes" meta={`${data.proxies.length} proxies`} addLabel="Create proxy" onAdd={() => setCreating(true)} /><section className="manager-main"><ManagerHeader title="Static routes" count={`${data.proxies.length} proxies`} onAdd={() => setCreating(true)} />
    <div className="manager-columns proxy-columns"><span>Proxy</span><span>Protocol</span><span>Authentication</span><span>Status</span><span>Actions</span></div><div className="manager-rows">{data.proxies.map((proxy) => <div className="manager-row proxy-columns" key={proxy.id}><div><b>{proxy.name}</b><small>{proxy.host}:{proxy.port}</small></div><span>{proxy.protocol.toUpperCase()}</span><div><b>{proxy.username || "None"}</b><small>{proxy.username ? "Login" : "Open"}</small></div><span className="status idle">Not tested</span><div className="table-actions"><button title="Delete proxy" aria-label={`Delete ${proxy.name}`} onClick={() => void save({ ...data, proxies: data.proxies.filter((item) => item.id !== proxy.id) })}><Trash2 size={14} /></button></div></div>)}{!data.proxies.length && <Empty icon={<Server />} title="No proxies" action="Add proxy" onAction={() => setCreating(true)} />}</div>
  </section>{creating && <ProxyForm onCancel={() => setCreating(false)} onSave={add} />}</div>;
  return <><Title title="Proxies" subtitle="Add and organize authenticated network routes." action={<button className="primary" onClick={() => setCreating(true)}><Plus size={17} />Add proxy</button>} />{creating && <ProxyForm onCancel={() => setCreating(false)} onSave={add} />}<CardGrid>{data.proxies.map((proxy) => <InfoCard key={proxy.id} title={proxy.name} lines={[`${proxy.protocol}://${proxy.host}:${proxy.port}`, proxy.username ? `Authenticated as ${proxy.username}` : "No authentication", "Static proxy"]} onDelete={() => void save({ ...data, proxies: data.proxies.filter((item) => item.id !== proxy.id) })} />)}</CardGrid>{!data.proxies.length && !creating && <Empty icon={<Server />} title="Localhost (no proxy)" body="No optional proxies are configured." action="Add proxy" onAction={() => setCreating(true)} />}</>;
}

function ChallengeCenter({ data, save }: { data: AppData; save: (data: AppData) => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [contextMenu, setContextMenu] = useState<(ContextPoint & { harvesterId: string }) | null>(null);
  const [editingHarvester, setEditingHarvester] = useState<Harvester | null>(null);
  const [deleteHarvester, setDeleteHarvester] = useState<Harvester | null>(null);
  const waiting = data.tasks.filter((task) => task.status === "awaiting_user" && task.challengeStatus !== "solved");
  const queuedCount = waiting.filter((task) => task.challengeStatus !== "assigned").length;
  const assignedCount = waiting.filter((task) => task.challengeStatus === "assigned").length;
  const add = (harvester: Harvester) => { void save({ ...data, harvesters: [...data.harvesters, harvester] }); setCreating(false); };
  const remove = async (harvester: Harvester) => {
    await window.brava.harvesters.close(harvester.id);
    const current = await window.brava.data.load();
    await save({ ...current, harvesters: current.harvesters.filter((item) => item.id !== harvester.id) });
  };
  const deleteAll = async () => {
    await window.brava.harvesters.closeAll();
    const current = await window.brava.data.load();
    await save({ ...current, harvesters: [] });
    setConfirmDeleteAll(false);
  };
  const duplicate = (harvester: Harvester) => {
    const now = new Date().toISOString();
    const copy: Harvester = { ...harvester, id: crypto.randomUUID(), name: `${harvester.name} copy`, status: "idle", statusMessage: "Ready to open", solveCount: 0, assignedRequestId: undefined, assignedTaskId: undefined, createdAt: now, updatedAt: now };
    void save({ ...data, harvesters: [...data.harvesters, copy] });
  };
  const update = (harvester: Harvester) => {
    void save({ ...data, harvesters: data.harvesters.map((item) => item.id === harvester.id ? harvester : item) });
    setEditingHarvester(null);
  };
  const openCount = data.harvesters.filter((harvester) => ["open", "opening", "busy"].includes(harvester.status)).length;
  const contextHarvester = data.harvesters.find((harvester) => harvester.id === contextMenu?.harvesterId);
  return <div className="manager-shell challenge-manager">
    <ManagerSidebar title="Harvesters" total={data.harvesters.length} icon={<ShieldCheck />} groupName="Harvesters" meta={`${openCount} open`} addLabel="Create harvester" onAdd={() => setCreating(true)} />
    <section className="manager-main">
      <ManagerHeader title="Harvesters" count={`${data.harvesters.length} total · ${openCount} open · ${queuedCount} queued`} onAdd={() => setCreating(true)} actions={<>
        <button className="manager-action play" disabled={!data.harvesters.length} onClick={() => void window.brava.harvesters.openAll()}><Play size={14} />Open all</button>
        <button className="manager-action" disabled={!openCount} onClick={() => void window.brava.harvesters.closeAll()}><Square size={13} />Close all</button>
        <button className="manager-action danger" disabled={!data.harvesters.length} onClick={() => setConfirmDeleteAll(true)}><Trash2 size={14} />Delete all</button>
      </>} />
      <div className="manager-columns harvester-columns"><span>Harvester</span><span>Site</span><span>Solved</span><span>Status</span><span>Actions</span></div>
      <div className="manager-rows harvester-rows">
        {data.harvesters.map((harvester) => {
          const active = ["open", "opening", "busy"].includes(harvester.status);
          const assignedTask = data.tasks.find((task) => task.id === harvester.assignedTaskId);
          const statusLabel = harvester.status === "busy" ? "Assigned" : harvester.status === "opening" ? "Opening" : harvester.status === "open" ? "Open" : harvester.status === "error" ? "Error" : "Idle";
          return <div className={`manager-row harvester-columns ${contextMenu?.harvesterId === harvester.id ? "context-selected" : ""}`} key={harvester.id} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ harvesterId: harvester.id, x: event.clientX, y: event.clientY }); }}>
            <div><b>{harvester.name}</b><small>{assignedTask ? assignedTask.name : harvester.openOnLaunch ? "On launch" : "On demand"}</small></div>
            <div><b>Pokémon Center</b><small>{harvesterProxyLabel(harvester.proxy)}</small></div>
            <div><b>{harvester.solveCount}</b><small>Solved</small></div>
            <span className={`status ${harvester.status === "error" ? "error" : harvester.status === "busy" ? "awaiting_user" : active ? "monitoring" : "idle"}`}>{statusLabel}</span>
            <div className="table-actions">
              {active ? <button title="Close harvester" onClick={() => void window.brava.harvesters.close(harvester.id)}><Square size={13} /></button> : <button className="review" title="Open harvester" onClick={() => void window.brava.harvesters.open(harvester.id)}><ExternalLink size={14} /></button>}
              {harvester.assignedTaskId && <button title="Mark assigned challenge solved" onClick={() => void window.brava.harvesters.markSolved(harvester.id)}><Check size={14} /></button>}
              <button title="Delete harvester" aria-label={`Delete harvester ${harvester.name}`} onClick={() => void remove(harvester)}><Trash2 size={14} /></button>
            </div>
          </div>;
        })}
        {!data.harvesters.length && <Empty icon={<ShieldCheck />} title="No harvesters" action="Create harvester" onAction={() => setCreating(true)} />}
      </div>
      {waiting.length > 0 && <>
        <div className="challenge-section-title"><div><b>Challenge queue</b><span>{queuedCount} queued · {assignedCount} assigned</span></div></div>
        <div className="manager-columns challenge-columns"><span>Task</span><span>Harvester</span><span>Route</span><span>Status</span><span>Open</span></div>
        <div className="manager-rows linked-challenge-rows">{waiting.map((task) => {
          const assignedHarvester = data.harvesters.find((harvester) => harvester.id === task.assignedHarvesterId);
          const assigned = task.challengeStatus === "assigned";
          return <div className="manager-row challenge-columns" key={task.id}>
            <div><b>{task.name}</b><small>{task.sku || task.productUrl || "Waiting"}</small></div>
            <span>{assignedHarvester?.name ?? "Next available"}</span>
            <span>{data.proxies.find((proxy) => proxy.id === task.proxyId)?.name ?? "Localhost (no proxy)"}</span>
            <span className={`status ${assigned ? "monitoring" : "awaiting_user"}`}>{assigned ? "Assigned" : "Queued"}</span>
            <button className="manager-action play" onClick={() => void window.brava.tasks.review(task.id)}><ExternalLink size={14} />{assigned ? "Focus" : "Queue"}</button>
          </div>;
        })}</div>
      </>}
    </section>
    {creating && <HarvesterForm onCancel={() => setCreating(false)} onSave={add} />}
    {editingHarvester && <HarvesterForm initial={editingHarvester} title="Edit harvester" onCancel={() => setEditingHarvester(null)} onSave={update} />}
    {contextMenu && contextHarvester && <ContextMenuSurface x={contextMenu.x} y={contextMenu.y} label={`Actions for ${contextHarvester.name}`} eyebrow="Harvester" title={contextHarvester.name} onClose={() => setContextMenu(null)}>
      <MenuButton icon={<Play size={14} />} disabled={["open", "opening", "busy"].includes(contextHarvester.status)} onClick={() => { void window.brava.harvesters.open(contextHarvester.id); setContextMenu(null); }}>Start</MenuButton>
      <MenuButton icon={<Square size={13} />} disabled={!['open', 'opening', 'busy'].includes(contextHarvester.status)} onClick={() => { void window.brava.harvesters.close(contextHarvester.id); setContextMenu(null); }}>Stop</MenuButton>
      <MenuButton icon={<RotateCcw size={14} />} disabled={!contextHarvester.assignedTaskId} title={contextHarvester.assignedTaskId ? "Reload the assigned CAPTCHA" : "No task has assigned a CAPTCHA"} onClick={() => { void window.brava.harvesters.reloadCaptcha(contextHarvester.id); setContextMenu(null); }}>Reload CAPTCHA</MenuButton>
      <MenuButton icon={<ChevronRight size={14} />} disabled={!contextHarvester.assignedTaskId} title={contextHarvester.assignedTaskId ? "Open the real task-assigned CAPTCHA" : "Available when a task assigns a CAPTCHA"} onClick={() => { void window.brava.harvesters.testCaptcha(contextHarvester.id); setContextMenu(null); }}>Test CAPTCHA</MenuButton>
      <MenuSeparator />
      <MenuButton icon={<Copy size={14} />} onClick={() => { duplicate(contextHarvester); setContextMenu(null); }}>Duplicate</MenuButton>
      <MenuButton icon={<Pencil size={14} />} onClick={() => { setEditingHarvester(contextHarvester); setContextMenu(null); }}>Edit</MenuButton>
      <MenuSeparator />
      <MenuButton icon={<Trash2 size={14} />} danger onClick={() => { setDeleteHarvester(contextHarvester); setContextMenu(null); }}>Delete</MenuButton>
    </ContextMenuSurface>}
    {confirmDeleteAll && <DeleteConfirmModal title={`Delete all ${data.harvesters.length} harvesters?`} body="Any open harvester windows will close before they are removed." confirmLabel="Delete all harvesters" onCancel={() => setConfirmDeleteAll(false)} onConfirm={deleteAll} />}
    {deleteHarvester && <DeleteConfirmModal title={`Delete ${deleteHarvester.name}?`} body="Its window will close before the harvester is removed." confirmLabel="Delete harvester" onCancel={() => setDeleteHarvester(null)} onConfirm={async () => { await remove(deleteHarvester); setDeleteHarvester(null); }} />}
  </div>;
}

function HarvesterForm({ onCancel, onSave, initial, title = "New harvester" }: { onCancel: () => void; onSave: (harvester: Harvester) => void; initial?: Harvester; title?: string }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [proxy, setProxy] = useState(initial?.proxy ?? "");
  const [error, setError] = useState("");
  const [openOnLaunch, setOpenOnLaunch] = useState(initial?.openOnLaunch ?? false);
  return <FormCard title={title} onSubmit={(event) => { event.preventDefault(); try { parseHarvesterProxy(proxy); setError(""); } catch (value) { setError(value instanceof Error ? value.message : "Invalid proxy"); return; } const now = new Date().toISOString(); onSave(initial ? { ...initial, name: name.trim(), proxy: proxy.trim(), openOnLaunch, updatedAt: now } : { id: crypto.randomUUID(), name: name.trim(), proxy: proxy.trim(), status: "idle", statusMessage: "Ready to open", solveCount: 0, openOnLaunch, createdAt: now, updatedAt: now }); }} onCancel={onCancel}><Field label="Name"><input required autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Harvester 1" /></Field><Field label="Proxy"><input value={proxy} onChange={(event) => { setProxy(event.target.value); if (error) setError(""); }} placeholder="Blank for localhost · host:port:user:password" /></Field><label className="check-field"><input type="checkbox" checked={openOnLaunch} onChange={(event) => setOpenOnLaunch(event.target.checked)} /><span>Open on launch</span></label>{error && <span className="form-error">{error}</span>}</FormCard>;
}

function SettingsWorkspace({ session, data, save, monitor, onDeactivated }: { session: LicenseSession; data: AppData; save: (data: AppData) => Promise<void>; monitor: MonitorState; onDeactivated: () => void }) {
  const [device, setDevice] = useState<{ deviceId: string; deviceName: string }>();
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [showLicenseKey, setShowLicenseKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState("");
  const [pendingImport, setPendingImport] = useState<{ name: string; data: AppData } | null>(null);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  useEffect(() => {
    void window.brava.license.device().then(setDevice);
    void window.brava.license.key().then(setLicenseKey);
  }, []);
  const exportData = () => { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `brava-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); };
  const chooseBackup = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.onchange = () => void (async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBackupMessage(""); setBackupError("");
      try { setPendingImport({ name: file.name, data: validateAppData(JSON.parse(await file.text())) }); }
      catch (cause) { setBackupError(cause instanceof Error ? cause.message : "Could not read this backup."); }
    })();
    input.click();
  };
  const restoreBackup = async () => {
    if (!pendingImport) return;
    try {
      await save(pendingImport.data);
      setBackupMessage(`Imported ${pendingImport.name} successfully.`);
      setBackupError(""); setPendingImport(null);
    } catch (cause) { setBackupError(cleanIpcError(cause, "Could not import this backup.")); setPendingImport(null); }
  };
  const copyLicenseKey = async () => {
    if (!await window.brava.license.copyKey()) return;
    setCopiedKey(true);
    window.setTimeout(() => setCopiedKey(false), 1500);
  };
  const deactivateDevice = async () => {
    setDeactivating(true); setDeactivateError("");
    try { await window.brava.license.deactivate(API_URL); onDeactivated(); }
    catch (cause) { const message = cause instanceof Error ? cause.message : "Could not deactivate this device"; setDeactivateError(message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "")); }
    finally { setDeactivating(false); }
  };
  const maskedLicenseKey = licenseKey?.replace(/[A-Z0-9]/gi, "•") ?? "Loading…";
  return <>
    <Title title="Settings" />
    <div className="settings-workspace">
      <div className="settings-column">
        <section className="license-card"><div className="license-banner" /><div className="license-body"><div className="settings-avatar"><BrandLogo /></div><span className="eyebrow">LICENSE</span><h2>{session.label}</h2><Setting label="Expiration" value={session.expiresAt ? new Date(session.expiresAt).toLocaleDateString() : "No expiration"} /><Setting label="Device" value={device?.deviceName ?? "Loading…"} /><section className="license-key-row"><div className="license-key-copy"><KeyRound size={15} /><div><span>License key</span><code>{showLicenseKey ? (licenseKey ?? "Unavailable") : maskedLicenseKey}</code></div></div><div className="license-key-actions"><button type="button" title={showLicenseKey ? "Hide license key" : "Reveal license key"} aria-label={showLicenseKey ? "Hide license key" : "Reveal license key"} disabled={!licenseKey} onClick={() => setShowLicenseKey((visible) => !visible)}>{showLicenseKey ? <EyeOff size={14} /> : <Eye size={14} />}</button><button type="button" title="Copy license key" aria-label="Copy license key" disabled={!licenseKey} onClick={() => void copyLicenseKey()}>{copiedKey ? <Check size={14} /> : <Copy size={14} />}</button></div></section><section className="license-device-actions"><div><b>{confirmingDeactivate ? "Deactivate device?" : "Device access"}</b><span>{confirmingDeactivate ? "Brava will return to the key screen." : "Sign out on this computer."}</span>{deactivateError && <small>{deactivateError}</small>}</div><div>{confirmingDeactivate ? <><button className="ghost" disabled={deactivating} onClick={() => setConfirmingDeactivate(false)}>Cancel</button><button className="danger-action" disabled={deactivating} onClick={() => void deactivateDevice()}>{deactivating ? "Deactivating…" : "Deactivate"}</button></> : <button className="ghost" onClick={() => setConfirmingDeactivate(true)}><KeyRound size={14} />Deactivate</button>}</div></section></div></section>
        <StatusPanel title="Task engine" detail={`${data.tasks.length} tasks`} />
        <MonitorStrip monitor={monitor} compact />
      </div>
      <div className="settings-column">
        <UpdatePanel />
        <section className="panel backup-panel"><div><h2>Backup</h2>{backupMessage && <span className="backup-feedback success">{backupMessage}</span>}{backupError && <span className="backup-feedback error">{backupError}</span>}</div><div className="backup-actions"><button className="ghost" onClick={chooseBackup}>Import</button><button className="primary" onClick={exportData}>Export</button></div></section>
      </div>
    </div>
    {pendingImport && createPortal(<div className="modal-backdrop" onMouseDown={() => setPendingImport(null)}><section className="panel import-confirm-card" onMouseDown={(event) => event.stopPropagation()}><h2>Import backup?</h2><p><b>{pendingImport.name}</b> · {pendingImport.data.tasks.length} tasks · {pendingImport.data.profiles.length} profiles</p><div className="form-actions"><button className="ghost" onClick={() => setPendingImport(null)}>Cancel</button><button className="primary" onClick={() => void restoreBackup()}>Import</button></div></section></div>, document.body)}
  </>;
}

function UpdatePanel() {
  const [update, setUpdate] = useState<UpdateState>({ status: "idle", currentVersion: "…", message: "Ready to check." });
  useEffect(() => { void window.brava.updates.state().then(setUpdate); return window.brava.updates.onState(setUpdate); }, []);
  const busy = update.status === "checking" || update.status === "downloading";
  const action = update.status === "downloaded"
    ? <button className="primary" onClick={() => void window.brava.updates.install()}>Update and restart</button>
    : update.status === "available"
      ? <button className="primary" onClick={() => void window.brava.updates.download()}>Download update</button>
      : <button className="ghost" disabled={busy} onClick={() => void window.brava.updates.check()}>{update.status === "checking" ? "Checking…" : update.status === "downloading" ? `Downloading ${update.percent ?? 0}%` : "Check for updates"}</button>;
  return <><section className={`panel update-panel ${update.status}`}><div className="update-copy"><span className="eyebrow">UPDATES</span><div className="update-title-row"><h2>{update.status === "downloaded" ? "Ready to install" : update.status === "available" ? "Update available" : update.status === "current" ? "Up to date" : update.status === "error" ? "Update unavailable" : "Updates"}</h2><code>Installed v{update.currentVersion}</code></div><p>{update.message}{update.version && update.version !== update.currentVersion ? ` · Latest v${update.version}` : ""}</p>{update.status === "downloading" && <div className="update-progress"><span style={{ width: `${update.percent ?? 0}%` }} /></div>}</div><div className="update-actions">{action}</div></section><WebhookPanel /></>;
}

function WebhookPanel() {
  const [settings, setSettings] = useState<WebhookSettings>({ successUrl: "", declineUrl: "", successEnabled: true, declineEnabled: true });
  const [busy, setBusy] = useState<"save" | "success" | "decline" | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { void window.brava.webhooks.get().then(setSettings); }, []);
  const save = async () => {
    setBusy("save"); setMessage(""); setError("");
    try { setSettings(await window.brava.webhooks.save(settings)); setMessage("Webhook settings saved."); }
    catch (cause) { setError(cleanIpcError(cause, "Could not save webhook settings.")); }
    finally { setBusy(""); }
  };
  const test = async (kind: "success" | "decline") => {
    setBusy(kind); setMessage(""); setError("");
    try {
      setSettings(await window.brava.webhooks.save(settings));
      await window.brava.webhooks.test(kind);
      setMessage(`${kind === "success" ? "Checkout" : "Decline"} test sent to Discord.`);
    } catch (cause) { setError(cleanIpcError(cause, "Could not send the Discord webhook.")); }
    finally { setBusy(""); }
  };
  return <section className="panel webhook-panel"><div className="panel-head"><div><h2>Discord webhooks</h2></div><button className="primary" disabled={Boolean(busy)} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save"}</button></div><div className="webhook-fields"><div className="webhook-row"><label><span>Checkout</span><input type="url" value={settings.successUrl} onChange={(event) => setSettings({ ...settings, successUrl: event.target.value })} placeholder="https://discord.com/api/webhooks/…" /></label><label className="webhook-toggle"><input type="checkbox" checked={settings.successEnabled} onChange={(event) => setSettings({ ...settings, successEnabled: event.target.checked })} /><span>Enabled</span></label><button className="ghost" disabled={Boolean(busy) || !settings.successUrl.trim()} onClick={() => void test("success")}>{busy === "success" ? "Sending…" : "Test"}</button></div><div className="webhook-row"><label><span>Decline</span><input type="url" value={settings.declineUrl} onChange={(event) => setSettings({ ...settings, declineUrl: event.target.value })} placeholder="https://discord.com/api/webhooks/…" /></label><label className="webhook-toggle"><input type="checkbox" checked={settings.declineEnabled} onChange={(event) => setSettings({ ...settings, declineEnabled: event.target.checked })} /><span>Enabled</span></label><button className="ghost" disabled={Boolean(busy) || !settings.declineUrl.trim()} onClick={() => void test("decline")}>{busy === "decline" ? "Sending…" : "Test"}</button></div></div>{message && <div className="webhook-feedback success">{message}</div>}{error && <div className="webhook-feedback error">{error}</div>}</section>;
}

function cleanIpcError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : fallback;
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

function StatusPanel({ title, detail }: { title: string; detail: string }) { return <section className="status-panel"><div><b>{title}</b><span>{detail}</span></div><strong>READY <span className="live-dot" /></strong></section>; }
function ManagerSidebar({ title, total, icon, groupName, meta, addLabel, onAdd }: { title: string; total: number; icon: ReactNode; groupName: string; meta: string; addLabel: string; onAdd: () => void }) { return <aside className="manager-sidebar"><div className="manager-side-title"><div><h2>{title}</h2><span>{total} total</span></div><button title={addLabel} aria-label={addLabel} onClick={onAdd}><Plus size={16} /></button></div><div className="group-card active"><div>{icon}</div><span><b>{groupName}</b><small>{meta}</small></span></div></aside>; }
function ResourceGroupSidebar({ title, groups, selectedId, icon, itemLabel, items, onSelect, onAdd, onRename, onDuplicate, onDeleteAll, onDelete }: { title: string; groups: ResourceGroup[]; selectedId: string; icon: ReactNode; itemLabel: string; items: Array<{ groupId?: string }>; onSelect: (id: string) => void; onAdd: () => void; onRename: (id: string, name: string) => void; onDuplicate: (id: string) => void; onDeleteAll: (id: string) => void; onDelete: (id: string) => void }) {
  const [menu, setMenu] = useState<(ContextPoint & { groupId: string }) | null>(null);
  const [renaming, setRenaming] = useState(false);
  const group = groups.find((item) => item.id === menu?.groupId);
  const [name, setName] = useState("");
  const close = () => { setMenu(null); setRenaming(false); };
  const open = (event: ReactMouseEvent, groupId: string) => { event.preventDefault(); const current = groups.find((item) => item.id === groupId); onSelect(groupId); setName(current?.name ?? ""); setRenaming(false); setMenu({ groupId, x: event.clientX, y: event.clientY }); };
  return <aside className="manager-sidebar"><div className="manager-side-title"><div><h2>{title}</h2><span>{groups.length} total</span></div><button title={`Add ${title.toLowerCase().replace(/s$/, "")}`} onClick={onAdd}><Plus size={16} /></button></div><div className="resource-group-list">{groups.map((item) => { const count = items.filter((entry) => entry.groupId === item.id).length; const active = selectedId === item.id; return <div key={item.id} className={`group-card group-card-with-delete ${active ? "active" : ""}`} onContextMenu={(event) => open(event, item.id)}><button className="group-card-select" onClick={() => onSelect(item.id)}><div>{icon}</div><span><b>{item.name}</b><small>{count} {itemLabel}</small></span></button>{active && <button className="group-card-delete" aria-label={`Delete group ${item.name}`} title="Delete group" onClick={() => onDelete(item.id)}><Trash2 size={13} /></button>}</div>; })}</div>
    {menu && group && <ContextMenuSurface x={menu.x} y={menu.y} label={`Actions for ${group.name}`} eyebrow={title.replace(/s$/i, "")} title={group.name} onClose={close}>
      {renaming ? <div className="context-rename"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) { onRename(group.id, name.trim()); close(); } }} /><div><button onClick={() => setRenaming(false)}>Cancel</button><button className="save" disabled={!name.trim()} onClick={() => { onRename(group.id, name.trim()); close(); }}>Save</button></div></div> : <>
        <MenuButton icon={<Pencil size={14} />} onClick={() => setRenaming(true)}>Edit group</MenuButton>
        <MenuButton icon={<Copy size={14} />} onClick={() => { onDuplicate(group.id); close(); }}>Duplicate</MenuButton>
        <MenuSeparator />
        <MenuButton icon={<Trash2 size={14} />} danger disabled={!items.some((entry) => entry.groupId === group.id)} onClick={() => { onDeleteAll(group.id); close(); }}>Delete all</MenuButton>
        <MenuButton icon={<Trash2 size={14} />} danger onClick={() => { onDelete(group.id); close(); }}>Delete group</MenuButton>
      </>}
    </ContextMenuSurface>}
  </aside>;
}
function ManagerHeader({ title, count, site, onAdd, addDisabled = false, leadingActions, actions }: { title: string; count: string; site?: SiteId; onAdd?: () => void; addDisabled?: boolean; leadingActions?: ReactNode; actions?: ReactNode }) { return <header className="manager-header"><div className="manager-heading">{site && <SiteMark site={site} tiny />}<div><h1>{title}</h1><span>{count}</span></div></div><div className="manager-header-actions">{leadingActions}{onAdd && <button className="primary" disabled={addDisabled} onClick={onAdd}><Plus size={15} />Create</button>}{actions}</div></header>; }

function DeleteConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    setBusy(true);
    setError("");
    try { await onConfirm(); }
    catch (cause) { setError(cleanIpcError(cause, "Could not delete these items.")); setBusy(false); }
  };
  return createPortal(<div className="modal-backdrop delete-confirm-backdrop" onMouseDown={() => !busy && onCancel()}><section className="panel delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" onMouseDown={(event) => event.stopPropagation()}><div className="delete-confirm-icon"><Trash2 size={18} /></div><h2 id="delete-confirm-title">{title}</h2><p>{body}</p>{error && <span className="form-error">{error}</span>}<div className="form-actions"><button className="ghost" disabled={busy} onClick={onCancel}>Cancel</button><button className="danger-action" disabled={busy} onClick={() => void confirm()}>{busy ? "Deleting…" : confirmLabel}</button></div></section></div>, document.body);
}

function GroupNameForm({ title, onCancel, onSave, initialName = "" }: { title: string; onCancel: () => void; onSave: (group: ResourceGroup) => void; initialName?: string }) {
  const [name, setName] = useState(initialName);
  return <FormCard title={title} onSubmit={(event) => { event.preventDefault(); onSave({ id: crypto.randomUUID(), name: name.trim() }); }} onCancel={onCancel}><Field label="Group name"><input required autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter name" /></Field></FormCard>;
}

function BulkProxyForm({ groupId, onCancel, onSave }: { groupId: string; onCancel: () => void; onSave: (proxies: ProxyConfig[]) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) throw new Error("Paste at least one proxy.");
      const proxies = lines.map((line, index): ProxyConfig => {
        let protocol: "http" | "https" = "http"; let host = ""; let port = 0; let username = ""; let password = "";
        if (/^https?:\/\//i.test(line)) { const url = new URL(line); protocol = url.protocol === "https:" ? "https" : "http"; host = url.hostname; port = Number(url.port || (protocol === "https" ? 443 : 80)); username = decodeURIComponent(url.username); password = decodeURIComponent(url.password); }
        else { const parts = line.split(":"); if (parts.length < 2) throw new Error(`Line ${index + 1} must use host:port or host:port:user:password.`); host = parts[0] ?? ""; port = Number(parts[1]); username = parts[2] ?? ""; password = parts.slice(3).join(":"); }
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Line ${index + 1} has an invalid host or port.`);
        return { id: crypto.randomUUID(), groupId, name: `${host}:${port}`, protocol, host, port, username, password };
      });
      onSave(proxies);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read these proxies."); }
  };
  return <FormCard title="Add proxies" submitLabel="Save" onSubmit={submit} onCancel={onCancel}><label className="proxy-paste-field"><span>Proxies</span><textarea required autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={'host:port\nhost:port:username:password\nhttp://username:password@host:port'} /></label>{error && <span className="form-error proxy-form-error">{error}</span>}</FormCard>;
}

function ProxyForm({ onCancel, onSave }: { onCancel: () => void; onSave: (proxy: ProxyConfig) => void }) {
  const [form, setForm] = useState<Omit<ProxyConfig, "id">>({ name: "", protocol: "https", host: "", port: 443, username: "", password: "" });
  return <FormCard title="Add static route" onSubmit={(event) => { event.preventDefault(); onSave({ id: crypto.randomUUID(), ...form }); }} onCancel={onCancel}><Field label="Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Protocol"><select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value as "http" | "https" })}><option>https</option><option>http</option></select></Field><Field label="Host"><input required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></Field><Field label="Port"><input required type="number" min="1" max="65535" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></Field><Field label="Username"><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field><Field label="Password"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field></FormCard>;
}

function SettingsPage({ session }: { session: LicenseSession }) { const [device, setDevice] = useState<{ deviceId: string; deviceName: string }>(); useEffect(() => { void window.brava.license.device().then(setDevice); }, []); return <><Title title="Settings" subtitle="License and device details." /><section className="panel settings-list"><Setting label="License" value={session.label} /><Setting label="Expires" value={session.expiresAt ? new Date(session.expiresAt).toLocaleDateString() : "No expiration"} /><Setting label="Device" value={device?.deviceName ?? "Loading…"} /><Setting label="Device ID" value={device?.deviceId ?? "Loading…"} /><Setting label="API" value={API_URL} /></section></>; }
function Setting({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><code>{value}</code></div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function FormSection({ title, note }: { title: string; note?: string }) { return <div className="form-section"><b>{title}</b>{note && <span>{note}</span>}</div>; }
function FormCard({ title, submitLabel = "Create", onSubmit, onCancel, children }: { title: string; submitLabel?: string; onSubmit: (event: FormEvent) => void; onCancel: () => void; children: ReactNode }) { return createPortal(<div className="modal-backdrop" onMouseDown={onCancel}><form className="form-card modal-card" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><div className="panel-head"><div><h2>{title}</h2></div><button type="button" className="modal-close" onClick={onCancel}>×</button></div><div className="form-grid">{children}</div><div className="form-actions"><button className="ghost" type="button" onClick={onCancel}>Cancel</button><button className="primary" type="submit">{submitLabel}</button></div></form></div>, document.body); }
function CardGrid({ children }: { children: ReactNode }) { return <div className="card-grid">{children}</div>; }
function InfoCard({ title, lines, onDelete }: { title: string; lines: string[]; onDelete: () => void }) { return <article className="info-card"><div className="info-top"><div className="profile-monogram">{title.slice(0, 2).toUpperCase()}</div><button title={`Delete ${title}`} aria-label={`Delete ${title}`} onClick={onDelete}><Trash2 size={16} /></button></div><h3>{title}</h3>{lines.map((line) => <p key={line}>{line}</p>)}</article>; }
function Empty({ icon, title, body, action, onAction }: { icon: ReactNode; title: string; body?: string; action?: string; onAction?: () => void }) { return <div className="empty"><div>{icon}</div><h3>{title}</h3>{body && <p>{body}</p>}{action && onAction && <button className="ghost" onClick={onAction}>{action}<ChevronRight size={16} /></button>}</div>; }
