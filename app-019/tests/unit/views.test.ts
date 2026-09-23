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

  it('燕尾侧视图：两端半齿销有「半」标，整销梯形贴合面宽/背面窄', () => {
    const joint = makeJoint('dovetail')
    const r = computeJoint(joint)
    const views = buildViews(joint, r)
    const side = views.find((v) => v.id === 'side')!
    // 两端半齿销标记
    const halfMarks = side.marks.filter((m) => m.text === '半')
    expect(halfMarks).toHaveLength(2)
    // 整销数量 = 齿数 − 1
    const pinMarks = side.marks.filter((m) => m.text.startsWith('销'))
    expect(pinMarks).toHaveLength(r.dovetail!.teeth.length - 1)
    // 存在从贴合面（y=0 宽）斜向背面（y=tB 窄）的斜边
    const slants = side.lines.filter((l) => l.y1 === 0 && l.y2 === joint.params.boardB.thickness && l.x1 !== l.x2)
    expect(slants.length).toBeGreaterThan(0)
    // 左侧整销的左斜边：贴合面 x < 背面 x（向内收窄）
    const firstPin = r.dovetail!.pins.find((p) => !p.half)!
    const leftSlant = slants.find((l) => Math.abs(l.x1 - firstPin.mateX) < 1e-6)!
    expect(leftSlant.x2).toBeGreaterThan(leftSlant.x1)
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
