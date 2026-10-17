# Worker 控制台

[English](./worker-console.md) | 简体中文

Worker 控制台（`@mock-mcp/console`）是一个浅色 Web 界面加一组轻量 HTTP API，用于集中管理所有
mock-mcp worker：启动、停止、重启、移除、查看状态、跟踪日志。

```bash
pnpm console        # 必要时先构建 UI，然后在 http://127.0.0.1:8790 提供服务
pnpm console:dev    # Vite 开发模式（热更新），UI 在 :5173，API 代理到 :8790
pnpm build:console  # 仅构建 UI
```

---

## 它是管理者，不是 worker

控制台自身不运行任何 MCP 服务，它只负责拉起和通知**其他**进程，因此：

- 一个控制台可以管理任意数量的 worker，包括不同运行时的 worker；
- worker 以 detached 方式运行，控制台退出不会影响它们；
- 控制台与 CLI 共用同一份注册表，终端启动的 worker 会出现在 UI 中并可从 UI 停止（反之亦然）。

```
┌────────────┐   spawn/SIGTERM    ┌──────────────┐
│  控制台     │ ─────────────────▶ │ worker :8760 │  (mcp-use, detached)
│  :8790     │                    └──────────────┘
│            │   读写              ┌──────────────┐
│  HTTP API  │ ◀────────────────▶ │ .run/        │ ◀── pnpm start:v1 /
└────────────┘   注册表+日志        │ workers.json │     stop:v1 / status:v1 也用它
                                  └──────────────┘
```

端口：控制台默认 **8790**，刻意选在 worker 端口区间**之上**。因为 worker 从基础端口**向下**
递减（8760、8759、8758……），否则会与控制台端口冲突。

---

## 注册表

所有管理者状态都在仓库根目录的 `.run/`（已在 `.gitignore` 中）：

| 路径 | 用途 |
|------|------|
| `.run/workers.json` | worker 注册表（schema 版本 2） |
| `.run/logs/<worker-id>.log` | 每个 worker 一个日志文件 |

- 文件以原子方式写入（临时文件 + `rename`），读取方不会读到半截文件。
- worker id 由端口派生（`w-8760`），因此重启会复用同一条记录与同一个日志文件。
- 一起启动的 worker 共享 `groupId`（`single-8760`、`multi-8760x3`），CLI 的输出即按它分组。
- 旧版 CLI 写下的 job 结构状态文件（`packages/v1/.run/processes.json`）会在首次读取时自动
  迁移，之后原文件不再改动。
- 设置 `MOCK_MCP_RUN_DIR` 可以把这些内容放到别处（测试用它，也方便做隔离运行）。

---

## 状态模型

状态由记录的 PID **以及**端口归属共同决定，绝不只看 PID —— 崩溃后端口被别的进程接管的 worker
不能被误判为健康。

| 状态 | 含义 |
|------|------|
| `running` | 进程存活，且端口由该 worker（或其子进程）绑定 |
| `starting` | 存活，端口尚未绑定，距最近一次启动不足 60 秒 |
| `unresponsive` | 存活，超过宽限期仍未绑定端口（卡死或被阻塞） |
| `stopping` | 已请求停止，进程尚未退出 |
| `stopped` | 主动停止；记录保留，便于再次启动 |
| `exited` | 未经停止请求而进程消失（崩溃） |

响应中同时给出 `listening` 与 `portTakenByOther`，UI 据此提示“端口被其他进程占用”。UI 每 2 秒
轮询一次 API（间隔由 `GET /api/meta` 的 `pollIntervalMs` 给出）。

### 轮询开销

状态轮询的开销几乎全部来自端口归属校验：`lsof` 要扫描机器上所有进程（本机实测约 40ms/次），
而它原本是每个 worker、每一轮都要付一次。两点让这个成本降下来，同时不削弱结论：

- 归属结论缓存 `OWNERSHIP_TTL_MS`（20 秒），并在每次 start/stop/restart/remove 时立即失效。
- “端口上有没有东西”始终用一次本地 TCP 连接**实时**探测，且缓存结论只有在与该实时信号一致时
  才会被复用。因此停止监听的 worker 会**立刻**被发现 —— 缓存绝不会把安静下来的端口说成占用，
  它只是省去重新推导“**是谁**在占用”。残留窗口仅限于“端口一直忙但中途换了持有者”，此时最多在
  TTL 内被报成我们的 worker。

3 个 worker 的实测：缓存过期的冷请求约 120ms，命中缓存约 1.4ms，即在 2 秒轮询下持续开销
**降低约 10 倍**。已停止与已退出的 worker 零成本（先探活再查归属）。安全路径 —— 停止/重启时
收回端口 —— 始终实时测量归属，绝不读缓存。

没有页面打开时完全不轮询：控制台服务端自身没有任何定时器，轮询只存在于浏览器，且标签隐藏时
会跳过请求。

---

## HTTP API

全部为 JSON，仅监听回环地址。错误格式为 `{ "error": { "code": "...", "message": "..." } }`。

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `GET` | `/api/meta` | 控制台版本、host/port、注册表路径、轮询间隔 |
| `GET` | `/api/runtimes` | 可启动的运行时（id、label、默认端口、预留的 capability/protocol 选项） |
| `GET` | `/api/workers` | 全部 worker 及实时状态，附汇总（数量、占用端口） |
| `POST` | `/api/workers` | 创建并启动 worker：`{ runtime, port?, count?, name? }` |
| `GET` | `/api/workers/:id` | 单个 worker |
| `POST` | `/api/workers/:id/start` | 启动处于 stopped/exited 的记录 |
| `POST` | `/api/workers/:id/stop` | 停止（SIGTERM → SIGKILL，随后释放端口） |
| `POST` | `/api/workers/:id/restart` | 按记录的配置停止并重新拉起 |
| `DELETE` | `/api/workers/:id` | 必要时先停止，然后删除记录 |
| `GET` | `/api/workers/:id/logs?lines=200` | 尾部日志（`lines` ≤ 2000，从文件末尾 256 KiB 内读取） |
| `GET` | `/api/ports/next?runtime=v1&count=2` | 自动分配将会选用的端口 |

`port` 可传数字或 `"auto"`（默认）。自动分配从运行时默认端口向下查找，跳过已记录或已被占用的
端口；`count > 1` 时端口连续且递减，与 `pnpm start:v1 -- --workers N` 的规则一致。

```bash
# 在两个空闲端口上启动 worker
curl -s -X POST http://127.0.0.1:8790/api/workers \
  -H 'content-type: application/json' \
  -d '{"runtime":"v1","port":"auto","count":2,"name":"demo"}'

# 查看状态并读取其中一个的日志
curl -s http://127.0.0.1:8790/api/workers
curl -s "http://127.0.0.1:8790/api/workers/w-8760/logs?lines=50"
```

常见错误码：`WORKER_EXISTS`（该端口已有记录，请改用该 worker 的 start/restart/remove）、
`UNKNOWN_RUNTIME`、`ALREADY_RUNNING`、`PORT_BUSY`（端口被非本 worker 的进程占用，重启只会得到
一个无法绑定的 worker）、`NOT_FOUND`。

---

## 终端与控制台并用

两个入口都走 `@mock-mcp/supervisor`，因此行为是共享的而不是各写一份：

| 终端 | 控制台 |
|----------|---------|
| `pnpm start:v1 -- --workers 3` | “新增 Worker”，数量填 3 |
| `pnpm status:v1` | worker 表格 + 汇总卡片 |
| `pnpm stop:v1` | 停止 / 移除 |
| `pnpm run:v1`（前台、附着终端） | 不纳入管理 —— 前台实例归它的终端所有 |

前台 `run` 命令保持原样：控制台只管理后台（detached）worker。

---

## 有意的设计取舍

- **不自动重启。** 控制台只上报异常 worker，重启需要手动点击。自动重启会掩盖崩溃，让有问题的
  构建看起来是健康的（见 [ADR 002](./adr/002-worker-console-and-supervisor.md)）。
- **端口释放兜底。** 记录的 PID 是 `mcp-use` 包装进程，真正绑定端口的是它的子进程。若包装进程
  被 `SIGKILL`，子进程会被重新挂到 init 上并继续占用端口 —— 因此 `stop` 还会检查谁在监听该端口
  并对其发信号，但仅限能确认属于我们的进程（命令行或工作目录指向该 worker 的包目录）。落在同一
  端口上的外部服务只会上报，绝不会被杀死。
- **只监听回环地址。** 该 API 能启停进程，因此非回环 `--host` 会被拒绝，除非显式设置
  `MOCK_MCP_CONSOLE_ALLOW_REMOTE=1`。它没有任何鉴权，定位是本地开发工具。
- **预留字段。** 每条记录都已带有 `capabilities` 与 `protocol`，每个运行时也可以声明可选的
  capability/protocol 项。目前没有任何逻辑消费它们，详情面板只读展示，以便这些能力落地时不必
  改动数据模型。

---

## 后续扩展的挂载点

控制台接下来的两个功能已经预留好位置：

1. **per-worker capability** —— 选择 worker 启动时启用哪些能力组（当前 `capabilities: []` 表示
   “运行时默认，即全部”）。
2. **per-worker 协议版本** —— MCP v1 与 v2 二选一（当前 `protocol: null` 表示“由运行时决定”）。
   `@mock-mcp/supervisor` 中已经声明了 `packages/v2`，一旦该包存在就会自动出现在运行时列表里。

---

## 开发

```bash
pnpm console:dev     # Vite 热更新在 :5173，API 代理到 :8790
```

| 关注点 | 位置 |
|---------|----------|
| HTTP API | `packages/console/src/api.ts` |
| 静态资源服务 | `packages/console/src/static.ts` |
| 服务入口与参数 | `packages/console/server.ts` |
| UI | `packages/console/ui/`（React + Tailwind，中英切换） |
| worker 生命周期 | `packages/supervisor/src/lifecycle.ts` |

`tsx server.ts --port 8791` 可在其他端口运行控制台；加 `--dev` 会同时启动 Vite。
