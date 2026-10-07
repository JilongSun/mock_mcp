# 服务端能力说明

[English](./server-capabilities.md) | 简体中文

> 17 个工具 · 9 个资源（4 个数据资源 + 5 个交互式小组件） · 3 个提示词
> 用于配合 Hermes 及其他 MCP 客户端测试 [mcpapps-bridge](https://github.com)。

---

## 使用场景

### AI 驱动的企业助手

让 AI agent 直接访问企业数据。可以用自然语言提问，例如：

- *"找出工程团队里所有 developer"* → `search-users` 工具，支持角色过滤，返回可视化用户卡片
- *"给我看这周已发货的订单"* → `list-orders` 工具，返回分页表格与状态标签
- *"我们销量最好的产品是哪个？"* → `get-product-details`，含评分与库存数据
- *"生成一份 Q4 销售报告"* → `generate-report`，含营收、转化率、客户指标

### 基于位置的决策

`get-location-info` 工具 + `location-map` 小组件共同构成一个可交互的兴趣点（POI）浏览器：

- *"找一下会场附近的餐厅"* → 按 POI 类型用彩色图钉标注的可视化地图
- *"酒店附近有公园吗？"* → 按公园类型过滤，并显示评分与地址
- 可按餐厅、公园、博物馆、咖啡馆、酒店、购物、地标过滤 —— 搜索半径支持 0.01–50 km

结果按**距离由近到远**排序，最多返回 8 条。所有参数都是可选的：`lat`/`lng` 默认是曼哈顿联合广场
（`40.7359, -73.9911`），`radius` 默认 5 km，因此**不带任何参数也能直接执行**。所有 mock POI 都在纽约市，
且距默认中心点均在约 6 km 以内，所以半径调大后会收敛到全量结果。详见
[位置搜索的默认值](#位置搜索的默认值get-location-info)。

### 带审批的工作流自动化

服务端支持 human-in-the-loop 的 elicitation 工作流：

- **审批闸门** —— `request-approval` 工具会对敏感操作（部署、删除、授权）弹出确认对话框
- **反馈收集** —— `collect-feedback` 工具收集结构化的评分与评论
- **文本摘要** —— `summarize-text` 通过 sampling 协议把按需摘要委托给客户端的 LLM

### 实时运维面板

通过 agent 监控系统健康状态：

- `get-server-status` —— 运行时长、请求量、活跃连接数、CPU/内存占用
- `list-client-capabilities` —— 探测当前客户端支持哪些能力（roots、sampling、elicitation、apps）
- `get-user-context` —— 获取当前用户的 locale、时区、位置，用于个性化响应

### 知识管理

- `search-knowledge` —— 对知识库做全文检索（account、API、general 三类）
- `create-document` —— 创建报告、备忘录、指南或规格文档，支持标签分类
- 资源（resources）提供结构化参考数据：POI 类型目录、服务端配置、API 文档、数据集统计，以及交互式可视小组件

---

## 架构

```
                    stdio / HTTP                    stdio / HTTP
  Hermes Agent  ─────────────────→  mcpapps-bridge  ─────────────────→  Mock MCP Server
  （能力受限的宿主）                                       （能力完整）
```

bridge 在 Hermes 与 mock server 之间转发 MCP 协议消息。
标有 🧪 的工具用于测试 bridge 是否能正确处理特定的 `ClientCapabilities`。

---

## 工具（17）

### 基础 CRUD（8 个）

| # | 工具 | 分类 | 说明 |
|---|------|------|------|
| 1 | `search-users` | 人员 | 按姓名、角色或部门搜索 mock 用户 |
| 2 | `get-product-details` | 商品 | 按 ID 获取商品的详细信息、库存与评分 |
| 3 | `list-orders` | 订单 | 支持状态过滤的分页订单列表 |
| 4 | `create-document` | 内容 | 模拟创建文档（report / memo / guide / spec） |
| 5 | `get-location-info` | 位置 | 查找经纬度附近的 POI（**全部参数可选** —— 默认曼哈顿联合广场） |
| 6 | `generate-report` | 分析 | 生成 mock 报告（sales、usage、performance、security） |
| 7 | `search-knowledge` | 内容 | 对 mock 知识库做全文检索 |
| 8 | `get-server-status` | 运维 | mock 服务的健康状态、运行时长与资源指标 |

### 交互式小组件工具（2 个）

与其它小组件不同（那些是先由某个工具填充数据、之后只读），`order-actions` 会把操作**回传**给服务端：
小组件里每一次按钮点击都会发起一次 `tools/call`。这里刻意做了拆分，让小组件的内部管线不会和模型
真正该用的工具混在一起：

| # | 工具 | 分类 | 说明 |
|---|------|------|------|
| 9 | `manage-orders` | 订单 | **启动器**。打开小组件；`readOnlyHint: true`；可选 `filterStatus` 与 `limit` |
| 10 | `apply-order-action` | 订单 | **小组件内部辅助工具**。执行小组件按钮触发的变更操作 |

拆开的好处是启动器的 schema 保持干净 —— agent 打开小组件时只会看到 `filterStatus` 和 `limit`，
而只属于小组件的参数都留在辅助工具上：

| 工具 | 参数 | 调用方 |
|------|------|--------|
| `manage-orders` | `filterStatus`、`limit` | agent / 用户 |
| `apply-order-action` | `action`（`update-status` \| `undo`）、`orderId`、`status`、`steps`、`visibleIds` | 小组件自身的按钮 |

只有 `manage-orders` 携带 `ui/resourceUri` 元数据，因此也只有它会渲染小组件；辅助工具只返回纯数据。
两者返回**同一份快照** —— `orders`、`total`、`history`、`historyDepth`、`undone`、`note` ——
所以小组件是整体替换状态，而不是逐行打补丁、也不是在本地推算历史。两个与小组件相关的细节：

- **`visibleIds`** —— 小组件回传当前屏幕上正在显示的 id，变更后服务端就只返回这些行。
  否则，在按状态过滤的视图里把最后一个 `pending` 订单改掉，那一行会直接消失，针对它的撤销按钮也就
  够不着了。这个参数也正是促成拆分的动因：MCP 的 `inputSchema` 是扁平的，唯一能让它不出现在
  面向 agent 的工具上的办法，就是单独拆一个工具出来。
- **逆序回滚** —— 撤销时从最新一条开始弹栈，并且同时还原订单的**上一个状态**和**上一个 `shippedAt`**。
  当同一个订单被反复修改时，顺序就很重要：把 `cancelled → delivered → shipped` 逐条撤销后，
  能精确回到改动前的状态。

错误处理：缺少 `orderId`/`status`、订单不存在、或对空历史执行撤销，都会返回 `isError: true`。
无变化的改动（把状态设成订单已有的状态）会成功返回，但**不会**被记入撤销历史。

### 交互状态与重置语义

因为这是一个 mock，被改动的订单状态只存在于进程内：

| 事件 | 订单数据 | 撤销历史 | 原因 |
|------|---------|---------|------|
| 工具调用 / 点击小组件按钮 | 变化 | 增长 | 直接修改共享的 `mockOrders` 数组（内存操作） |
| `apply-order-action`（`action="undo"`） | 回滚 | 缩短 | 从日志栈中弹出条目 |
| 开发模式改代码（`src/server.ts` 触发 HMR） | **保留** | **保留** | HMR 会保留存活的 `MCPServer` 实例，且 `mockOrders` 位于独立的 `@mock-mcp/shared` 模块中，不会被重新 import |
| 重启服务（`stop` + `start`，或 `run`） | **重置** | **清空** | 新进程 → 全新的模块图 |
| 多 worker 模式（`--workers N`） | **各 worker 各自独立** | **各 worker 各自独立** | 每个 worker 都是独立进程，各持一份数据副本 |

用小组件里的 Undo 按钮（或调用 `apply-order-action` 并传 `action="undo"`）即可在**不重启**服务的前提下
把场景回滚。

### Bridge 能力测试（7 个）🧪

当 bridge 没有转发所需能力时，这些工具都会平滑降级。

| # | 工具 | 依赖能力 | 不支持时的行为 |
|---|------|---------|--------------|
| 11 | `list-roots` | `roots` | 返回 `supported: false` 并附带诊断说明 |
| 12 | `request-approval` | `elicitation` | 返回 `approved: false` 并附带诊断说明 |
| 13 | `collect-feedback` | `elicitation` | 返回 `supported: false` 并附带诊断说明 |
| 14 | `summarize-text` | `sampling` | 返回 `supported: false`；同时会捕获客户端拒绝的情况 |
| 15 | `list-client-capabilities` | `capabilities` | 始终可用 —— 展示 bridge 实际转发了什么 |
| 16 | `get-user-context` | `user context` | 若身份未转发则返回 `user: null` |
| 17 | `slow-operation` | `progress` | 若客户端未请求进度，则不带进度地运行 |

---

## 能力细节

### Roots（`list-roots`）

调用 `server.listRoots()` 获取客户端已经共享出来的文件系统根目录。如果 bridge 转发了 `roots` 能力，
Hermes 就能把宿主目录暴露给服务端。

### Elicitation（`request-approval`、`collect-feedback`）

服务端向客户端发送表单以完成用户交互：

- **`request-approval`** —— 布尔型审批 + 可选理由。适用于部署闸门、删除确认、授权操作。
- **`collect-feedback`** —— 数字评分（1-5）+ 可选评论。适用于体验调研、功能反馈。

如果 bridge 转发了 `elicitation`，Hermes 就能把表单呈现给用户并回收响应。

### Sampling（`summarize-text`）

服务端通过 `ctx.sample()` 把 LLM 工作委托给客户端。mock server 发送文本与目标长度，客户端的 LLM 返回摘要。
其中包含对"客户端拒绝 sampling 请求"这一情况的错误处理。

### 能力探测（`list-client-capabilities`）

返回完整的 `ClientCapabilities` 对象、客户端信息（名称、版本）以及用户身份。调试时很有用：
可以对比 bridge 对外声称的能力与 Hermes 期望的能力。同时会报告 `supportsApps` 状态。

### 用户上下文（`get-user-context`）

返回 `ctx.client.user()` —— subject、locale、时区、位置。用于验证 bridge 是否转发了宿主的用户身份。

### 进度上报（`slow-operation`）

模拟一个多步操作（步数 3–20 可配），每一步都调用 `ctx.reportProgress(i, total)` 并输出日志。
用于验证 bridge 是否转发了进度通知。

### 位置搜索的默认值（`get-location-info`）

`get-location-info` 的设计目标是：在 agent 介入之前，人手动就能直接跑通。因此它没有必填参数，
并且每个参数都带有内联提示：

| 参数 | 必填 | 默认值 | 客户端中显示的提示 |
|------|------|--------|------------------|
| `lat` | 否 | `40.7359` | Latitude of the search center. Default 40.7359 (Union Square, Manhattan)… |
| `lng` | 否 | `-73.9911` | Longitude of the search center. Default -73.9911 (Union Square, Manhattan). |
| `radius` | 否 | `5` | Search radius in km (0.01–50)… Try 0.5 for a walkable cluster, 3 for a neighborhood. |
| `types` | 否 | 全部 7 类 | Restrict to specific POI types, e.g. `["restaurant","cafe"]`. |

`required` 为空，会渲染 MCP 默认值的 inspector 会把 `40.7359 / -73.9911 / 5` 预填好，
因此点一下 "Execute" 立刻就有结果。默认中心选在联合广场，是因为所有 mock POI 都在纽约，且 15 个点全部
落在距它约 6 km 以内：

| 半径 | 范围内的 POI 数 |
|------|----------------|
| 1 km | 3 |
| 3 km | 9 |
| 5 km（默认） | 13 |
| 约 6 km 以上 | 全部 15 |

结果会按 `radius` 过滤并按**由近到远**排序，最多返回 8 条（`inRadius` 表示范围内共有多少条，
所以小组件能显示 "8 of 13 nearest shown"）。中心点超出范围或半径过小时，会返回空集并给出提示，
而不是报错：

> Nothing found — widen the radius, drop the type filter, or use coordinates near NYC (e.g. 40.7359, -73.9911).

---

## 资源（9）

### 静态数据资源

| URI | 类型 | 说明 |
|-----|------|------|
| `data://poi-types` | `application/json` | POI 类型目录，含图标、文案与颜色 |
| `config://server-info` | `application/json` | 服务端版本、能力与配置上限 |
| `docs://api-reference` | `text/markdown` | 所有工具及参数的 Markdown API 参考 |
| `data://mock-stats` | `application/json` | 实时数据集计数与分布明细 |

### 可视小组件资源

小组件遵循 MCP 的 `ui://` URI 方案（`ui://widget/{name}.html`）。与返回原始内容的静态资源不同，
小组件资源提供的是直接渲染在 MCP 客户端中的、基于 React 的交互式 UI。每个小组件都同时注册为
MCP 工具和资源 —— 工具负责给它填充数据，`ui://` URI 则提供直接的资源访问入口。

| URI | 小组件 | 触发工具 | 视觉形态 |
|-----|--------|---------|---------|
| `ui://widget/user-search-results.html` | **用户搜索结果** | `search-users` | 带角色标签的用户卡片，含头像、部门与入职时间 |
| `ui://widget/order-list.html` | **订单列表** | `list-orders` | 分页表格，带彩色状态标签、可展开的行项目 |
| `ui://widget/order-actions.html` | **订单管理器** | `manage-orders` | 可交互的订单卡片 —— 按钮会调用 `apply-order-action` 辅助工具（`action="update-status"` / `action="undo"`），另有一个 "Ask AI" 追问按钮 |
| `ui://widget/location-map.html` | **位置地图** | `get-location-info` | CSS grid 地图，彩色 POI 图钉，可点击查看评分与地址 |

### 小组件交互能力对照

| 小组件 | 客户端本地能力 | 与服务端的往返 |
|--------|--------------|--------------|
| `user-search-results` | — | — |
| `order-list` | 展开/收起行项目 | — |
| `location-map` | 选中图钉、悬停 | — |
| `order-actions` | 行级 busy 态、内联反馈、可逆的变更日志 | `apply-order-action`（`action="update-status"` / `action="undo"`，**小组件 → `tools/call`**）、`sendFollowUpMessage`（Ask AI） |
| `product-search-result` | 收藏、显示模式、手风琴 | `useCallTool`、`setState`、`sendFollowUpMessage`（模板小组件，未作为工具暴露） |

当需要验证一个宿主是否真的完整实现了 MCP Apps bridge 时，`order-actions` 就是该用的那个小组件：
如果按钮点了没反应，说明宿主只是渲染了 HTML，并没有把 `tools/call` 接回服务端。

### 小组件 → 宿主 vs 小组件 → 服务端

两个看起来一模一样的小组件按钮，实际走的路径可能完全不同。它们离开 iframe 的方式是相同的
（`window.parent.postMessage`，即 MCP Apps 的 JSON-RPC bridge），**是宿主**在决定每个请求该去哪里：

| 小组件动作 | bridge 方法 | 宿主行为 | 是否到达 MCP 服务端 |
|-----------|------------|---------|-------------------|
| 状态按钮 / Undo | `tools/call` | 代理到 MCP 服务端，并把工具结果返回给小组件 | **是** |
| "Ask AI"（`sendFollowUpMessage`） | `ui/message` | 把消息以 `role: "user"` 注入对话，并开启新一轮 LLM | **否** |
| `ui/open-link`、`ui/request-display-mode` | 宿主请求 | 完全由宿主 UI 自己处理 | **否** |
| 展开/收起、选中图钉 | —（纯 React state） | 什么都不离开 iframe | **否** |

所以 `sendFollowUpMessage` 既不是工具调用，也不是 MCP 请求：**服务端永远不会知道它发生过**。
它是小组件在请*宿主*替自己发言。实际影响：

- 服务端无法记录它、拦截它，也无法对它要求审批 —— 它最远只到宿主。
- 有没有效果取决于宿主是否接了 LLM。inspector 没有接，所以它会把消息呈现为一条
  **Widget follow-up** 通知，而不会生成回复。
- 已实测确认：点击 **Ask AI** 会弹出 follow-up 通知，而服务端日志里**没有任何** `tools/call`
  记录（只有周期性的 `HEAD /mcp` 健康轮询）；相比之下，状态按钮和 Undo 按钮每次都会留下
  一条 `tools/call: apply-order-action`。

`ui/message` 的内容格式遵循 SEP-1865：可以是单个 content block，也可以是 block 数组，
并带 `role: "user"`。

---

## 提示词（3）

| 提示词 | 用途 |
|--------|------|
| `explore-locations` | POI 探索流程的引导式模板 |
| `analyze-orders` | 订单数据分析模板（状态、营收、客户、趋势） |
| `generate-data` | 生成结构化数据记录的模板 |

---

## Mock 数据

所有数据都是静态的假数据。每个工具都会引入一段模拟延迟（100ms–2500ms，带随机抖动）来模仿真实 API 延迟。
不涉及任何真实 API 或数据库。

| 数据集 | 数量 | 说明 |
|--------|------|------|
| 用户 | 12 | 角色：admin、developer、editor、viewer —— 覆盖 Engineering、Design、Platform、Marketing、Content、Research |
| 商品 | 12 | 电子产品、家具、配件 —— 含价格、库存、评分与描述 |
| 订单 | 12 | 覆盖全部状态：pending → processing → shipped → delivered + cancelled |
| 位置 | 15 | 纽约的餐厅、公园、博物馆、咖啡馆、酒店、商店、地标，含经纬度 |
| 文档 | 8 | 报告、备忘录、指南、规格 —— 支持标签分类 |
| 知识库 | 8 | account、API、general 三类文章 —— 可全文检索 |

通过小组件修改的订单状态只存在于内存中。用小组件里的 **Undo**（或调用 `apply-order-action` 并传
`action="undo"`）即可在不重启的前提下回滚场景；重启服务同样会恢复初始数据集并清空撤销日志。
完整的对照矩阵（含开发模式 HMR 与多 worker 模式的行为）见
[交互状态与重置语义](#交互状态与重置语义)。

---

## 在 Inspector 中测试小组件

随包提供的 inspector（`@mcp-use/inspector`，由 `mcp-use dev` / `mcp-use build` 一起提供）会在 iframe 中
渲染小组件，并实现了 MCP Apps 的宿主侧逻辑，因此无需另接宿主就能验证交互：

1. 执行 `pnpm dev:v1`，然后打开 <http://localhost:8760/inspector>。
2. 进入 **Tools**，选择 `manage-orders`，点击 **Execute**。
3. 响应面板会切到 **Component (MCP Apps)**，并在 iframe 中渲染小组件。
   切到 **Raw JSON** 则可以看到同一份响应的数据形态。
4. 点击小组件里的状态按钮 —— 服务端日志会出现一条 `tools/call: apply-order-action`，
   同时该行原地更新。此时按钮会变成 `↩︎ Undo (1)`，并出现 "Recent changes" 列表。
5. 点击 **Undo** —— 服务端日志再出现一条 `tools/call: apply-order-action`，该行回滚，
   按钮恢复为禁用的 `↩︎ Undo`。在做出改动之前，Undo 一直是禁用状态。
6. 点击 **Ask AI** —— inspector 会弹出一条 **Widget follow-up** 通知，内容是小组件请求对话处理的消息。

inspector 没有接入 LLM，所以 `sendFollowUpMessage` 会以通知的形式呈现，而不会生成 assistant 回复。
这是预期行为；真正的宿主会改为开启新一轮对话。

inspector 只在 dev 模式下提供。生产运行会跳过它 —— 如需在非开发模式下使用，
请用 `mcp-use build --with-inspector` 重新构建。小组件在两种模式下都会提供，
路径为 `/mcp-use/widgets/<name>`。
