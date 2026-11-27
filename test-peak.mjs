// 峰谷判定的边界测试：node test-peak.mjs
import { isPeak, shouldBlock } from './index.js'

const cfg = {
  enabled: true,
  peaks: ['09:00-12:00', '14:00-18:00'],
  weekendValley: true,
  holidays: ['2026-12-25'],
}

// 传 UTC 时刻；北京时间 = UTC+8
const at = (iso) => Date.parse(iso)

const cases = [
  ['2026-11-27T02:00:00Z', true,  '周五 10:00 北京 → 峰'],
  ['2026-11-27T04:00:00Z', false, '周五 12:00 北京 → 谷（午休开始）'],
  ['2026-11-27T05:59:00Z', false, '周五 13:59 北京 → 谷'],
  ['2026-11-27T06:00:00Z', true,  '周五 14:00 北京 → 峰（下午开始）'],
  ['2026-11-27T09:59:00Z', true,  '周五 17:59 北京 → 峰'],
  ['2026-11-27T10:00:00Z', false, '周五 18:00 北京 → 谷（下班）'],
  ['2026-11-27T18:00:00Z', false, '周六 02:00 北京 → 谷（周末）'],
  ['2026-11-28T02:00:00Z', false, '周六 10:00 北京 → 谷（周末）'],
  ['2026-11-30T02:00:00Z', true,  '周一 10:00 北京 → 峰'],
  ['2026-12-25T02:00:00Z', false, '周五 10:00 但法定节假日 → 谷'],
]

let bad = 0
for (const [iso, want, label] of cases) {
  const got = isPeak(at(iso), cfg)
  const ok = got === want
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  期望=${want} 实际=${got}`)
}

// 总开关
const off = isPeak(at('2026-11-27T02:00:00Z'), { ...cfg, enabled: false })
console.log(`${off === false ? 'PASS' : 'FAIL'}  关掉总开关后永远是谷  实际=${off}`)
if (off !== false) bad++

// 跨零点窗口
const night = { ...cfg, peaks: ['23:00-02:00'] }
const crossA = isPeak(at('2026-11-27T15:30:00Z'), night) // 周五 23:30 北京
const crossB = isPeak(at('2026-11-26T17:30:00Z'), night) // 周五 01:30 北京
const crossC = isPeak(at('2026-12-01T02:00:00Z'), night) // 周二 10:00 北京
console.log(`${crossA && crossB && !crossC ? 'PASS' : 'FAIL'}  跨零点窗口 23:00-02:00  23:30=${crossA} 01:30=${crossB} 10:00=${crossC}`)
if (!(crossA && crossB && !crossC)) bad++

// ── 拦不拦的判定（shouldBlock） ──────────────────────────────────────────
const bk = { blocked: new Set(['write', 'pwsh']) }
const base = { peak: true, escape: false, unlocked: false, userAsked: false, ...bk }

const dec = [
  [{ name: 'write' }, true, '峰时、没人要求、write → 拦'],
  [{ name: 'read' }, false, '峰时、没人要求、read → 放行（不在拦截表）'],
  [{ name: 'write', userAsked: true }, false, '峰时、用户开口要了 → 照做'],
  [{ name: 'pwsh', userAsked: true }, false, '峰时、用户开口要了 pwsh → 照做'],
  [{ name: 'write', unlocked: true }, false, '峰时但已解锁 → 放行'],
  [{ name: 'write', escape: true }, false, '逃生门开着 → 放行'],
  [{ name: 'write', peak: false }, false, '谷时 → 放行'],
]

for (const [patch, want, label] of dec) {
  const got = shouldBlock({ ...base, ...patch })
  const ok = got === want
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  期望=${want} 实际=${got}`)
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)
