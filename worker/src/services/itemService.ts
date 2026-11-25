import { CategoryRepository } from '../repositories/categoryRepository'
import { ItemRepository } from '../repositories/itemRepository'

export class ItemService {
  constructor(
    private readonly items: ItemRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async list(businessId: number, includeInactive = false) {
    return this.items.list(businessId, includeInactive)
  }

  async create(input: {
    businessId: number
    categoryId: number
    name: string
    defaultUnit?: string
  }) {
    const category = await this.categories.findById(input.categoryId, input.businessId)
    if (!category) {
      throw new Error('Category does not belong to this business')
    }

    const existing = await this.items.findExact(input.businessId, input.categoryId, input.name)
    if (existing) {
      if (!existing.isActive) {
        throw new Error('An inactive item already exists with this name')
      }
      throw new Error('An item already exists with this name')
    }

    const created = await this.items.create(input)
    const item = await this.items.findById(created.id, input.businessId)
    if (!item) {
      throw new Error('Item could not be loaded')
    }
    return item
  }

  async deactivate(itemId: number, businessId: number) {
    const existing = await this.items.findById(itemId, businessId)
    if (!existing) {
      throw new Error('Item not found')
    }
    if (!existing.isActive) {
      return existing
    }
    await this.items.deactivate(itemId, businessId)
    return { ...existing, isActive: false }
  }
}
