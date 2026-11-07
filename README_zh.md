# Mock MCP Server

[English](./README.md) | 简体中文

一个用于测试实现了 MCP Apps SEP-1865 协议的独立宿主的 Mock [Model Context Protocol](https://modelcontextprotocol.io) 服务器。它提供了一套贴近真实企业运维场景的数据集，包含工具（tools）、资源（resources）、提示词（prompts）以及交互式小组件（widgets）——无需任何真实的 API 或数据库。

详细的工具参考、能力说明以及客户端配置指南请见 [`docs/`](./docs/)。

---

## 项目结构

```
mock_mcp/
├── packages/
│   ├── shared/        # @mock-mcp/shared     — mock 数据与工具函数
│   ├── supervisor/    # @mock-mcp/supervisor — worker 注册表与生命周期
│   ├── console/       # @mock-mcp/console    — 多 worker 管理控制台
│   └── v1/            # @mock-mcp/v1         — mcp-use@1.32.1 服务器
├── public/            # 静态资源
├── docs/              # 工具参考、能力文档与 ADR
└── README.md
```

---

## 快速开始

```bash
pnpm install
pnpm dev:v1       # 运行 SEP-1865 MCP Apps 服务器
```

打开 [http://localhost:8760/inspector](http://localhost:8760/inspector) 即可交互式地浏览工具、资源和小组件。

`manage-orders` 会打开**订单管理器（Order Manager）**小组件，其按钮回调一个独立的、widget 内部专用的
辅助工具 `apply-order-action`（`action: "update-status"` 或 `action: "undo"`）。把两者分开，启动器就能保持
单一职责，widget 专用参数也不会暴露给 agent。这是验证宿主是否完整接通 MCP Apps 桥接的最快方式：在
inspector 中执行 `manage-orders`，把响应面板切到 **Component (MCP Apps)**，然后点击状态按钮，服务器日志中
就会出现 `tools/call: apply-order-action`。点击 **Undo** 即可在不重启的前提下把改动回滚。详见
[`docs/server-capabilities.md`](./docs/server-capabilities.md#testing-widgets-in-the-inspector)。

> inspector 仅在 `pnpm dev:v1` 下提供。生产运行（`pnpm run:v1` / `pnpm start:v1`）会跳过它——如需在
> 非开发模式下使用，请用 `mcp-use build --with-inspector` 构建。小组件在两种模式下都会通过
> `/mcp-use/widgets/<name>` 提供。
>
> 订单状态改动只存在于内存中：**Undo** 可以回滚，完整重启会恢复初始数据集；但开发模式下的代码改动
> （HMR）**不会**重置数据。完整对照表见
> [`docs/server-capabilities.md`](./docs/server-capabilities.md#interactive-state-and-reset-semantics)。

---

## 运行模式

`v1` 支持**前台运行**（附着在终端上）和**后台运行**（脱离终端，关闭终端后仍然继续运行）。

```bash
# 前台 —— 日志直接输出到终端，Ctrl+C 停止
pnpm run:v1

# 后台 —— 在本地记录端口/PID，日志写入 .run/logs/
pnpm start:v1

# 查看与停止后台 worker
pnpm status:v1
pnpm stop:v1                    # 停止全部已记录的 worker
pnpm stop:v1 -- --port 8760     # 只停止该端口上的 worker
```

后台记录保存在仓库根目录的 `.run/`（已在 `.gitignore` 中）：`workers.json` 存放端口/PID
记录，`logs/` 每个 worker 一个日志文件。该注册表与
[Worker 控制台](#worker-控制台) 共用，因此终端启动的 worker 会出现在控制台里，反之亦然。

`start` 会等待服务**真正绑定端口**后才报告成功 —— 冷启动需要 ~10–20 秒，期间
`mcp-use` 不输出任何日志，若立刻报成功会非常误导。如果 worker 退出或始终没有绑定端口，
该分组会被回滚（停掉并从注册表中移除），`start` 以非零码退出。可用 `--timeout <秒>`
调整等待上限（默认 `45`）。

`pnpm status:v1` 也会探测端口，并且只有在监听端口的进程确实属于该 worker 时才认定其
`running`，因此能区分 `running` 与 `alive but NOT listening (booting or hung)`，
并在端口被其他进程占用时给出警告。

### 监听地址（本机 / 局域网）

worker 默认绑定 **IPv4 回环地址**（`127.0.0.1`），也就是 `.mcp.json` 指向的地址。加上
`--host 0.0.0.0` 即可监听所有网卡，让同一局域网内的其他设备也能连接：

```bash
pnpm start:v1 -- --port 8799 --host 0.0.0.0
#   Bind:   0.0.0.0
#   LAN:    http://192.168.1.20:8799/mcp     ← 局域网客户端用这个
#   Local:  http://127.0.0.1:8799/mcp
```

`0.0.0.0` 是**绑定地址**，客户端无法直接使用，所以 LAN 地址由本机的网络接口推导得出，并由
`start` 打印。该地址同时会作为 `mcp-use` 的 base URL，因此远端宿主拿到的 widget 会从服务端
拉取资源，而不是从它自己。

只接受这两个取值。默认回环绑定，因为绑定到局域网的服务器对整个网络可见。

### 多 Worker（仅后台）

多 worker 仅 `start` 支持，`run` 始终是单实例前台。

加上 `--workers N`。worker 从基础端口开始递减占用连续端口（8760、8759、8758……），
并记录为**同一个分组**，因此一条 `pnpm stop:v1` 即可全部关闭。

```bash
# 后台 —— 3 个 worker，端口 8760、8759、8758
pnpm start:v1 -- --workers 3 --port 8760

# 简写形式
pnpm start:v1 -- -w 5
```

| 选项 | 说明 |
|--------|-------------|
| `-p, --port <n>` | 基础端口（默认 `8760`） |
| `-H, --host <ip>` | 监听地址：`127.0.0.1`（默认）或 `0.0.0.0`（局域网） |
| `-w, --workers <n>` | （仅 `start`）后台 worker 数量（默认 `1`） |
| `-t, --timeout <s>` | （仅 `start`）等待就绪的秒数（默认 `45`） |
| `-a, --all` | （`stop`）停止全部已记录 worker —— 本来就是默认行为 |
| `-h, --help` | 显示用法 |

---

## Worker 控制台

`pnpm console` 会在**后台**启动一个浅色 Web 控制台
（[http://127.0.0.1:8790](http://127.0.0.1:8790)），用于统一管理所有 worker：启动、停止、重启、
移除、查看状态与日志。它**是管理者而不是 worker** —— 自身不运行任何 MCP 服务，并与 CLI 共用
同一份注册表，两边始终一致。

```bash
pnpm console         # 必要时先构建 UI，然后**后台**启动（关闭终端不影响）
pnpm console:status  # 它在哪、是否还在服务
pnpm console:stop    # 停止控制台 —— worker 继续运行
pnpm console:run     # 改为前台运行（Ctrl+C 停止）
pnpm console:dev     # Vite 开发模式（热更新），UI 在 :5173，API 代理到 8790
pnpm build:console   # 仅构建 UI
pnpm console -- --host 0.0.0.0   # 让局域网内其他机器也能打开控制台
```

控制台与后台 worker 一样是 detached 的：PID/端口记录在 `.run/console.json`，日志写入
`.run/logs/console-<port>.log`，关闭终端不会停止它。

**它是控制面，不是父进程。** `pnpm console:stop`（或关闭前台控制台）只关闭控制台本身，所有
worker 仍在运行并监听 —— 因为 worker 是 detached 启动的，控制台也没有持有它们的进程句柄。
停止 worker 请用 `pnpm stop:v1` 或界面上的按钮。

- **状态**由 PID 与端口归属共同判定（`running`、`starting`、`unresponsive`、`stopping`、
  `stopped`、`exited`），每 2 秒刷新一次。归属校验缓存 20 秒、并在每次操作后立即失效，因此轮询
  开销很低；没有页面打开时不产生任何轮询。
- **不会自动重启** worker。崩溃或卡死的 worker 只会上报，重启需要手动点击。
- 控制台默认只绑定回环地址。`--host 0.0.0.0` 可让局域网访问，并会打印可直接分发的 URL。
- 新增 worker 默认自动分配空闲端口（从运行时默认端口向下查找）。详情面板中已经预留了
  （尚未启用的）per-worker capability 与 MCP v1/v2 选择字段。

完整 API、端口与内部实现见 [`docs/worker-console_zh.md`](./docs/worker-console_zh.md)
（[English](./docs/worker-console.md)）。

---

## 脚本

| 命令 | 说明 |
|---------|-------------|
| `pnpm dev:v1` | v1 开发服务器（热重载 + inspector + widgets） |
| `pnpm build:v1` | v1 生产构建 |
| `pnpm run:v1` | v1 **前台**运行（端口 8760） |
| `pnpm start:v1` | v1 **后台**运行（关闭终端后仍继续） |
| `pnpm status:v1` | 列出已记录的后台 worker |
| `pnpm stop:v1` | 停止后台 worker —— 默认全部关闭 |
| `pnpm console` | 构建并**后台**启动 Worker 控制台（端口 8790） |
| `pnpm console:run` | Worker 控制台**前台**运行（Ctrl+C 停止） |
| `pnpm console:status` | 查看后台控制台及其服务状态 |
| `pnpm console:stop` | 停止后台控制台 —— worker 继续运行 |
| `pnpm console:dev` | 控制台 UI 的 Vite 开发模式（端口 5173） |

`start:v1` 加上 `-- --workers N` 即为后台多 worker 模式。

---

## 客户端配置

### HTTP 模式

```json
{
  "servers": {
    "enterprise-ops-hub": {
      "url": "http://localhost:8760/mcp",
      "type": "http"
    }
  }
}
```

### stdio 模式

小组件（`ui://widget/*`）仅支持 HTTP。其余所有能力——工具、静态资源、提示词、elicitation、sampling、roots、progress、logging——均可通过 stdio 使用。

```json
{
  "servers": {
    "enterprise-ops-hub": {
      "command": "npx",
      "args": ["tsx", "packages/v1/src/stdio.ts"],
      "cwd": "/path/to/mock_mcp"
    }
  }
}
```

---

## 运行时与构建策略

`v1` 这个包名标识的是锁定版本 `mcp-use@1.32.1` 运行时，并不代表某个旧版的 MCP Apps 协议。该服务器暴露 SEP-1865 的 `ui.resourceUri` 元数据，小组件使用 MCP Apps bridge，而非 OpenAI 兼容性提供者。

每个 workspace 包各自管理其编译产物：

- `@mock-mcp/shared` 构建到 `packages/shared/dist`，并从该目录导出 JavaScript 与声明文件。
- `@mock-mcp/supervisor` 构建到 `packages/supervisor/dist`；v1 CLI 与控制台都引入它，因此 worker 的启停与状态在终端和 UI 中行为完全一致。
- `@mock-mcp/console` 的 UI 构建到 `packages/console/dist/ui`；服务端本身通过 `tsx` 直接运行 TypeScript。
- `@mock-mcp/v1` 将服务器与小组件构建到 `packages/v1/dist`。

保持这些产物位于各自的包内，可以确保 Node 的包导出解析正常工作。根包负责编排构建，但不会把各自独立版本化的 workspace 包扁平化输出到共享的根 `dist`。

完整的能力细节请见 [`docs/server-capabilities_zh.md`](./docs/server-capabilities_zh.md)（[English](./docs/server-capabilities.md)）。架构决策请见 [`docs/adr/`](./docs/adr/)。
