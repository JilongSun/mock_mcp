import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "zh" | "en";

const STORAGE_KEY = "mock-mcp-console.lang";

const DICT = {
  "app.title": { zh: "Worker 控制台", en: "Worker Console" },
  "app.subtitle": { zh: "mock-mcp 多 worker 管理中心", en: "mock-mcp multi-worker control plane" },
  "app.loading": { zh: "加载中…", en: "Loading…" },
  "app.updatedAt": { zh: "更新于 {time}", en: "Updated {time}" },
  "app.autoRefreshOn": { zh: "自动刷新：开", en: "Auto-refresh: on" },
  "app.autoRefreshOff": { zh: "自动刷新：关", en: "Auto-refresh: off" },
  "app.refresh": { zh: "刷新", en: "Refresh" },
  "app.retry": { zh: "重试", en: "Retry" },
  "app.close": { zh: "关闭", en: "Close" },
  "app.loadFailed": { zh: "无法连接控制台后端。", en: "Cannot reach the console backend." },
  "app.thisConsole": { zh: "控制台地址", en: "Console URL" },
  "app.noLan": {
    zh: "未检测到局域网地址",
    en: "No LAN address detected",
  },

  "summary.total": { zh: "Worker 总数", en: "Workers" },
  "summary.running": { zh: "运行中", en: "Running" },
  "summary.starting": { zh: "启动中", en: "Starting" },
  "summary.unresponsive": { zh: "无响应", en: "Unresponsive" },
  "summary.stopping": { zh: "停止中", en: "Stopping" },
  "summary.stopped": { zh: "已停止", en: "Stopped" },
  "summary.exited": { zh: "已退出", en: "Exited" },
  "summary.ports": { zh: "占用端口", en: "Ports in use" },
  "summary.lan": { zh: "局域网", en: "LAN" },
  "scope.local": { zh: "本机", en: "local" },
  "scope.lan": { zh: "局域网", en: "LAN" },
  "summary.none": { zh: "无", en: "none" },

  "workers.heading": { zh: "Worker 列表", en: "Workers" },
  "workers.count": { zh: "共 {count} 个", en: "{count} total" },
  "workers.new": { zh: "新增 Worker", en: "New worker" },
  "workers.empty.title": { zh: "还没有 worker", en: "No workers yet" },
  "workers.empty.hint": {
    zh: "点击“新增 Worker”，或在终端运行 pnpm start:v1（多 worker 用 -- --workers N）。",
    en: "Use “New worker”, or run pnpm start:v1 in a terminal (with -- --workers N for several).",
  },

  "column.name": { zh: "名称", en: "Name" },
  "column.runtime": { zh: "运行时", en: "Runtime" },
  "column.port": { zh: "端口", en: "Port" },
  "column.pid": { zh: "PID", en: "PID" },
  "column.status": { zh: "状态", en: "Status" },
  "column.uptime": { zh: "运行时长", en: "Uptime" },
  "column.actions": { zh: "操作", en: "Actions" },

  "action.start": { zh: "启动", en: "Start" },
  "action.stop": { zh: "停止", en: "Stop" },
  "action.restart": { zh: "重启", en: "Restart" },
  "action.logs": { zh: "日志", en: "Logs" },
  "action.remove": { zh: "移除", en: "Remove" },
  "action.detail": { zh: "详情", en: "Details" },
  "action.copy": { zh: "复制", en: "Copy" },
  "action.copied": { zh: "已复制", en: "Copied" },
  "action.copyUrl": { zh: "复制访问地址", en: "Copy URL" },
  "action.follow": { zh: "跟随最新", en: "Follow" },
  "action.working": { zh: "处理中…", en: "Working…" },
  "action.removeConfirm": {
    zh: "移除 worker {name}（端口 {port}）？运行中的进程会先被停止。",
    en: "Remove worker {name} (port {port})? A running process is stopped first.",
  },

  "status.running": { zh: "运行中", en: "Running" },
  "status.starting": { zh: "启动中", en: "Starting" },
  "status.unresponsive": { zh: "无响应", en: "Unresponsive" },
  "status.stopping": { zh: "停止中", en: "Stopping" },
  "status.stopped": { zh: "已停止", en: "Stopped" },
  "status.exited": { zh: "已退出", en: "Exited" },

  "form.title": { zh: "新增 worker", en: "New worker" },
  "form.runtime": { zh: "运行时", en: "Runtime" },
  "form.host": { zh: "监听地址", en: "Bind address" },
  "form.hostLocal": { zh: "仅本机 127.0.0.1", en: "This machine only (127.0.0.1)" },
  "form.hostLan": { zh: "局域网 0.0.0.0", en: "LAN (0.0.0.0)" },
  "form.hostHint": {
    zh: "局域网模式会监听所有网卡，任何能连到本机的设备都可访问。",
    en: "LAN mode listens on every interface, so any device that can reach this machine can connect.",
  },
  "form.hostNoLan": {
    zh: "当前没有可用的局域网地址，请先连接网络。",
    en: "No LAN address is available right now — connect to a network first.",
  },
  "form.count": { zh: "数量", en: "Count" },
  "form.port": { zh: "起始端口", en: "Base port" },
  "form.portAuto": { zh: "自动分配", en: "Auto-assign" },
  "form.name": { zh: "名称（可选）", en: "Name (optional)" },
  "form.nameHint": { zh: "留空则使用 worker-<端口>", en: "Defaults to worker-<port>" },
  "form.hint": {
    zh: "多实例时端口从起始端口向下顺序分配，日志与注册表由控制台统一维护。",
    en: "Multiple instances count ports down from the base port; logs and the registry stay shared with the CLI.",
  },
  "form.submit": { zh: "启动", en: "Start" },
  "form.submitting": { zh: "启动中…", en: "Starting…" },
  "form.cancel": { zh: "取消", en: "Cancel" },
  "form.rangeError": { zh: "端口必须是 1-65535 的整数", en: "Port must be an integer between 1 and 65535" },
  "form.countError": { zh: "数量必须是 1-20 的整数", en: "Count must be an integer between 1 and 20" },

  "detail.title": { zh: "Worker 详情", en: "Worker details" },
  "detail.overview": { zh: "概览", en: "Overview" },
  "detail.id": { zh: "ID", en: "ID" },
  "detail.group": { zh: "分组", en: "Group" },
  "detail.endpoint": { zh: "MCP 端点", en: "MCP endpoint" },
  "detail.host": { zh: "监听地址", en: "Bind address" },
  "detail.urls": { zh: "客户端访问地址", en: "Client URLs" },
  "detail.desired": { zh: "期望状态", en: "Desired state" },
  "detail.desiredRunning": { zh: "运行", en: "running" },
  "detail.desiredStopped": { zh: "停止", en: "stopped" },
  "detail.createdAt": { zh: "创建时间", en: "Created" },
  "detail.startedAt": { zh: "最近启动", en: "Last start" },
  "detail.logFile": { zh: "日志文件", en: "Log file" },
  "detail.reserved": { zh: "待实现（已预留数据结构）", en: "Planned (data model already reserved)" },
  "detail.capabilities": { zh: "Capability 选择", en: "Capability selection" },
  "detail.capabilitiesHint": {
    zh: "启动时选择启用哪些 capability。当前 worker 使用运行时默认全集。",
    en: "Choose which capabilities a worker starts with. Workers currently get the runtime default set.",
  },
  "detail.protocol": { zh: "MCP 协议版本", en: "MCP protocol version" },
  "detail.protocolHint": {
    zh: "选择该 worker 使用 MCP v1 还是 v2。当前由运行时决定。",
    en: "Pick whether this worker serves MCP v1 or v2. Currently decided by the runtime.",
  },
  "detail.allCapabilities": { zh: "全部（运行时默认）", en: "All (runtime default)" },
  "detail.runtimeDefault": { zh: "运行时默认", en: "Runtime default" },
  "detail.planned": { zh: "规划中", en: "Planned" },
  "detail.noneYet": { zh: "该运行时尚未提供可选项。", en: "This runtime exposes no options yet." },

  "logs.title": { zh: "日志", en: "Logs" },
  "logs.empty": { zh: "日志为空。", en: "Log is empty." },
  "logs.missing": { zh: "日志文件不存在（worker 可能尚未启动过）。", en: "Log file not found (the worker may never have started)." },
  "logs.truncated": { zh: "仅显示最后 {count} 行", en: "Showing the last {count} lines" },
  "logs.live": { zh: "自动刷新中", en: "Live" },

  "error.action": { zh: "操作失败：{message}", en: "Action failed: {message}" },
  "warning.port": { zh: "端口仍被其他进程占用", en: "The port is still held by another process" },
  "warning.portConflict": {
    zh: "端口被其他进程占用，该 worker 无法监听",
    en: "Another process holds this port, so the worker cannot listen",
  },

  "uptime.seconds": { zh: "{value} 秒", en: "{value}s" },
  "uptime.minutes": { zh: "{value} 分", en: "{value}m" },
  "uptime.hours": { zh: "{value} 小时", en: "{value}h" },
  "uptime.days": { zh: "{value} 天", en: "{value}d" },
  "uptime.none": { zh: "—", en: "—" },
} satisfies Record<string, Record<Lang, string>>;

export type MessageKey = keyof typeof DICT;

export interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readInitialLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    // localStorage can be unavailable — fall back to the default.
  }
  return "zh";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore storage failures; the toggle still works for this session.
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);

  const value = useMemo<I18nValue>(() => {
    const t = (key: MessageKey, vars?: Record<string, string | number>): string => {
      const template = DICT[key]?.[lang] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) =>
        vars[name] === undefined ? `{${name}}` : String(vars[name]),
      );
    };
    return { lang, setLang, t };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}
