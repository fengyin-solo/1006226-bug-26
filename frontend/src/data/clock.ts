// 全平台统一的「今天」：业务口径（清污日期、台账记录时间、到期判断）都从这里取，
// 测试里可以用 setToday 固定时间，保证回填与排序结果可复现。

const FIXED_KEY = 'hydropower-plant-om:clock'

let override: string | null = null

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function today(): string {
  if (override) {
    return override
  }
  if (typeof window !== 'undefined') {
    const fixed = window.localStorage?.getItem(FIXED_KEY)
    if (fixed) {
      return fixed
    }
  }
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function setToday(value: string | null): void {
  override = value
}

export function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime()
  const b = new Date(`${to}T00:00:00`).getTime()
  return Math.round((b - a) / 86400000)
}
