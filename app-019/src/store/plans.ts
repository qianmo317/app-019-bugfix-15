// 方案库：localStorage 持久化 + 导出/导入 JSON
import type { Drawing, JointKind, Joint, Params } from '../types'
import { KIND_LABEL, JOINT_KINDS } from '../types'

const KEY = 'wjb.plans.v1'

export function loadPlans(): Drawing[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Drawing[]) : []
  } catch {
    return []
  }
}

export function savePlans(plans: Drawing[]): void {
  localStorage.setItem(KEY, JSON.stringify(plans))
}

export function upsertPlan(plan: Drawing): Drawing[] {
  const plans = loadPlans()
  const i = plans.findIndex((p) => p.id === plan.id)
  if (i >= 0) plans[i] = plan
  else plans.unshift(plan)
  savePlans(plans)
  return plans
}

export function deletePlan(id: string): Drawing[] {
  const plans = loadPlans().filter((p) => p.id !== id)
  savePlans(plans)
  return plans
}

export function getPlan(id: string): Drawing | undefined {
  return loadPlans().find((p) => p.id === id)
}

/** 按「榫卯类型 + 木料厚度」筛选 */
export function filterPlans(plans: Drawing[], kind: JointKind | 'all', thickness: number | 'all'): Drawing[] {
  return plans.filter((p) => {
    const j = p.joints[0]
    if (!j) return false
    if (kind !== 'all' && j.kind !== kind) return false
    if (thickness !== 'all' && p.joints[0].params.boardA.thickness !== thickness) return false
    return true
  })
}

export function exportJSON(plan: Drawing): string {
  return JSON.stringify(plan, null, 2)
}

/** 导入时可按默认值补全的项 */
const DEFAULT_KERF_MM = 1.1
const DEFAULT_WOOD: Params['wood'] = 'hardwood'
const DEFAULT_FIT: Params['fit'] = 'standard'

export interface ImportResult {
  plan: Drawing
  /** 导入时按默认值补全/修正的项（用于界面提示）；完整合法的文件为空 */
  fixes: string[]
}

/** 导入失败：信息中明确指出缺的是哪一项 */
export class PlanImportError extends Error {}

function finiteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 导入方案 JSON：
 * - 缺关键项（榫卯类型、A/B 板厚宽、params 结构）→ 抛 PlanImportError，信息逐项列清，绝不写入方案库
 * - 缺可补项（木料 wood、配合 fit、锯路 kerfMm、非法的可选参数、根字段）→ 按默认值补全并在 fixes 中说明
 */
export function importPlanJSON(text: string): ImportResult {
  let root: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new PlanImportError('导入失败：文件内容不是方案对象（根结构无效）')
    }
    root = parsed as Record<string, unknown>
  } catch (e) {
    if (e instanceof PlanImportError) throw e
    throw new PlanImportError('导入失败：文件不是有效的 JSON（解析失败），请确认文件完整')
  }

  const joints = root.joints
  if (!Array.isArray(joints) || joints.length === 0) {
    throw new PlanImportError('导入失败：缺少必要字段 joints（榫卯列表为空）')
  }
  const j0 = joints[0]
  if (!j0 || typeof j0 !== 'object') {
    throw new PlanImportError('导入失败：joints[0] 结构无效')
  }
  const jointRaw = j0 as Record<string, unknown>
  const kind = jointRaw.kind
  if (typeof kind !== 'string' || !JOINT_KINDS.some((k) => k.kind === kind)) {
    throw new PlanImportError('导入失败：缺少必要字段 kind（榫卯类型），或类型值无法识别')
  }
  const pr = jointRaw.params
  if (!pr || typeof pr !== 'object') {
    throw new PlanImportError('导入失败：缺少必要字段 params（加工参数）')
  }
  const paramsRaw = pr as Record<string, unknown>

  // —— 关键项：A/B 板的板厚、板宽，缺一项都拒绝导入，错误信息逐项列清 ——
  const missing: string[] = []
  const readBoard = (key: string, label: string): { thickness: number; width: number } | null => {
    const b = paramsRaw[key]
    if (!b || typeof b !== 'object') {
      missing.push(`${label}（params.${key}：板厚 thickness、板宽 width 整体缺失）`)
      return null
    }
    const br = b as Record<string, unknown>
    const fields: { thickness?: number; width?: number } = {}
    if (!finiteNumber(br.thickness) || br.thickness <= 0) {
      missing.push(`${label}板厚（params.${key}.thickness）`)
    } else {
      fields.thickness = br.thickness
    }
    if (!finiteNumber(br.width) || br.width <= 0) {
      missing.push(`${label}板宽（params.${key}.width）`)
    } else {
      fields.width = br.width
    }
    return fields.thickness !== undefined && fields.width !== undefined
      ? { thickness: fields.thickness, width: fields.width }
      : null
  }
  const boardA = readBoard('boardA', '件A/齿板')
  const boardB = readBoard('boardB', '件B/销板')
  if (missing.length > 0) {
    throw new PlanImportError(`导入失败：缺少关键参数——${missing.join('；')}。请在原文件补全后再导入`)
  }

  // —— 可补项：木料 / 配合 / 锯路，缺了或非法就按默认补，并记下来说给用户听 ——
  const fixes: string[] = []
  const params = { ...paramsRaw } as Record<string, unknown>
  params.boardA = boardA
  params.boardB = boardB

  if (params.wood !== 'hardwood' && params.wood !== 'softwood') {
    params.wood = DEFAULT_WOOD
    fixes.push('缺少木料（wood），已按默认「硬木 hardwood」补全')
  }
  if (params.fit !== 'tight' && params.fit !== 'standard' && params.fit !== 'loose') {
    params.fit = DEFAULT_FIT
    fixes.push('缺少配合松紧（fit），已按默认「标准 standard」补全')
  }
  if (!finiteNumber(params.kerfMm) || params.kerfMm <= 0) {
    params.kerfMm = DEFAULT_KERF_MM
    fixes.push(`缺少锯路（kerfMm），已按默认 ${DEFAULT_KERF_MM}mm 补全`)
  }

  // 燕尾/直榫可选参数：非法值按默认修正，避免 NaN 图纸
  if (params.dovetail !== undefined) {
    if (typeof params.dovetail !== 'object' || params.dovetail === null) {
      delete params.dovetail
      fixes.push('燕尾参数（dovetail）结构无效，已移除并改按自动参数')
    } else {
      const d = { ...(params.dovetail as Record<string, unknown>) }
      if (![6, 7, 8].includes(d.angleRatio as number)) {
        d.angleRatio = 8
        fixes.push('燕尾角度比（angleRatio）非法，已按默认 1:8 补全')
      }
      if (
        d.teeth !== undefined &&
        (!finiteNumber(d.teeth) || d.teeth < 0 || d.teeth > 12 || !Number.isInteger(d.teeth))
      ) {
        delete d.teeth
        fixes.push('燕尾齿数（teeth）非法，已移除并改按自动建议齿数')
      }
      params.dovetail = d
    }
  }
  if (params.tenon !== undefined) {
    if (typeof params.tenon !== 'object' || params.tenon === null) {
      delete params.tenon
      fixes.push('直榫参数（tenon）结构无效，已移除并改按默认参数')
    } else {
      const t = { ...(params.tenon as Record<string, unknown>) }
      if (!finiteNumber(t.thicknessRatio) || t.thicknessRatio < 0.2 || t.thicknessRatio > 0.5) {
        t.thicknessRatio = 1 / 3
        fixes.push('直榫榫厚/料厚比（thicknessRatio）非法，已按默认 1/3 补全')
      }
      if (!finiteNumber(t.lengthRatio) || t.lengthRatio < 0.4 || t.lengthRatio > 1) {
        t.lengthRatio = 1
        fixes.push('直榫榫长/孔板厚比（lengthRatio）非法，已按默认 1（穿透）补全')
      }
      if (!finiteNumber(t.offsetFromFace) || t.offsetFromFace < 0) {
        delete t.offsetFromFace
        fixes.push('直榫腹边距（offsetFromFace）非法，已移除并改按居中处理')
      }
      params.tenon = t
    }
  }

  // —— 组装 joint（无修正时保持原对象引用，保证导出/导入往返全等）——
  let jointsOut = joints as Joint[]
  if (fixes.length > 0) {
    const notes = Array.isArray(jointRaw.notes) ? (jointRaw.notes as string[]) : []
    const fixedJoint: Joint = { kind: kind as JointKind, params: params as unknown as Params, notes }
    jointsOut = joints.slice() as Joint[]
    jointsOut[0] = fixedJoint
  }

  // —— 根字段缺失按默认补全 ——
  const plan = { ...root } as Partial<Drawing>
  plan.joints = jointsOut
  if (typeof plan.id !== 'string' || plan.id === '') {
    plan.id = newId()
    fixes.push('缺少方案 id，已自动生成')
  }
  if (typeof plan.title !== 'string') {
    plan.title = '导入方案'
    fixes.push('缺少标题（title），已按「导入方案」补全')
  }
  if (!Array.isArray(plan.parts)) {
    plan.parts = [
      { id: newId(), name: '件 A（齿板/榫舌板）', w: boardA!.width, h: boardA!.thickness, qty: 1, jointIds: [] },
      { id: newId(), name: '件 B（销板/榫孔板）', w: boardB!.width, h: boardB!.thickness, qty: 1, jointIds: [] },
    ]
    fixes.push('缺少零件清单（parts），已按两块板补全')
  }
  if (plan.scale !== '1:1' && plan.scale !== '1:2' && plan.scale !== '1:5') {
    plan.scale = '1:1'
    fixes.push('缺少出图比例（scale），已按 1:1 补全')
  }
  if (!finiteNumber(plan.updatedAt)) {
    plan.updatedAt = Date.now()
    fixes.push('缺少更新时间（updatedAt），已按当前时间补全')
  }

  return { plan: plan as Drawing, fixes }
}

/** 导入校验：结构合法且关键项齐全返回 Drawing，否则抛错（错误信息逐项列出缺失字段） */
export function importJSON(text: string): Drawing {
  return importPlanJSON(text).plan
}

export function downloadJSON(plan: Drawing): void {
  const blob = new Blob([exportJSON(plan)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${plan.title || 'plan'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

let seq = 0
export function newId(): string {
  seq++
  return `p${Date.now().toString(36)}${seq.toString(36)}`
}

export function makePlan(kind: JointKind, params: Params, notes: string[] = []): Drawing {
  const tA = params.boardA.thickness
  const tB = params.boardB.thickness
  return {
    id: newId(),
    title: `${KIND_LABEL[kind]} · ${tA}/${tB}mm`,
    parts: [
      { id: newId(), name: '件 A（齿板/榫舌板）', w: params.boardA.width, h: tA, qty: 1, jointIds: [] },
      { id: newId(), name: '件 B（销板/榫孔板）', w: params.boardB.width, h: tB, qty: 1, jointIds: [] },
    ],
    joints: [{ kind, params, notes }],
    scale: '1:1',
    updatedAt: Date.now(),
  }
}
