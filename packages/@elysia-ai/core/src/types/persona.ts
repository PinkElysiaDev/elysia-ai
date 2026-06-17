export interface Persona {
  /** 关联的 life instance id */
  lifeId: string
  /** 人格显示名称 */
  name: string
  /** 用于注入 brain 层的 system prompt */
  systemPrompt: string
  /** 人格特质标签（供 behavior / cognition 层参考） */
  traits?: string[]
  /** 语气风格描述 */
  tone?: string
  /** 扩展元数据 */
  metadata?: Record<string, unknown>
}

export interface PersonaRegistry {
  register(persona: Persona): void
  getByLifeId(lifeId: string): Persona | undefined
  getAll(): Persona[]
}
