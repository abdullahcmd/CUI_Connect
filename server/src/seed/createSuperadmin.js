// Usage: npm run create-superadmin -- --id SA-001 --email it@comsats.edu.pk [--additional]
import { connectDb } from '../config/db.js'
import { loadOrg, org } from '../services/org.js'
import { User, RoleAssignment, OrgUnit } from '../models/index.js'
import { createUser, assignRole, tempPassword } from '../services/users.js'
import { OrgUnit as O } from '../models/index.js'

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a, i, arr) => { const k = a.slice(2); const nxt = process.argv.slice(2)[process.argv.slice(2).indexOf(a) + 1]; return [k, nxt && !nxt.startsWith('--') ? nxt : true] }))
await connectDb()
await loadOrg()
if (!org.campus()) { console.error('Run `npm run seed` (or the base seed) first so the Campus org unit exists.'); process.exit(1) }
const existing = await RoleAssignment.countDocuments({ role: 'SUPER_ADMIN', to: null })
if (existing && !args.additional) { console.error('A Super Admin already exists. Pass --additional to create another (server access required).'); process.exit(1) }
if (!args.id || !args.email) { console.error('Usage: --id SA-001 --email it@comsats.edu.pk'); process.exit(1) }
const out = await createUser(null, { uid: args.id, name: args.name ?? 'IT Super Admin', email: args.email, kind: 'STAFF', designation: 'IT / Super Admin' })
await assignRole(null, { userId: out.user._id, role: 'SUPER_ADMIN', orgUnitId: org.campus()._id }, { bypass: true })
console.log(`Super Admin ${args.id} created. One-time temporary password: ${out.temporaryPassword}`)
process.exit(0)
