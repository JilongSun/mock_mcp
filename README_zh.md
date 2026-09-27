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

## 多 Worker 部署

```bash
# v1 — 3 个 worker，分别监听端口 8760、8759、8758
pnpm start:v1:multi -- --workers 3

# 简写形式
pnpm start:v1:multi -- -w 5
```

---

## 脚本

| 命令 | 说明 |
|---------|-------------|
| `pnpm dev:v1` | v1 开发服务器（热重载 + inspector + widgets） |
| `pnpm build:v1` | v1 生产构建 |
| `pnpm start:v1` | v1 生产 HTTP 服务器（端口 8760） |
| `pnpm start:v1:multi -- --workers N` | v1 多 worker 启动器 |

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
