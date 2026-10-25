/**
 * 模板变量展开（vtuber variables 精简版）。
 *
 * 支持 {{user}} / {{content}} / {{match.N}}（正则捕获组）/ {{event.key}}
 * 点路径取值。未知变量保留原样（便于排查配置错误）。
 */

import type { TriggerEvent } from './event.js'

export interface MatchInfo {
  regexMatch?: RegExpMatchArray
}

export function expandTemplate(
  template: string,
  event: TriggerEvent,
  match?: MatchInfo,
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (origin, token: string) => {
    const value = resolveToken(token.trim(), event, match)
    return value !== undefined ? String(value) : origin
  })
}

function resolveToken(token: string, event: TriggerEvent, match?: MatchInfo): unknown {
  if (token === 'user') return event.actorName || event.actorId || ''
  if (token === 'content') {
    const content = event.payload.content
    return typeof content === 'string' ? content : ''
  }
  if (token.startsWith('match.')) {
    const index = Number(token.slice('match.'.length))
    const captured = match?.regexMatch?.[index]
    return captured !== undefined ? captured : ''
  }
  if (token.startsWith('event.')) {
    return readPath(event, token.slice('event.'.length))
  }
  return undefined
}

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
