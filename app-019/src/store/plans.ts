// 方案库：localStorage 持久化 + 导出/导入 JSON
import type { Drawing, JointKind, Joint, Params, Wood, Fit } from '../types'
import { KIND_LABEL } from '../types'

const KEY = 'wjb.plans.v1'

/** 导入时可按默认补齐的项（缺了不致命，补后照常出图） */
const IMPORT_DEFAULTS = {
  wood: 'hardwood' as Wood,
  fit: 'standard' as Fit,
  kerfMm: 1.1,
}

export interface ImportResult {
  plan: Drawing
  /** 本次导入按默认补齐的字段（人类可读，供页面提示） */
  repaired: string[]
}

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

/**
 * 导入校验：缺关键项必须抛错并说清缺哪一项；可补项（木料/配合/锯路等）按默认补齐。
 * 关键项（缺失或非法即拒绝，防止坏数据写回方案库）：
 *   joints 数组、joints[0].kind（合法六类之一）、
 *   params.boardA / boardB 两块板的 thickness / width（正有限数）。
 * 可补项：id、title、parts、notes、scale、updatedAt、wood、fit、kerfMm、dovetail/tenon 子项。
 */
export function importJSON(text: string): ImportResult {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    throw new Error('导入失败：文件不是合法 JSON（可能已损坏），未写入方案库')
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('导入失败：方案根结构必须是 JSON 对象，未写入方案库')
  }
  const raw = obj as Partial<Drawing>
  const repaired: string[] = []

  const rawJoints = raw.joints
  if (!Array.isArray(rawJoints) || rawJoints.length === 0) {
    throw new Error('导入失败：缺少必要字段 joints（榫卯列表为空），未写入方案库')
  }
  const rawJoint = rawJoints[0] as Partial<Joint> | undefined
  if (!rawJoint || typeof rawJoint !== 'object') {
    throw new Error('导入失败：缺少必要字段 joints[0]（榫卯定义），未写入方案库')
  }
  const kind = rawJoint.kind as JointKind
  if (!kind || !Object.prototype.hasOwnProperty.call(KIND_LABEL, kind)) {
    throw new Error(`导入失败：缺少必要字段 joints[0].kind，或类型不被识别（读到 ${String(rawJoint.kind)}），未写入方案库`)
  }
  const rp = rawJoint.params as Partial<Params> | undefined
  if (!rp || typeof rp !== 'object') {
    throw new Error('导入失败：缺少必要字段 params（加工参数），未写入方案库')
  }

  // —— 两块板的厚度/宽度：关键项，逐项列明缺失/非法 ——
  let missing: string[] = []
  const readBoardDim = (board: unknown, dim: 'thickness' | 'width', label: string): number | null => {
    const b = board as Partial<Params['boardA']> | undefined
    const v = b?.[dim]
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      missing.push(`${label}${dim === 'thickness' ? '板厚' : '板宽'}`)
      return null
    }
    return v
  }
  if (!rp.boardA || typeof rp.boardA !== 'object') missing.push('件 A（齿板/榫舌板）整项')
  if (!rp.boardB || typeof rp.boardB !== 'object') missing.push('件 B（销板/榫孔板）整项')
  const aT = readBoardDim(rp.boardA, 'thickness', '件 A ')
  const aW = readBoardDim(rp.boardA, 'width', '件 A ')
  const bT = readBoardDim(rp.boardB, 'thickness', '件 B ')
  const bW = readBoardDim(rp.boardB, 'width', '件 B ')
  if (missing.length > 0) {
    throw new Error(`导入失败：缺少关键参数「${missing.join('、')}」（必须为正数），未写入方案库；请在原文件补齐后重新导入`)
  }

  // 快速路径：结构完整、无任何补齐项时原样返回（保证 exportJSON → importJSON 与原文全等）
  const shellComplete =
    typeof raw.id === 'string' &&
    raw.id.trim().length > 0 &&
    typeof raw.title === 'string' &&
    raw.title.trim().length > 0 &&
    (raw.scale === '1:1' || raw.scale === '1:2' || raw.scale === '1:5') &&
    typeof raw.updatedAt === 'number' &&
    Array.isArray(raw.parts) &&
    Array.isArray(rawJoint.notes)
  const paramsComplete =
    (rp.wood === 'softwood' || rp.wood === 'hardwood') &&
    (rp.fit === 'tight' || rp.fit === 'standard' || rp.fit === 'loose') &&
    typeof rp.kerfMm === 'number' &&
    rp.kerfMm > 0 &&
    (rp.dovetail === undefined ||
      (rp.dovetail !== null && (rp.dovetail.angleRatio === 6 || rp.dovetail.angleRatio === 7 || rp.dovetail.angleRatio === 8)))
  if (shellComplete && paramsComplete) {
    return { plan: raw as Drawing, repaired: [] }
  }

  // —— 可补项：木料 / 配合 / 锯路 ——
  let wood: Wood = IMPORT_DEFAULTS.wood
  if (rp.wood === 'softwood' || rp.wood === 'hardwood') {
    wood = rp.wood
  } else if (rp.wood !== undefined) {
    repaired.push(`木料种类（读到 ${String(rp.wood)} 不合法，按硬木补）`)
  } else {
    repaired.push('木料种类（按硬木补）')
  }
  let fit: Fit = IMPORT_DEFAULTS.fit
  if (rp.fit === 'tight' || rp.fit === 'standard' || rp.fit === 'loose') {
    fit = rp.fit
  } else if (rp.fit !== undefined) {
    repaired.push(`配合松紧（读到 ${String(rp.fit)} 不合法，按标准补）`)
  } else {
    repaired.push('配合松紧（按标准补）')
  }
  let kerfMm = IMPORT_DEFAULTS.kerfMm
  if (typeof rp.kerfMm === 'number' && Number.isFinite(rp.kerfMm) && rp.kerfMm > 0) {
    kerfMm = rp.kerfMm
  } else if (rp.kerfMm !== undefined) {
    repaired.push(`锯路宽度（读到 ${String(rp.kerfMm)} 不合法，按 1.1mm 补）`)
  } else {
    repaired.push('锯路宽度（按 1.1mm 补）')
  }

  // —— 可选榫型子项：存在但结构非法才剔除，缺省走算法默认（齿数自动建议等）——
  let dovetail: Params['dovetail']
  if (rp.dovetail !== undefined) {
    const ratio = rp.dovetail?.angleRatio
    if (ratio === 6 || ratio === 7 || ratio === 8) {
      const teeth = rp.dovetail.teeth
      dovetail = {
        angleRatio: ratio,
        ...(typeof teeth === 'number' && Number.isFinite(teeth) && teeth >= 0 && teeth <= 12
          ? { teeth: teeth === 0 ? undefined : teeth }
          : {}),
      }
    } else {
      repaired.push('燕尾角度比（不合法，按 1:8 补）')
      dovetail = { angleRatio: 8 }
    }
  }
  let tenon: Params['tenon']
  if (rp.tenon !== undefined && typeof rp.tenon === 'object') {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    tenon = {
      thicknessRatio: num(rp.tenon.thicknessRatio) ?? 1 / 3,
      lengthRatio: num(rp.tenon.lengthRatio) ?? 1,
      offsetFromFace: num(rp.tenon.offsetFromFace) ?? 0,
    }
  }

  const params: Params = {
    boardA: { thickness: aT as number, width: aW as number },
    boardB: { thickness: bT as number, width: bW as number },
    wood,
    fit,
    kerfMm,
    ...(dovetail ? { dovetail } : {}),
    ...(tenon ? { tenon } : {}),
  }

  // —— 方案外壳字段补齐 ——
  let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : ''
  if (!id) {
    id = newId()
    repaired.push('方案 id（重新生成）')
  }
  let title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : ''
  if (!title) {
    title = `${KIND_LABEL[kind]} · ${aT}/${bT}mm`
    repaired.push('方案标题（按类型与板厚生成）')
  }
  let scale: Drawing['scale'] = '1:1'
  if (raw.scale === '1:1' || raw.scale === '1:2' || raw.scale === '1:5') {
    scale = raw.scale
  } else if (raw.scale !== undefined) {
    repaired.push('出图比例（不合法，按 1:1 补）')
  }
  const notes = Array.isArray(rawJoint.notes) ? rawJoint.notes.filter((n): n is string => typeof n === 'string') : []

  const plan: Drawing = {
    id,
    title,
    parts: [
      { id: newId(), name: '件 A（齿板/榫舌板）', w: aW as number, h: aT as number, qty: 1, jointIds: [] },
      { id: newId(), name: '件 B（销板/榫孔板）', w: bW as number, h: bT as number, qty: 1, jointIds: [] },
    ],
    joints: [{ kind, params, notes }],
    scale,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  }
  return { plan, repaired }
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
