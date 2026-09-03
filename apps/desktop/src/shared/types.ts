export type Profile = {
  id: string;
  groupId?: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  address1: string;
  address2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
  payment?: {
    cardholderName: string;
    brand: "Visa" | "Mastercard" | "Amex" | "Discover" | "Other";
    last4: string;
    /** Full card number, stored encrypted at rest; only ever typed into the official checkout page. */
    number?: string;
    expiryMonth: string;
    expiryYear: string;
    /** Security code, stored encrypted at rest; only ever typed into the official checkout page. */
    cvv?: string;
    billingSameAsShipping: boolean;
  };
  billing?: {
    firstName: string;
    lastName: string;
    address1: string;
    address2: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  };
};

export type ProxyConfig = {
  id: string;
  groupId?: string;
  name: string;
  protocol: "http" | "https";
  host: string;
  port: number;
  username: string;
  password: string;
};

export type ProxyTestResult = {
  proxyId: string;
  status: "working" | "failed";
  latencyMs?: number;
  message: string;
};

export type ProxyTestTarget = "pokemon_center" | "google" | "cloudflare";

export type ResourceGroup = { id: string; name: string };

export type TaskStatus = "idle" | "queued" | "monitoring" | "found" | "adding_to_cart" | "carted" | "awaiting_user" | "completed" | "declined" | "stopped" | "error";

export type TaskEvent = {
  status: TaskStatus;
  message: string;
  at: string;
};

export type ProductSignal = {
  sequence: number;
  id: string;
  site: "pokemon_center_us";
  sku: string;
  name: string;
  productUrl: string;
  available: boolean;
  price?: number;
  maxCartQuantity?: number;
  source: string;
  detectedAt: string;
};

export type MonitorState = {
  status: "disconnected" | "connecting" | "healthy" | "degraded" | "offline" | "idle";
  message: string;
  sourceCount: number;
  healthySources: number;
  signalCount: number;
  latestSequence: number;
  latestSignal?: ProductSignal;
  checkedAt?: string;
};

export type SiteId = "pokemon_center_us";
export type TaskGroup = {
  id: string;
  name: string;
  site: SiteId;
};

export type Task = {
  id: string;
  groupId?: string;
  name: string;
  productUrl: string;
  sku?: string;
  usePlaceholder?: boolean;
  monitorKeywords?: string;
  autoApplyMonitorSignal?: boolean;
  pendingMonitorSignal?: ProductSignal;
  variant: string;
  quantity: number;
  effectiveQuantity?: number;
  maxCartQuantity?: number;
  /** When true (the default for new tasks), a matched signal drives add-to-cart → autofill → place order automatically. */
  autoCheckout?: boolean;
  checkoutAmount?: number;
  orderNumber?: string;
  profileId: string;
  proxyId: string;
  proxyPoolIds?: string[];
  proxyFailureCount?: number;
  waitForQueue?: boolean;
  queueStartedAt?: string;
  queuePosition?: number;
  queueEtaSeconds?: number;
  queueLastCheckedAt?: string;
  queueNextCheckAt?: string;
  queueCheckIntervalMinutes?: number;
  loopProfiles?: boolean;
  offerProfileFallback?: boolean;
  challengeRequestId?: string;
  challengeStatus?: "queued" | "assigned" | "solved";
  challengeUrl?: string;
  assignedHarvesterId?: string;
  challengeRequestedAt?: string;
  challengeAttempts?: number;
  status: TaskStatus;
  statusMessage: string;
  updatedAt: string;
  history?: TaskEvent[];
};

export type HarvesterStatus = "idle" | "opening" | "open" | "busy" | "closed" | "error";

export type Harvester = {
  id: string;
  name: string;
  proxy: string;
  status: HarvesterStatus;
  statusMessage: string;
  solveCount: number;
  assignedRequestId?: string;
  assignedTaskId?: string;
  openOnLaunch: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AppData = { profileGroups: ResourceGroup[]; proxyGroups: ResourceGroup[]; profiles: Profile[]; proxies: ProxyConfig[]; taskGroups: TaskGroup[]; tasks: Task[]; harvesters: Harvester[] };
export type WebhookSettings = {
  successUrl: string;
  declineUrl: string;
  successEnabled: boolean;
  declineEnabled: boolean;
};
export type LicenseSession = { label: string; expiresAt: string | null };
export type UpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "current" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message: string;
};

export type BravaApi = {
  clipboard: {
    writeText: (value: string) => Promise<void>;
  };
  external: {
    openOrderStatus: () => Promise<void>;
  };
  windowControls: {
    setMode: (mode: "activation" | "workspace") => Promise<void>;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximized: (listener: (maximized: boolean) => void) => () => void;
  };
  data: {
    load: () => Promise<AppData>;
    save: (data: AppData) => Promise<AppData>;
  };
  license: {
    device: () => Promise<{ deviceId: string; deviceName: string }>;
    resume: (apiUrl: string) => Promise<LicenseSession | null>;
    activate: (key: string, apiUrl: string) => Promise<LicenseSession>;
    heartbeat: (apiUrl: string) => Promise<boolean>;
    deactivate: (apiUrl: string) => Promise<void>;
    key: () => Promise<string | null>;
    copyKey: () => Promise<boolean>;
  };
  webhooks: {
    get: () => Promise<WebhookSettings>;
    save: (settings: WebhookSettings) => Promise<WebhookSettings>;
    test: (kind: "success" | "decline") => Promise<void>;
  };
  proxies: {
    test: (proxyId: string, target: ProxyTestTarget) => Promise<ProxyTestResult>;
    testMany: (proxyIds: string[], target: ProxyTestTarget) => Promise<ProxyTestResult[]>;
  };
  tasks: {
    start: (taskId: string) => Promise<void>;
    startMany: (taskIds: string[]) => Promise<void>;
    stop: (taskId: string) => Promise<void>;
    stopMany: (taskIds: string[]) => Promise<void>;
    review: (taskId: string) => Promise<void>;
    complete: (taskId: string) => Promise<void>;
    decline: (taskId: string) => Promise<void>;
    markCarted: (taskId: string) => Promise<void>;
    updateSku: (taskId: string, sku: string) => Promise<void>;
    applyMonitorSignal: (taskId: string) => Promise<void>;
    refreshQueue: (taskId: string) => Promise<void>;
    onUpdate: (listener: (tasks: Task[]) => void) => () => void;
  };
  monitor: {
    connect: (apiUrl: string) => Promise<MonitorState>;
    disconnect: () => Promise<void>;
    refresh: () => Promise<MonitorState>;
    state: () => Promise<MonitorState>;
    onState: (listener: (state: MonitorState) => void) => () => void;
    onSignal: (listener: (signal: ProductSignal) => void) => () => void;
  };
  harvesters: {
    open: (harvesterId: string) => Promise<void>;
    close: (harvesterId: string) => Promise<void>;
    openAll: () => Promise<void>;
    closeAll: () => Promise<void>;
    reloadCaptcha: (harvesterId: string) => Promise<void>;
    testCaptcha: (harvesterId: string) => Promise<void>;
    markSolved: (harvesterId: string) => Promise<void>;
    onUpdate: (listener: (harvester: Harvester) => void) => () => void;
  };
  updates: {
    state: () => Promise<UpdateState>;
    check: () => Promise<UpdateState>;
    download: () => Promise<void>;
    install: () => Promise<void>;
    onState: (listener: (state: UpdateState) => void) => () => void;
  };
};
