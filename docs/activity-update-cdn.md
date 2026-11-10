# 活动更新 / CDN 自动发现

> 移植自 B 项目（qq-farm-bot-origin）并 TS 化的活动更新监控与官方 CDN 资源解析基础设施。
> 目标是运行时自动发现「游戏里新上线、但本仓库尚未登记玩法」的活动 ID，并从官方 Cocos
> bundle 配置还原活动封面/图标图片地址，为后续补录玩法与前端展示提供线索。

## 模块一览

| 文件 | 职责 |
| --- | --- |
| `core/src/services/activity-update-scanner.ts` | 读取本机 QQ 小程序解包源码（`game.js`/`game.json`/`tsdk.wasm`/`assets`）与 `gamecaches`，抽取疑似活动 ID 并与已知集合比对 |
| `core/src/services/cdn-resource-finder.ts` | 纯计算：Cocos bundle UUID 解码、版本哈希、CDN 图片地址拼接、配置表索引与路径解析 |
| `core/src/services/activity-cdn-resolver.ts` | 组合扫描器与 finder，解析活动卡片封面（本地原生图优先，回退官方 CDN） |
| `core/src/services/activity-update-monitor.ts` | 定时/手动触发扫描、`analyzeReport` 归并、结果落盘 `data/activity-update-report.json` |
| `core/src/controllers/admin/activity-update-routes.ts` | Admin 端点挂载与在线扫描器注入 |

## 数据来源与「择优适配」

- **在线扫描器**：B 依赖 `provider.getActivityDiscoverySnapshot` / `getActivityGroupSnapshot`
  （含 GetGroup 分组探针）。SL 没有对应的单组 RPC，故改用 `provider.getActivityDirectorySnapshot(accountId)`
  （返回已按活动分组聚合的 `{activities:[{id,name,activityIds,startTime,endTime}]}`），去除分组探针，
  仅做目录比对得出未登记活动 ID。
- **已知活动集合**：B 用 `activity` 服务的 `*_ACTIVITY_ID` 常量导出。SL 改为从
  `activity-gameplay-registry` 的静态登记（`buildActivityGameplayBindings({})` 的键）叠加
  CDN 卡片规则表 `ACTIVITY_CARD_ASSET_RULES` 收集。
- **鉴权**：沿用 SL 全局 `/api/*` 强制 `x-admin-token`；手机直取的源码图片路由
  `GET /activity-source-asset/:bundle/:filename` 置于 `/api` 之外（与抓包证书一致）。

## 平台限制（重要）

本机源码扫描（`activity-update-scanner`）与本地原生图片优先（`activity-cdn-resolver`）依赖
**macOS QQ 小程序容器路径**（`~/Library/Containers/com.tencent.qqexminiprogram/...`），或环境变量
`QQ_MINIAPP_SRC` / `QQ_MINIAPP_FS` 覆盖。在 Windows/Linux 部署上这些目录不存在：

- `scanActivityUpdates` 返回 `status:'unavailable'`；
- CDN 图片解析 `loadResolver` 抛错，`scanOnlineActivities` 已用 `try/catch` 降级为无图，
  **不影响在线活动 ID 检测**。

因此本基础设施在跨平台部署上的实际价值是「在线活动目录 diff 发现新活动 ID」，本机源码/CDN
取图为 macOS 增强项。

## 开关与节流

- 本机源码扫描**默认关闭**，仅当环境变量 `ACTIVITY_LOCAL_SCAN_ENABLED=true` 时启用；否则
  `runActivityUpdateScan` 使用空的本地报告，只做在线扫描。
- 定时间隔默认 3 小时，下限 60 秒，可用 `ACTIVITY_UPDATE_INTERVAL_MS` 覆盖。
- `startActivityUpdateMonitor` 在 admin 服务启动时挂载，`setImmediate` 触发一次初始扫描；
  账号未连接时在线扫描返回 `available:false`，`analyzeReport` 会保留上次成功的在线快照
  （`stale:true`），避免一次「暂不可用」清空已持久化活动。

## Admin 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/activity/update/status` | 监控状态与最近报告（`running/intervalMs/nextScanAt/report`） |
| GET | `/api/activity/directory` | 最近一次在线活动目录快照与未登记活动 ID |
| POST | `/api/activity/update/scan` | 立即触发一次扫描 |
| GET | `/activity-source-asset/:bundle/:filename` | 本机展开源码原生图片（`/api` 之外） |

> 当前仅提供后端与数据落盘，未接入前端面板页面；报告可通过上述端点或
> `data/activity-update-report.json` 读取。检测结果仅作**候选线索**，`safeToAutoApply:false`，
> 新玩法仍需人工补录协议与实现。

## 测试

`core/tests/activity-update.test.js` 覆盖 finder 的 UUID/版本/URL/缓存键解析、scanner 的
活动 ID 校验与 `unavailable` 报告、monitor 的候选分组与陈旧快照保留，以及路由的纯函数
（`collectKnownActivityIds`/`flattenDirectoryIds`/`findUnknownActivities`）。
