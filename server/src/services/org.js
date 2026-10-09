import { OrgUnit } from '../models/index.js'
import { strId } from '../lib/util.js'

/** In-memory org tree. Small (tens of nodes), so every policy check can use it without a query. */
const state = { byId: new Map(), byCode: new Map() }

export async function loadOrg() {
  const all = await OrgUnit.find().lean()
  state.byId = new Map(all.map((o) => [String(o._id), o]))
  state.byCode = new Map(all.map((o) => [o.code, o]))
  return all
}

export const org = {
  get: (id) => state.byId.get(strId(id)),
  byCode: (code) => state.byCode.get(code),
  all: () => [...state.byId.values()],
  campus: () => org.all().find((o) => o.type === 'CAMPUS'),
  ofType: (type) => org.all().filter((o) => o.type === type),
  children: (id) => org.all().filter((o) => strId(o.parentId) === strId(id)),
  /** ids of the node and all of its descendants */
  subtree(id) {
    const key = strId(id)
    return org.all().filter((o) => (o.path ?? []).some((p) => String(p) === key)).map((o) => String(o._id))
  },
  /** is `childId` the same as or below `ancestorId`? */
  isWithin(childId, ancestorId) {
    const c = org.get(childId)
    if (!c) return false
    const a = strId(ancestorId)
    return (c.path ?? []).some((p) => String(p) === a) || String(c._id) === a
  },
  ancestorOfType(id, type) {
    const c = org.get(id)
    if (!c) return null
    for (const p of [...(c.path ?? [])].reverse()) {
      const n = org.get(p)
      if (n?.type === type) return n
    }
    return null
  },
  departmentOf(id) {
    const c = org.get(id)
    if (!c) return null
    return c.type === 'DEPARTMENT' ? c : org.ancestorOfType(id, 'DEPARTMENT')
  },
  programOf(id) {
    const c = org.get(id)
    if (!c) return null
    return c.type === 'PROGRAM' ? c : org.ancestorOfType(id, 'PROGRAM')
  },
}

export async function createOrg(data) {
  const parent = data.parentId ? org.get(data.parentId) : null
  const doc = new OrgUnit({ ...data, path: [] })
  doc.path = [...(parent?.path ?? []), doc._id]
  await doc.save()
  await loadOrg()
  return doc.toObject()
}
