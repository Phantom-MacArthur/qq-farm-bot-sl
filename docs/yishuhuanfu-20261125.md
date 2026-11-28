# 2026-11-25 以薯换福：命令号、状态槽与自动任务

## 协议索引

活动组 `2026111707`，主活动 `2026111708`，全部走 `gamepb.activitypb.ActivityService.Operate`，
命令号放在请求的 `operate_type` / 回包的同名字段里对照校验。

| cmd | 用途 | 请求 | 回包槽位 |
| --- | --- | --- | --- |
| 91 | 领当日红薯种子 | 空 | `grant{item_id,count}` |
| 92 | 查铺子行情 | `shop_gid` | `yshf_shop.quote{base_price,bonus_price,quota,shop}` + `can_sell` |
| 93 | 卖蜜薯 | `shop_gid,count` | `yshf_sell{count,price,total,quota,balance}` |
| 95 | 收购记录列表 | 空 | `yshf_records.records[]` |
| 96 | 兑换下单 | `index,count` | `yshf_exchange{price,balance,grant}` |
| 97 | 兑换目录 | 空 | `yshf_catalog.goods[]` |
| 98 | 分享铺子 | 空 | `yshf_share{price,grant,shop.share_key}` |
| 99 | 领取收购提成 | 空 | `yshf_commission{amount,balance}` |

状态槽 `130` 的语义（早期版本理解反过，已按抓包改正）：

- `1` claims：`seed_claimed` / `share_claimed`，服务端的今日领取标记，比本地日期记账可靠；
- `2` share：`bonus` / `timestamp`，分享暴击加成与分享时间；
- `3` 福气币余额；`5` 基础收购价；`6` 暴击加成；`7` 铺子今日接收总量；
- `11` 待领提成；`13` 提成标志。

成交价 = 基础价 + 加成。实机 111 + 33 = 144（自己铺子，与 cmd 93 成交价一致），
99 + 66 = 165（好友铺子，与游戏界面「今日蜜薯收购价」一致）。

cmd 92 的整体回包（对应官方 `MapleMarketGetShopRsp`）：

```proto
message YshfShopQueryReply {
    YshfShopQuote quote = 1;   // base_price / bonus_price / quota / shop
    bool can_sell = 2;         // 这个铺子当前收不收薯
}
```

- `can_sell` 三态：true 可收 / false 明确拒收 / 回包没带字段（按可卖处理）。protobufjs 对 bool
  取默认 `false`，读值分不清「明确 0」和「没下发」，所以先用 `hasOwnProperty` 判存在；
  只有明确 false 才拦下，新错误码 `YSHF_SHOP_CLOSED`。
- 剩余额度读 `quote.quota`（=官方 `remain_quota`），每天上限 8000；`8000 - quota` 是已用量。
- 自家铺子不占好友额度，比价表显示「不限量」。好友铺子需要 `can_sell !== false` 且 `quota > 0` 才能卖。

分享是两步：先 cmd 98，再 `gamepb.sharepb.ShareService.CheckCanShare` →
`ReportShare{field_1:28, field_4:2017}`，暴击加成要第二步才真正落地。第二步失败不阻断主流程，
但要把原因透出来，避免「分享没生效」被当成成功。

## 自动任务

`core/src/services/yishuhuanfu-auto.ts` 按活动开放时间调度。领种和首次分享会检查按账号和游戏日保存的完成状态。结果待确认时，后续巡查核对活动状态。提成在服务端显示有待领金额且可领取时领取。

### 卖薯的比价与风控

比价用 cmd 92 单独读取各家报价，候选包括面板账号及已同步的好友。定时比价每 10 秒查一家，其「重新比价」按钮仅刷新基础价或加成为 0 的已查铺子。「仅询价」模式下，「开始询价」会手动查一批候选铺子。手动比价每 3 秒查一家，报价按游戏日保存。

自动出售达到起卖数量后，按总价从高到低处理达到最低报价且有额度的铺子。自家及其他在线账号也参与排序。出售前会核对目标报价和额度，成交结果待确认时暂停本轮。未售库存由游戏日终结算。

## 配置项

- 默认每批查价上限 200 家，批次间隔 30 分钟，起卖数量 1 个，最低报价 450 福气币。
- 默认北京时间 12:00 开始自动出售，每半小时检查一轮，23:55 停止发出新订单。账号可以自选最早出售时间。
- 「不询价也不卖薯」停用好友比价及自动出售。「仅询价」由玩家点击「开始询价」后查一批好友铺子。「询价但不卖薯」定时查价。「自动询价并卖薯」定时查价并按策略出售。领种、分享和领提成有独立开关。

## 验证

- 固定抓包数值：144 = 111 + 33、165 = 99 + 66、记录 `total=4320 / commission=86`、`130.11=86`、
  cmd 99 回包 `32156`；
- `core/tests/yishuhuanfu-proto.test.js`、`yishuhuanfu-service.test.js` 和 `yishuhuanfu-auto.test.js` 分别覆盖协议、服务和自动化。实服执行情况可通过 `event=以薯换福自动` 的日志核对。
