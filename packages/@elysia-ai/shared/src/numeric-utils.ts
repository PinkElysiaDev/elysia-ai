// ─────────────────────────────────────────────────
// 数值钳制工具
//
// 三个函数对应代码库中三种不同量纲，命名上刻意区分，避免误用：
//   - clampUnit:    [0, 1]      —— 概率 / 置信度 / 相关度评分
//   - clampUnitOr:  [0, 1] + 兜底 —— 同上，但输入非数字时回退到 fallback
//   - clampPercent: [0, 100] 取整 —— behavior 层的整数百分制信号强度
// ─────────────────────────────────────────────────

/**
 * 将分值钳制到 [0, 1] 区间。用于概率 / 置信度 / 相关度评分。
 */
export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * 将分值钳制到 [0, 1] 区间；输入非数字（undefined / NaN）时回退到 fallback。
 */
export function clampUnitOr(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

/**
 * 将分值钳制到 [0, 100] 并四舍五入取整。用于 behavior 层的整数百分制信号强度。
 * 注意：量纲与 clampUnit 不同，不可混用。
 */
export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}
