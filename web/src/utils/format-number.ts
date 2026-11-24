/**
 * 项目内统一的数值展示方法，避免各组件重复实现同一套换算规则。
 *
 * - formatNumber：千分位完整数值，用于悬停提示等需要精确值的位置。
 * - formatCompactAmount：紧凑写法（万 / 亿），用于空间固定的标签、卡片与资源条。
 */

const WAN = 1e4
const YI = 1e8
const REWARD_CURRENCY_IDS = new Set([1, 1001, 1002, 1004, 1005, 1007, 1008])

export function formatRewardAmount(id: unknown, count: unknown): string {
  return REWARD_CURRENCY_IDS.has(Number(id))
    ? formatCompactAmount(Number(count))
    : formatNumber(count)
}

/**
 * 千分位完整数值，非数值统一按 0 处理。
 * 例：`12930` → `12,930`。
 */
export function formatNumber(value: unknown): string {
  const num = Number(value)
  return Number.isFinite(num) ? num.toLocaleString('zh-CN') : '0'
}

function trimUnit(scaled: number, unit: string): string {
  return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}${unit}`
}

/**
 * 把货币等大数值压成「万 / 亿」短格式。
 *
 * 规则：
 * - 不足 1 万：保留千分位原样（最多 4 位，如 `9,999`）。
 * - 1 万 ~ 1 亿：`xx.x万`，整数不补 `.0`（`12000` → `1.2万`，`100000` → `10万`）。
 * - ≥ 1 亿：`xx.x亿`。
 * - 四舍五入进位后跨档时升级单位，避免出现 `10000万` 这种写法。
 * - 负数保留符号并按绝对值换算（`-12000` → `-1.2万`）。
 * - `null` 表示余额未确认，原样输出 `--`，不能当成 0。
 */
export function formatCompactAmount(value: number | null): string {
  if (value === null)
    return '--'
  const raw = Math.trunc(Number(value) || 0)
  const sign = raw < 0 ? '-' : ''
  const amount = Math.abs(raw)
  if (amount < WAN)
    return `${sign}${formatNumber(amount)}`
  if (amount >= YI)
    return `${sign}${trimUnit(Math.round(amount / YI * 10) / 10, '亿')}`

  const wan = Math.round(amount / WAN * 10) / 10
  // 9999.95万 四舍五入后是 10000万，改写成 1亿 更易读。
  if (wan >= 1e4)
    return `${sign}${trimUnit(Math.round(amount / YI * 10) / 10, '亿')}`
  return `${sign}${trimUnit(wan, '万')}`
}
