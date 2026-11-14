# Worker 控制台

[English](./worker-console.md) | 简体中文

Worker 控制台（`@mock-mcp/console`）是一个浅色 Web 界面加一组轻量 HTTP API，用于集中管理所有
mock-mcp worker：启动、停止、重启、移除、查看状态、跟踪日志。

```bash
pnpm console         # 必要时先构建 UI，然后**后台**运行在 :8790
pnpm console:status  # 是否还在运行 / 是否还在服务
pnpm console:stop    # 停止控制台 —— worker 继续运行
pnpm console:run     # 改为前台运行（Ctrl+C 停止控制台）
pnpm console:dev     # Vite 开发模式（热更新），UI 在 :5173，API 代理到 :8790
pnpm build:console   # 仅构建 UI
```

## 后台运行

`pnpm console` 与 worker 的 `pnpm start:v1` 一样是 detached 的：关闭终端不会停止它。它把
PID/端口记录在 `.run/console.json`，日志写入 `.run/logs/console-<port>.log`，因此
`console:status` / `console:stop` 无需记住任何东西。

```bash
pnpm console -- --port 8791        # 在另一个端口再起一个控制台
pnpm console -- --host 0.0.0.0     # 局域网内可访问
pnpm console:stop -- --port 8791   # 只停那一个
```

`--host` 可选 `127.0.0.1`（默认）或 `0.0.0.0`；后者让控制台可从局域网访问，这正是该选项的用途。

如果该端口上已记录且仍存活的控制台，`start` 会直接报
`the console is already running on ... (PID n)`，而不会重复拉起。

## 生命周期：控制面，不是父进程

```
console (detached) ──spawn──▶ worker A (detached，控制台退出后继续运行)
                   ──spawn──▶ worker B (detached，控制台退出后继续运行)
```

- worker 以 `detached: true` + `unref()` 启动，控制台不保留任何 `ChildProcess` 句柄，注册表里
  只有数字 PID。
- 因此**停止控制台绝不会停止 worker**：`pnpm console:stop`、前台控制台按 `Ctrl+C`、甚至直接
  kill 掉控制台，worker 都会继续运行并监听端口。
- 停止 worker 请用 `pnpm stop:v1` 或界面上的停止/移除按钮。
- 反过来同样成立：`pnpm start:v1` 启动的 worker，控制台一启动就能管理，因为二者读的是同一份
  `.run/workers.json`。

控制台退出时只会关闭自己的 HTTP 服务（以及 `--dev` 模式下的 Vite 子进程）。

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
| `.run/console.json` | 后台控制台实例（PID/端口/日志） |
| `.run/logs/<worker-id>.log` | 每个 worker 一个日志文件 |
| `.run/logs/console-<port>.log` | 每个后台控制台一个日志文件 |

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

状态轮询的开销几乎全部来自端口归属校验：`lsof` 要扫描机器上所有进程，而它原本是每个 worker、
每一轮都要付一次。两点让这个成本降下来，同时不削弱结论：

- 归属结论缓存 `OWNERSHIP_TTL_MS`（20 秒），并在每次 start/stop/restart/remove 时立即失效。
- “端口上有没有东西”始终用一次本地 TCP 连接**实时**探测，且缓存结论只有在与该实时信号一致时
  才会被复用。因此停止监听的 worker 会**立刻**被发现 —— 缓存绝不会把安静下来的端口说成占用，
  它只是省去重新推导“**是谁**在占用”。残留窗口仅限于“端口一直忙但中途换了持有者”，此时最多在
  TTL 内被报成我们的 worker。

有 N 个存活 worker 时，未命中缓存的路径每轮要付 N 次 `lsof`；命中缓存后，每个 TTL 窗口大约只需
N 次。已停止与已退出的 worker 零成本（先探活再查归属）。安全路径 —— 停止/重启时收回端口 ——
始终实时测量归属，绝不读缓存。

没有页面打开时完全不轮询：控制台服务端自身没有任何定时器，轮询只存在于浏览器，且标签隐藏时
会跳过请求。

---

## HTTP API

全部为 JSON，仅监听回环地址。错误格式为 `{ "error": { "code": "...", "message": "..." } }`。

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `GET` | `/api/meta` | 控制台版本、host/port、注册表路径、轮询间隔、注册表健康状况 |
| `GET` | `/api/runtimes` | 可启动的运行时（id、label、默认端口、预留的 capability/protocol 选项） |
| `GET` | `/api/workers` | 全部 worker 及实时状态，附汇总（数量、占用端口） |
| `POST` | `/api/workers` | 创建并启动 worker：`{ runtime, host?, port?, count?, name? }` |
| `GET` | `/api/workers/:id` | 单个 worker |
| `POST` | `/api/workers/:id/start` | 启动处于 stopped/exited 的记录 |
| `POST` | `/api/workers/:id/stop` | 停止（SIGTERM → SIGKILL，随后释放端口） |
| `POST` | `/api/workers/:id/restart` | 按记录的配置停止并重新拉起 |
| `DELETE` | `/api/workers/:id` | 必要时先停止，然后删除记录 |
| `GET` | `/api/workers/:id/logs?lines=200` | 尾部日志（`lines` ≤ 2000，从文件末尾 256 KiB 内读取） |
| `GET` | `/api/workers/:id/inspector` | 该 worker 能否使用调试台，以及可嵌入的调试台 URL |
| `GET` | `/api/ports/next?runtime=v1&count=2` | 自动分配将会选用的端口 |

`port` 可传数字或 `"auto"`（默认）。自动分配从运行时默认端口向下查找，跳过已记录或已被占用的
端口；`count > 1` 时端口连续且递减，与 `pnpm start:v1 -- --workers N` 的规则一致。

`host` 可传 `127.0.0.1`（默认）或 `0.0.0.0`。响应里每个 worker 都带 `host` 与 `urls` 数组 ——
通配符绑定时局域网地址排在最前，并带 `scope: "lan"` 与所属网卡名，UI 据此提供一键复制。
`GET /api/meta` 对控制台自身给出同样的信息，另含 `lanAddresses` 与允许的 host 取值。

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

## 调试台集成

每个 worker 行都可以打开内嵌的 MCP 调试台。调试台不由控制台运行：worker 自己的构建里带上
`/inspector`，控制台整屏嵌入它，并传入 `?autoConnect=<worker>/mcp`，打开即已连接。

```bash
pnpm build:v1:inspector   # 用它代替 pnpm build:v1
# 然后在控制台重启该 worker（或 pnpm stop:v1 && pnpm start:v1）
```

- **刻意做成可选。** `@mcp-use/inspector` 依赖树较大，默认的 `pnpm build:v1` 不包含它，worker
  保持轻量。
- **按构建而非按 worker。** 该开关记录在 `dist/mcp-use.json` 的 `includeInspector` 中，同一运行时
  的所有 worker 共用；若要让部分 worker 带调试台、部分不带，需要两份构建。
- **探测而不是假设。** UI 打开 iframe 之前，`GET /api/workers/:id/inspector` 会先探测
  `/inspector`；构建未包含时返回 `reason: "not-built"`，面板直接给出重新构建的命令，而不是显示
  一个坏掉的 iframe。
- **回环安全。** 返回的 URL 使用浏览器访问控制台时的主机名，因此远端浏览器不会去连自己的回环；
  从其他机器访问控制台、而 worker 只绑定 `127.0.0.1` 时，返回 `remote-loopback`。

## 有意的设计取舍

- **不自动重启。** 控制台只上报异常 worker，重启需要手动点击。自动重启会掩盖崩溃，让有问题的
  构建看起来是健康的（见 [ADR 002](./adr/002-worker-console-and-supervisor.md)）。
- **端口释放兜底。** 记录的 PID 是 `mcp-use` 包装进程，真正绑定端口的是它的子进程。若包装进程
  被 `SIGKILL`，子进程会被重新挂到 init 上并继续占用端口 —— 因此 `stop` 还会检查谁在监听该端口
  并对其发信号，但仅限能确认属于我们的进程（命令行或工作目录指向该 worker 的包目录）。落在同一
  端口上的外部服务只会上报，绝不会被杀死。
- **默认按"PID 可能被复用"处理。** 崩溃后操作系统可能把记录的 PID 分配给无关进程，因此 PID
  数字本身从不作为身份凭证：
  - 发信号前先校验命令行；**无法确认时不杀**（fail-safe —— 报告为 skipped，而不是误杀陌生人）。
    健康检查同样要求监听者看起来像该 worker，所以被复用的 PID 会显示为 `exited` 而非 `running`。
  - `start` 只有在存活 PID 仍然像该 worker 时才回 `ALREADY_RUNNING`；若号码被别的进程继承，
    启动会继续（或在对方同时占用端口时明确报 `PORT_BUSY`），而不是永久卡住。
- **注册表损坏是可见的。** 若 `.run/workers.json` 无法解析，`GET /api/meta` 返回
  `registry: { ok: false, fault }`，UI 显示警示条。文件本身不会被修改，修好（或删除）后下一次
  轮询即可恢复。
- **默认回环，按需开局域网。** `--host` 只接受 `127.0.0.1` 或 `0.0.0.0`，其他取值直接拒绝。
  这是一个 mock/测试工具，因此不内置鉴权 —— 鉴权本身将来更适合作为一个可选的测试能力。
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

`tsx cli.ts start --port 8791` 可在另一个端口后台再起一个控制台；
`tsx cli.ts run --dev` 则是前台 + Vite。
