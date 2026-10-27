// @vico/context - PromptSectionBuilder：有序的具名提示词片段集合，最终渲染为一段系统提示词

/**
 * 提示词 section — 一个具名的提示词片段。
 *
 * `content` 可写：处理器可通过 {@link PromptSectionBuilder.getSection} 取回后直接调整。
 */
export interface PromptSection {
  name: string;
  content: string;
}

/**
 * 提示词 section 构建器 — 管理有序的具名提示词片段。
 *
 * - {@link registerSection} 追加新 section（同名则覆盖内容、保留首次位置）
 * - {@link getSection} 取回 section 就地调整
 * - {@link render} 按注册顺序拼接为最终系统提示词（`\n\n` 分隔，空片段跳过）
 */
export class PromptSectionBuilder {
  private readonly sections = new Map<string, PromptSection>();
  private readonly order: string[] = [];

  /**
   * 追加一个具名 section；同名已存在时覆盖其内容并返回既有对象。
   *
   * @param name - section 唯一名称
   * @param content - 提示词片段内容
   * @returns 注册后的 section（可直接调整 content）
   */
  registerSection(name: string, content: string): PromptSection {
    const existing = this.sections.get(name);
    if (existing) {
      existing.content = content;
      return existing;
    }

    const section: PromptSection = { name, content };
    this.sections.set(name, section);
    this.order.push(name);
    return section;
  }

  /**
   * 按名称取回 section。
   *
   * @param name - section 名称
   * @returns 对应 section，不存在时返回 undefined
   */
  getSection(name: string): PromptSection | undefined {
    return this.sections.get(name);
  }

  /**
   * 判断某名称的 section 是否存在。
   *
   * @param name - section 名称
   * @returns 是否存在
   */
  hasSection(name: string): boolean {
    return this.sections.has(name);
  }

  /**
   * 移除某个 section。
   *
   * @param name - section 名称
   * @returns 是否实际移除了 section
   */
  removeSection(name: string): boolean {
    if (!this.sections.delete(name)) return false;
    this.order.splice(this.order.indexOf(name), 1);
    return true;
  }

  /**
   * 按注册顺序渲染最终系统提示词。
   *
   * @returns 各非空 section 以 `\n\n` 拼接的结果，无内容时返回空串
   */
  render(): string {
    return this.order
      .map((name) => this.sections.get(name)?.content ?? '')
      .filter((content) => content.trim().length > 0)
      .join('\n\n');
  }

  /** 当前 section 数量 */
  get size(): number {
    return this.sections.size;
  }
}
