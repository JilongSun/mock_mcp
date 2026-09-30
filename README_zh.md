# Mock MCP Server

[English](./README.md) | 简体中文

一个用于测试实现了 MCP Apps SEP-1865 协议的独立宿主的 Mock [Model Context Protocol](https://modelcontextprotocol.io) 服务器。它提供了一套贴近真实企业运维场景的数据集，包含工具（tools）、资源（resources）、提示词（prompts）以及交互式小组件（widgets）——无需任何真实的 API 或数据库。

详细的工具参考、能力说明以及客户端配置指南请见 [`docs/`](./docs/)。

---

## 项目结构

```
mock_mcp/
├── packages/
│   ├── shared/        # @mock-mcp/shared — mock 数据与工具函数
│   └── v1/            # @mock-mcp/v1    — mcp-use@1.32.1 服务器
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

---

## 运行模式

`v1` 支持**前台运行**（附着在终端上）和**后台运行**（脱离终端，关闭终端后仍然继续运行）。

```bash
# 前台 —— 日志直接输出到终端，Ctrl+C 停止
pnpm run:v1

# 后台 —— 在本地记录端口/PID，日志写入 packages/v1/.run/logs/
pnpm start:v1

# 查看与停止后台进程
pnpm status:v1
pnpm stop:v1                    # 停止全部已记录的后台 job
pnpm stop:v1 -- --port 8760     # 只停止该端口上的 job
```

后台记录保存在 `packages/v1/.run/`（已在 `.gitignore` 中）：`processes.json` 存放端口/PID
记录，`logs/` 每个 job 一个日志文件。

### 多 Worker（仅后台）

多 worker 仅 `start` 支持，`run` 始终是单实例前台。

加上 `--workers N`。worker 从基础端口开始递减占用连续端口（8760、8759、8758……），
并记录为**同一个 job**，因此一条 `pnpm stop:v1` 即可全部关闭。

```bash
# 后台 —— 3 个 worker，端口 8760、8759、8758
pnpm start:v1 -- --workers 3 --port 8760

# 简写形式
pnpm start:v1 -- -w 5
```

| 选项 | 说明 |
|--------|-------------|
| `-p, --port <n>` | 基础端口（默认 `8760`） |
| `-w, --workers <n>` | （仅 `start`）后台 worker 数量（默认 `1`） |
| `-a, --all` | （`stop`）停止全部已记录 job —— 本来就是默认行为 |
| `-h, --help` | 显示用法 |

---

## 脚本

| 命令 | 说明 |
|---------|-------------|
| `pnpm dev:v1` | v1 开发服务器（热重载 + inspector + widgets） |
| `pnpm build:v1` | v1 生产构建 |
| `pnpm run:v1` | v1 **前台**运行（端口 8760） |
| `pnpm start:v1` | v1 **后台**运行（关闭终端后仍继续） |
| `pnpm status:v1` | 列出已记录的后台 job |
| `pnpm stop:v1` | 停止后台 job —— 默认全部关闭 |

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
- `@mock-mcp/v1` 将服务器与小组件构建到 `packages/v1/dist`。

保持这些产物位于各自的包内，可以确保 Node 的包导出解析正常工作。根包负责编排构建，但不会把各自独立版本化的 workspace 包扁平化输出到共享的根 `dist`。

完整的能力细节请见 [`docs/server-capabilities.md`](./docs/server-capabilities.md)。架构决策请见 [`docs/adr/`](./docs/adr/)。
