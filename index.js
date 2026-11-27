/**
 * dsh-peak-coach —— 峰谷教练模式（Host 半端）
 * ============================================================================
 * 它解决什么：DeepSeek 按北京时间分峰谷计费，谷价是峰价的一半。
 *   高峰 = 工作日 9:00–12:00、14:00–18:00；其余（午休、18:00 之后、周末、
 *   法定节假日全天）都是谷时。在峰时让 Agent 自己大干一场，等于同样的活
 *   付双倍钱。
 *
 * 它怎么干：
 *   1. **峰时上闸**：`ctx.tools.guard()` 拦掉变异类工具（写文件、跑命令、派
 *      子代理、改插件…），模型想动也动不了 —— 不是「劝」，是拒绝。
 *   2. **峰时改口**：往系统提示里插一段教练指令，让模型把力气花在「给方案、
 *      给命令、给验收标准」上，用户照着做。
 *   3. **峰时留一道后门**：注册 `peak_unlock` 工具。用户在本轮明确说「现在
 *      就做」时，模型调它解锁 N 分钟，然后正常干活 —— 对应「没有用户命令
 *      不自己动手」。
 *   4. **谷时完全无感**：不拦任何工具、不插任何提示，就是默认模式。
 *
 * 判定口径与 dsh-whale-widget 同源（工作日两段峰 + 周末/法定节假日谷价），
 * 时区固定按北京时间（UTC+8），与宿主本地时区无关。
 * ============================================================================
 */

// schemastery 是可选 peer：拿不到就让 Config 为 undefined，插件照常加载，
// 只是没有设置表单、全部走默认值（宁可少一个设置页，也不能整条插件不激活）。
//
// ⚠️ 它必须**真能拿到**，否则 Config 变 undefined、Config 面板显示 absent，
//    patch 里的 config 会被 loader 直接丢弃 —— 用户就再也调不了峰谷窗口。
//    本地目录安装时插件是 Junction（真实路径在 workspace），Node 不会往上找到
//    profile 的 node_modules，所以除了裸 import 还要从 profile 目录再解析一次。
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

async function loadSchemastery() {
  try {
    const m = await import('@deepseek-ai/schemastery')
    return m.default ?? m
  } catch {}
  const dirs = [process.env.DSH_PROFILE_DIR, process.cwd()].filter(Boolean)
  for (const dir of dirs) {
    try {
      const req = createRequire(join(dir, '__resolve__.js'))
      const resolved = req.resolve('@deepseek-ai/schemastery')
      const m = await import(pathToFileURL(resolved).href)
      return m.default ?? m
    } catch {}
  }
  return null
}

let z = await loadSchemastery()

export const name = 'peak-coach'
export const inject = ['tools', 'systemPrompt']

/** 默认拦截的工具：会改文件、跑进程、起子代理、动 profile 的都算「动手」 */
const DEFAULT_BLOCKED = [
  'write',
  'edit',
  'pwsh',
  'bash',
  'shell',
  'subagent',
  'subagent_fork',
  'workflow',
  'plugin_manager',
  'purge_apply',
  'purge_revert',
  'schedule_create',
  'schedule_edit',
  'create_goal',
  'update_goal',
  'bili_run',
  'bili_reply',
  'pixiv_save',
]

const DEFAULT_COACH = [
  '【峰谷教练模式 · 现在是高峰时段】',
  '按分钟计费是谷时的两倍。规矩是「别自己加戏」，不是「不许干活」：',
  '- 用户明确要求的事照做：该改的文件、该跑的命令、该有的验证，一样不能少。',
  '- 不要自己扩大范围：不顺手改别的文件、不做他没要的重构、不主动派子代理或开新任务。',
  '- 需要额外动作才能往下走时，先把方案和命令摆出来让他决定，别替他决定。',
  '- 读文件、搜索、查文档随时可用 —— 先把事实查清，再动手。',
].join('\n')

export const Config = !z
  ? undefined
  : z.object({
      /** 总开关。关掉＝任何时候都是默认模式 */
      enabled: z.boolean().default(true),
      /** 高峰窗口，北京时间，HH:MM-HH:MM */
      peaks: z.array(z.string()).default(['09:00-12:00', '14:00-18:00']),
      /** 周末全天按谷价（与官方口径一致，一般别关） */
      weekendValley: z.boolean().default(true),
      /** 额外的谷价日（法定节假日），格式 YYYY-MM-DD */
      holidays: z.array(z.string()).default([]),
      /** 峰时、且这一轮没有用户指令时要拦的工具。有用户指令时一律放行 */
      blocked: z.array(z.string()).default(DEFAULT_BLOCKED),
      /** peak_unlock 一次解锁多少分钟 */
      unlockedMinutes: z.natural().default(10),
      /** 峰时插进系统提示的教练指令；留空用内置文案 */
      coachText: z.string().default(''),
    })

// ---------------------------------------------------------------- 峰谷判定

const BJ_MS = 8 * 3600 * 1000

/** 把 "09:00-12:00" 解析成 [起分钟, 止分钟]；跨零点也支持 */
function parseWindow(text) {
  const m = /^(\d{1,2}):(\d{2})\s*[-–~]\s*(\d{1,2}):(\d{2})$/.exec(String(text || '').trim())
  if (!m) return null
  return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])]
}

/** 北京时间日历视角：星期几、日期键、当日分钟数 */
function beijing(ts) {
  const d = new Date(ts + BJ_MS) // 用 UTC 读，得到的就是北京日历
  return {
    dow: d.getUTCDay(),
    day: d.toISOString().slice(0, 10),
    min: d.getUTCHours() * 60 + d.getUTCMinutes(),
  }
}

function isPeak(ts, cfg) {
  if (!cfg || cfg.enabled === false) return false
  const { dow, day, min } = beijing(ts)
  if (cfg.weekendValley !== false && (dow === 0 || dow === 6)) return false
  const holidays = Array.isArray(cfg.holidays) ? cfg.holidays : []
  if (holidays.includes(day)) return false
  const windows = (Array.isArray(cfg.peaks) ? cfg.peaks : []).map(parseWindow).filter(Boolean)
  return windows.some(([a, b]) => (a <= b ? min >= a && min < b : min >= a || min < b))
}

// ---------------------------------------------------------------- 逃生门

/**
 * 为什么需要它：guard 是真拒绝，装上之后**模型自己也被拦** —— 它想改自己的配置、
 * 想关掉插件都做不到。一旦峰时窗口配错（比如手滑写成全天），整个会话就卡死了，
 * 而唯一的出口在工具层之外。
 *
 * 所以留两个不经过工具层的开关：
 *   1. 环境变量 DSH_PEAK_COACH_OFF=1
 *   2. $DSH_HOME/peak-coach.off 这个文件存在（默认 ~/.dsh/peak-coach.off）
 * 任何一个成立，闸门立即放行（文件每 1 秒最多 stat 一次，建/删都很快生效）。
 */
const OFF_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'peak-coach.off')

let offCheckedAt = 0
let offCached = false

function escapeHatch() {
  if (String(process.env.DSH_PEAK_COACH_OFF || '') === '1') return true
  const now = Date.now()
  if (now - offCheckedAt > 1000) {
    offCheckedAt = now
    try {
      offCached = existsSync(OFF_FILE)
    } catch {
      offCached = false
    }
  }
  return offCached
}

// ---------------------------------------------------------------- 插件主体

/**
 * 拦不拦，一条式子说清（抽出来是为了能单测）：
 *   峰时 + 没解锁 + 没开逃生门 + 这一轮没人让做 → 拦。
 * 任何一条不成立就放行。
 */
export function shouldBlock({ peak, escape, unlocked, userAsked, blocked, name }) {
  if (!peak) return false
  if (escape) return false
  if (unlocked) return false
  if (userAsked) return false
  return blocked.has(String(name))
}

// 判定函数对外导出，方便单测与其它插件复用（不影响 cordis 加载）
export { isPeak, parseWindow, beijing }

export function apply(ctx, config) {
  const cfg = config || {}
  // ⚠️ 这里每条都要自己兜默认值，不能指望 Config schema 的 default：
  //    插件被当成本地目录安装时 Config 可能整个缺席（schema absent），
  //    loader 就不会帮着填充 —— 那时 peaks 会变成空数组＝永远不拦，插件静默失效。
  const peaks =
    Array.isArray(cfg.peaks) && cfg.peaks.length ? cfg.peaks : ['09:00-12:00', '14:00-18:00']
  const effective = {
    enabled: cfg.enabled !== false,
    peaks,
    weekendValley: cfg.weekendValley !== false,
    holidays: Array.isArray(cfg.holidays) ? cfg.holidays : [],
  }
  const blocked = new Set(
    (Array.isArray(cfg.blocked) && cfg.blocked.length ? cfg.blocked : DEFAULT_BLOCKED).map((n) =>
      String(n),
    ),
  )
  const coachText = String(cfg.coachText || '').trim() || DEFAULT_COACH
  const unlockMs = Math.max(1, Number(cfg.unlockedMinutes) || 10) * 60 * 1000

  // 用户点了「现在就做」之后的放行窗口。单进程单用户，全局一份足够。
  let unlockedUntil = 0

  // ⭐ 峰时到底拦什么：**只拦「没人让它做」的那一轮**。
  //   用户这一轮发过消息 = 他要用这个活，照做，不拦。
  //   没有用户消息的轮（goal 自动续轮、定时驱动）= 模型自己在往下推，那才拦。
  //   `agent/inbox/claimed` 在用户消息进入本 turn 时触发，`agent/turn-stopping`
  //   在本 turn 即将关闭时触发，两者夹住的正好是「这一轮有没有人要我干活」。
  const userTurns = new Map()
  // 重载/首次加载时看不清眼前这轮是谁开的。用一个「还没见过回合边界」的乐观窗口：
  // 见过一次 `agent/turn-stopping` 之前，一律当作有用户指令（宁可多放行一轮，
  // 也不能把用户正在要的活拦掉）。之后判据就完全靠 claim 事件了。
  let sawTurnBoundary = false

  ctx.on('agent/inbox/claimed', (payload) => {
    const id = payload?.agent?.id
    if (id) userTurns.set(id, true)
  })

  ctx.on('agent/turn-stopping', (payload) => {
    sawTurnBoundary = true
    const id = payload?.agent?.id
    if (id) userTurns.delete(id)
  })

  /** 这一轮是不是用户点名要的活 */
  const userAskedThisTurn = (exec) => {
    const id = exec?.agent?.id || exec?.sessionId || exec?.session?.id
    if (id && userTurns.has(id)) return true
    if (!sawTurnBoundary) return true // 刚加载，看不清局势 → 不误拦
    if (userTurns.size > 0) return true // 别的会话正在要活 → 保守放行
    return false
  }

  const peakNow = () => isPeak(Date.now(), effective)

  // ① 硬闸：峰时拒绝变异类工具。guard 是同步的，每次调用都重新判定，
  //    所以跨过 18:00 或 12:00 不需要重启，下一句就自动换了。
  ctx.effect(
    () =>
      ctx.tools.guard((exec) => {
        const name = String(exec?.name || '')
        const blockedNow = shouldBlock({
          peak: peakNow(),
          escape: escapeHatch(),
          unlocked: Date.now() < unlockedUntil,
          userAsked: userAskedThisTurn(exec),
          blocked,
          name,
        })
        if (!blockedNow) return undefined
        return {
          reason:
            `现在是高峰时段，教练模式只拦「没人让你做」的动作：${name} 被拦下了。` +
            '用户没有要求的部分先别动。' +
            '该做的活要接着做时，先调 peak_unlock 解锁；' +
            `彻底放行则建一个空文件 ${OFF_FILE}（或设 DSH_PEAK_COACH_OFF=1）。`,
        }
      }),
    'peak-coach.guard',
  )

  // ② 改口：峰时往系统提示最后插一段教练指令。order 排在宿主那几段之后，
  //    前面全部命中缓存，只有这一小段按全价算。
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'peak-coach',
        order: 90000,
        interpolate: false,
        text: () => (peakNow() && Date.now() >= unlockedUntil ? coachText : ''),
      }),
    'peak-coach.section',
  )

  // ③ 后门：用户明确下令时解锁。这个工具本身不在 blocked 里。
  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'peak_unlock',
        description: [
          '峰时解锁教练模式，用来把「用户没要求但确实该做完」的活推下去。',
          '',
          '用户这一轮开口要的东西本来就不拦，不需要调它。',
          '它只用于：用户在别处已经授权、但当前这一轮没有新消息（比如自动续轮）时，继续推进。',
          '调用前想清楚这是不是他真的会要的结果。',
        ].join('\n'),
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            reason: {
              type: 'string',
              description: '用户原话里那句授权（比如「现在就做」），照抄，别自己编。',
            },
          },
          required: ['reason'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              unlocked: { type: 'boolean' },
              minutes: { type: 'integer' },
            },
            required: ['unlocked', 'minutes'],
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.unlocked
                ? `已解锁 ${value.minutes} 分钟：这一轮可以动手了。`
                : '现在不是高峰时段，本来就可以动手。',
            },
          ],
        },
        async execute(args) {
          const minutes = Math.round(unlockMs / 60000)
          if (!peakNow()) return { unlocked: false, minutes }
          unlockedUntil = Date.now() + unlockMs
          try {
            ctx.logger?.info?.('peak-coach: 用户下令解锁 %s 分钟（%s）', minutes, args?.reason || '未说明')
          } catch {}
          return { unlocked: true, minutes }
        },
      }),
    'peak-coach.unlock-tool',
  )
}
