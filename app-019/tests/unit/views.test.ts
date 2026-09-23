// 三视图一致性（蓝图 §10：正视图宽度 = 俯视图宽度）+ 锯路补偿 + 切割清单
import { describe, it, expect } from 'vitest'
import { computeJoint } from '../../src/lib/calc'
import { buildViews } from '../../src/geometry/views'
import { buildCutList } from '../../src/lib/cutlist'
import type { Joint, JointKind } from '../../src/types'

const JOINTS: JointKind[] = ['dovetail', 'half-blind-dovetail', 'mortise-tenon', 'dowel', 'lap', 'panel-glue']

function makeJoint(kind: JointKind): Joint {
  return {
    kind,
    params: {
      boardA: { thickness: 18, width: 200 },
      boardB: { thickness: 18, width: 200 },
      wood: 'hardwood',
      fit: 'standard',
      dovetail: { angleRatio: 8 },
      tenon: { thicknessRatio: 1 / 3, lengthRatio: 1, offsetFromFace: 0 },
      kerfMm: 1.1,
    },
    notes: [],
  }
}

describe('三视图一致性（断言：正视图宽 = 俯视图宽）', () => {
  for (const kind of JOINTS) {
    it(`${kind}: front.contentW === top.contentW`, () => {
      const joint = makeJoint(kind)
      const r = computeJoint(joint)
      const views = buildViews(joint, r)
      expect(views).toHaveLength(3)
      const front = views.find((v) => v.id === 'front')!
      const top = views.find((v) => v.id === 'top')!
      const side = views.find((v) => v.id === 'side')!
      expect(front.contentW).toBe(top.contentW)
      expect(side).toBeTruthy()
      // 视图内几何不得越界（局部坐标 −40~content+60 之外不允许）
      for (const v of views) {
        for (const l of v.lines) {
          expect(l.x1).toBeGreaterThanOrEqual(-40)
          expect(l.y1).toBeGreaterThanOrEqual(-40)
          expect(l.x2).toBeLessThanOrEqual(v.contentW + 60)
          expect(l.y2).toBeLessThanOrEqual(v.contentH + 60)
        }
      }
    })
  }

  it('燕尾：锯切线数量 = 2×齿数（每齿两侧 kerf 补偿线）', () => {
    const joint = makeJoint('dovetail')
    const r = computeJoint(joint)
    const views = buildViews(joint, r)
    const front = views.find((v) => v.id === 'front')!
    const sawCount = front.lines.filter((l) => l.cls === 'saw').length
    expect(sawCount).toBe(r.dovetail!.teeth.length * 2)
  })

  it('燕尾：齿序编号覆盖每个齿', () => {
    const joint = makeJoint('dovetail')
    const r = computeJoint(joint)
    const views = buildViews(joint, r)
    const front = views.find((v) => v.id === 'front')!
    expect(front.marks.map((m) => m.text)).toEqual(r.dovetail!.teeth.map((t) => String(t.index)))
  })

  it('燕尾侧视图：销从贴合面(y=0,宽端)到背面按 1:r 变窄，水平斜移 = 齿板斜移量，两端半齿销', () => {
    const joint = makeJoint('dovetail') // tA=tB=18, ratio=8
    const r = computeJoint(joint)
    const views = buildViews(joint, r)
    const side = views.find((v) => v.id === 'side')!
    const dt = r.dovetail!
    const tB = joint.params.boardB.thickness
    const s = dt.slopeOffset // 18/8 = 2.25，与齿板严格互补（不是 tB/ratio 之外的别的值）
    expect(s).toBeCloseTo(tB / 8, 6)

    // 每个销两条斜线（全销两侧内收；半销内侧内收、外侧贴板边竖直）
    const slanted = side.lines.filter(
      (l) => l.cls === 'cut' && l.y1 === 0 && l.y2 === tB && Math.abs(l.x1 - l.x2) > 1e-9,
    )
    const pinCount = dt.pins.length
    expect(slanted).toHaveLength(pinCount * 2 - 2) // 去掉两条半销外缘竖线
    // 半销外缘竖线与板边重合（两端看得到半齿销）
    const verticals = side.lines.filter(
      (l) => l.cls === 'cut' && l.y1 === 0 && l.y2 === tB && Math.abs(l.x1 - l.x2) < 1e-9,
    )
    expect(verticals.some((l) => l.x1 === 0)).toBe(true)
    expect(verticals.some((l) => l.x1 === side.contentW)).toBe(true)

    // 全销：贴合面宽 topW → 背面窄 2s（= rootW），与齿板正面图案互补
    const full = dt.pins.find((p) => !p.half)!
    const left = slanted.find((l) => Math.abs(l.x1 - full.jointX) < 1e-9)!
    const right = slanted.find((l) => Math.abs(l.x1 - (full.jointX + full.jointW)) < 1e-9)!
    expect(left.x2).toBeCloseTo(full.jointX + s, 6)
    expect(right.x2).toBeCloseTo(full.jointX + full.jointW - s, 6)
    // 斜度必须真实存在（修复前：中间贴合面与背面同宽，斜度丢失）
    expect(2 * s).toBeGreaterThan(0)

    // 半齿销：外侧贴板边，内侧内收 s；背面半销宽 = 边距
    const leftHalf = dt.pins.find((p) => p.half && p.index === 0)!
    const rightHalf = dt.pins.find((p) => p.half && p.index === pinCount - 1)!
    const lhInner = slanted.find((l) => Math.abs(l.x1 - leftHalf.jointW) < 1e-9)!
    expect(lhInner.x2).toBeCloseTo(leftHalf.jointW - s, 6)
    const rhInner = slanted.find((l) => Math.abs(l.x1 - rightHalf.jointX) < 1e-9)!
    expect(rhInner.x2).toBeCloseTo(rightHalf.jointX + s, 6)
  })

  it('半隐燕尾侧视图：销只切到齿深 0.75×板厚，槽底销宽 = 齿根宽（与正面互补）', () => {
    const joint = makeJoint('half-blind-dovetail')
    const r = computeJoint(joint)
    const views = buildViews(joint, r)
    const side = views.find((v) => v.id === 'side')!
    const dt = r.dovetail!
    const depth = 0.75 * joint.params.boardB.thickness
    expect(dt.depth).toBeCloseTo(depth, 6)
    const pinLines = side.lines.filter(
      (l) => l.cls === 'cut' && l.y1 === 0 && Math.abs(l.y2 - depth) < 1e-9,
    )
    expect(pinLines.length).toBe(dt.pins.length * 2)
    // 槽底线：相邻销尖之间（销数 − 1 条）
    const floorLines = side.lines.filter((l) => l.cls === 'cut' && l.y1 === depth && l.y2 === depth)
    expect(floorLines.length).toBe(dt.pins.length - 1)
    for (const l of floorLines) expect(l.x2 - l.x1).toBeGreaterThan(0)

    // 全销槽底端宽 ≈ 齿根宽 rootW（水平斜移取齿板 slopeOffset；网格/半格误差 ≤0.15）
    const s = dt.slopeOffset
    for (const pin of dt.pins.filter((p) => !p.half)) {
      expect(Math.abs(pin.jointW - 2 * s - dt.teeth[pin.index - 1].rootW)).toBeLessThanOrEqual(0.15 + 1e-9)
    }
  })
})

describe('切割清单', () => {
  for (const kind of JOINTS) {
    it(`${kind}: A/B 两件步骤非空且有序`, () => {
      const joint = makeJoint(kind)
      const r = computeJoint(joint)
      const cut = buildCutList(joint, r.dovetail, r.tenon)
      expect(cut.boardA.length).toBeGreaterThan(0)
      expect(cut.boardB.length).toBeGreaterThan(0)
      expect(cut.boardA.map((s) => s.no)).toEqual(cut.boardA.map((s) => s.no).sort((a, b) => a - b))
      expect(cut.cautions.length).toBeGreaterThanOrEqual(2)
      expect(cut.cautions.some((c) => c.includes('锯路'))).toBe(true)
      expect(cut.cautions.some((c) => c.includes('锯切线'))).toBe(true)
    })
  }
})
