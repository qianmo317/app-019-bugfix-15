// 燕尾榫齿宽分配算法（带约束的分配问题，纯函数）
// 设计约定（蓝图 §8）：
//  - 在齿板正面（展示面）划线：边距(半齿) + 齿1 + 槽 + 齿2 + ... + 齿n + 边距
//  - 均衡布局：槽宽 = 齿根宽、边距 = 半个齿根宽 → Σ(齿顶宽) + Σ(齿根宽) = 板宽（严格闭合）
//  - 齿顶宽（展示面）= 齿根宽 + 2 × 斜移量；斜移量 = 齿深 / 角度比 r（1:r）
import type { Wood } from '../types'
import { round01 } from './format'

const U = 0.1 // 0.1mm 网格

/** 齿根最小安全宽度（mm，经验值） */
export const MIN_ROOT: Record<Wood, number> = { softwood: 6, hardwood: 4 }

export interface DovetailInput {
  width: number     // 齿板宽度 W (mm)
  thickness: number // 齿板厚度 t (mm)
  ratio: 6 | 7 | 8  // 角度比 1:r
  teeth?: number    // 齿数（缺省自动建议）
  kerf: number      // 锯路宽度 (mm)
  wood: Wood
  pinThickness?: number     // 销板（B 板）厚度，缺省与齿板同厚（决定销板斜移量 tB/r）
  blind?: boolean          // 半隐燕尾
  blindDepthRatio?: number // 半隐深度比例，默认 0.75
}

export interface ToothCell {
  index: number  // 齿号 1..n
  topW: number   // 齿顶宽（展示面）
  rootW: number  // 齿根宽（背面）
  faceX: number  // 展示面左边缘 x 坐标
  backX: number  // 背面左边缘 x 坐标
}

export interface PinCell {
  index: number
  /** 贴合面（与齿板贴合的一面，y=0）处左缘 x */
  mateX: number
  /** 贴合面处销宽（宽端，与齿间槽互补） */
  mateW: number
  /** 背面（y=tB，外侧）处左缘 x */
  backX: number
  /** 背面处销宽（窄端 = mateW − 2×销板斜移量） */
  backW: number
  /** 销板沿厚度方向的单边斜移量 = 销板厚 / r */
  taper: number
  half: boolean // 边缘半齿销
}

export interface DovetailResult {
  teeth: ToothCell[]
  pins: PinCell[]
  margin: number      // 首尾半齿边距（左右对称）
  slopeOffset: number // 单边斜移量 = 齿深 / r
  depth: number       // 齿深（穿透=板厚，半隐=0.75×板厚）
  pitch: number       // 齿距 ≈ W/n
  warnings: string[]
  closureError: number // |Σ齿顶 + Σ齿根 − 板宽|
  minRootW: number
  minTopW: number
  minPinBackW: number // 整销背面最窄处（n−1 个整销）
}

/** 齿数自动建议：目标齿距约 28mm，并保证齿根宽不低于最小安全值 */
export function suggestTeeth(
  width: number,
  thickness: number,
  ratio: 6 | 7 | 8,
  wood: Wood,
  blind = false,
): number {
  const depth = blind ? thickness * 0.75 : thickness
  const off = depth / ratio
  let n = Math.max(2, Math.min(12, Math.round(width / 28)))
  while (n > 2 && width / (2 * n) - off < MIN_ROOT[wood]) n--
  return n
}

export function computeDovetail(input: DovetailInput): DovetailResult {
  const { width, thickness, ratio, kerf, wood, blind } = input
  const warnings: string[] = []
  const depth = blind ? round01(thickness * (input.blindDepthRatio ?? 0.75)) : thickness
  const slopeOffset = depth / ratio
  const n = input.teeth ?? suggestTeeth(width, thickness, ratio, wood, blind)
  const minRootW = MIN_ROOT[wood]
  const minTopW = round01(2 * kerf)

  // —— 0.1mm 网格上的等分 + 余量处理 ——
  // 总网格数分配到 n 个齿（齿顶+齿根 成对），累积取整差分保证 Σpair 严格等于总宽
  const totalUnits = Math.round(width / U)
  const per = totalUnits / n
  // 累积取整差分：Σpair 严格等于 totalUnits，逐齿偏差 ≤ 1 格（0.1mm）
  const pairs: number[] = []
  for (let i = 0; i < n; i++) {
    pairs.push(Math.round(per * (i + 1)) - Math.round(per * i))
  }
  // 每对内分齿顶/齿根：齿顶−齿根 = 2×斜移量（0.1 网格取整，逐齿误差 ≤0.1mm）
  const d = Math.round((2 * slopeOffset) / U)
  const topUnits: number[] = pairs.map((p) => Math.round((p + d) / 2))
  const rootUnits: number[] = pairs.map((p, i) => p - topUnits[i])

  // 边距（半齿）= 末齿齿根宽一半，左右严格对称；槽宽 = 相邻齿根宽
  const margin = (rootUnits[n - 1] / 2) * U
  // 齿背单边斜移（0.1mm 网格）：d = round(2×斜移/0.1)，背面偏移取 d/2 格
  const backShift = (d / 2) * U
  const teeth: ToothCell[] = []
  let x = margin
  for (let i = 0; i < n; i++) {
    const topW = topUnits[i] * U
    const rootW = rootUnits[i] * U
    teeth.push({ index: i + 1, topW, rootW, faceX: x, backX: x + backShift })
    x += topW
    if (i < n - 1) x += rootW // 齿间槽
  }
  const closureError = Math.abs(x + margin - width)

  // —— 销板（B 板）互补齿形 ——
  // 齿板端面布局：边距 + 齿1 + 槽1 + 齿2 + … + 槽(n-1) + 齿n + 边距
  // 销板端面必须是它的互补件：n+1 个销，其中 n−1 个整销一一落进齿间槽，两端各一个半齿销。
  // 贴合面与齿板背面同廓：整销边界直接取相邻齿根的实际坐标（snap 到 0.1 网格，逐格重合无缝）；
  // 背面沿销板厚再收 1:r 斜度：单边斜移 pinTaper = tB/r（同厚时与齿背半步长一致）。
  const pinTaper =
    input.pinThickness === undefined || Math.abs((input.pinThickness ?? thickness) - thickness) < 1e-9
      ? backShift
      : round01(input.pinThickness ?? thickness) / ratio
  const snap = (v: number) => Math.round(v / U) * U
  const halfMateW = snap(margin + backShift)
  const pins: PinCell[] = []
  // 左端半齿销：贴合面 [0, margin + backShift]，外缘贴板边只收内侧
  pins.push({
    index: 0,
    mateX: 0,
    mateW: halfMateW,
    backX: 0,
    backW: halfMateW - pinTaper,
    taper: pinTaper,
    half: true,
  })
  // 整销：落在齿 i 与齿 i+1 之间的槽里（共 n−1 个）
  for (let i = 0; i < n - 1; i++) {
    const mateX = snap(teeth[i].backX + teeth[i].rootW)
    const mateW = snap(teeth[i + 1].backX - mateX)
    pins.push({
      index: i + 1,
      mateX,
      mateW,
      backX: mateX + pinTaper,
      backW: mateW - 2 * pinTaper,
      taper: pinTaper,
      half: false,
    })
  }
  // 右端半齿销：贴合面 [W − margin − backShift, W]
  const rightMateX = snap(width - halfMateW)
  pins.push({
    index: n,
    mateX: rightMateX,
    mateW: halfMateW,
    backX: rightMateX + pinTaper,
    backW: halfMateW - pinTaper,
    taper: pinTaper,
    half: true,
  })

  // —— 约束校验与警告（不允许静默输出）——
  const minRoot = Math.min(...rootUnits) * U
  const minTop = Math.min(...topUnits) * U
  if (minRoot < 0) {
    warnings.push(
      `齿数 ${n} 过多：齿根宽为负值，无法排布。请减少齿数或减小角度比（当前 1:${ratio}）`,
    )
  } else if (minRoot < minRootW) {
    warnings.push(
      `齿根宽最低 ${minRoot.toFixed(1)}mm，低于${wood === 'softwood' ? '软木' : '硬木'}最小安全值 ${minRootW}mm，齿根易劈裂；建议减少齿数`,
    )
  }
  if (minTop < minTopW && minTop >= 0) {
    warnings.push(
      `齿顶宽最低 ${minTop.toFixed(1)}mm，小于锯路宽 2 倍（${minTopW.toFixed(1)}mm），锯片切不出来；建议减少齿数或换细锯路`,
    )
  }
  if (n < 3 && width >= 150) {
    warnings.push(`齿数过少（${n} 齿），板宽 ${width}mm 建议至少 3 齿以保证结合强度`)
  }
  const pitch = width / n
  if (pitch < 15 && pitch > 0) {
    warnings.push(`齿距仅 ${pitch.toFixed(1)}mm，过小易劈裂，建议减少齿数`)
  }
  if (n < 2 || n > 12) {
    warnings.push(`齿数 ${n} 超出合理范围（2~12）`)
  }
  // 销板互补校验：整销背面宽不得被斜度吃光（背面宽 = 槽根宽 − 2×tB/r）
  const fullPins = pins.filter((p) => !p.half)
  const minPinBack = fullPins.length ? Math.min(...fullPins.map((p) => p.backW)) : Infinity
  if (minRoot >= 0 && minPinBack < 0) {
    warnings.push(
      `销板斜度 1:${ratio} 过大：整销背面宽为负值（销板厚 ${input.pinThickness ?? thickness}mm 时单边收窄 ${pinTaper.toFixed(1)}mm），销会被切没。请增大角度比（r）、减薄销板或减少齿数`,
    )
  }

  return {
    teeth,
    pins,
    margin,
    slopeOffset,
    depth,
    pitch,
    warnings,
    closureError,
    minRootW,
    minTopW,
    minPinBackW: Number.isFinite(minPinBack) ? minPinBack : 0,
  }
}
