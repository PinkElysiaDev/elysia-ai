/**
 * habitat 级发送注册表：platform+channelId → send 能力。
 *
 * OutboundRouteRegistry 按 sourceStimulusId 回查，只覆盖"有入站消息可挂靠"
 * 的场景；合成触发刺激（批量/定时唤醒）没有入站路由，需要按 habitat 目标
 * 解析发送能力。body 适配器在收到消息时顺手登记（session.send 闭包），
 * 后进先出保活（LRU：重复 habitat 刷新位置，防止高流量下被淘汰后旧通道失效）。
 */

export interface HabitatSendEntry {
  platform: string
  channelId: string
  send(content: string): Promise<void>
}

const DEFAULT_MAX_ENTRIES = 500

export class HabitatSendRegistry {
  private entries = new Map<string, HabitatSendEntry>()

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  private static keyOf(platform: string, channelId: string): string {
    return `${platform}:${channelId}`
  }

  register(entry: HabitatSendEntry): void {
    const key = HabitatSendRegistry.keyOf(entry.platform, entry.channelId)
    if (this.entries.has(key)) this.entries.delete(key)
    this.entries.set(key, entry)
    if (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey) this.entries.delete(oldestKey)
    }
  }

  resolve(platform?: string, channelId?: string): HabitatSendEntry | undefined {
    if (!platform || !channelId) return undefined
    const direct = this.entries.get(HabitatSendRegistry.keyOf(platform, channelId))
    if (direct) return direct
    // 宽容匹配：channelId 缺失的平台事件可能只带 guildId 形态的 habitat，
    // 由登记侧保证 channelId 归一，此处不做模糊扫描（避免误发）。
    return undefined
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
