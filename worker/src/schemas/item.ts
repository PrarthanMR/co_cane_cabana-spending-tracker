import { z } from 'zod'

const optionalText = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().trim().min(1).max(50).optional(),
)

export const createItemSchema = z.object({
  businessId: z.coerce.number().int().positive().optional(),
  business_id: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  itemName: z.string().trim().min(1).max(100).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  category_id: z.coerce.number().int().positive().optional(),
  defaultUnit: optionalText,
  default_unit: optionalText,
}).superRefine((value, ctx) => {
  if (!value.name && !value.itemName) {
    ctx.addIssue({ code: 'custom', message: 'name is required', path: ['name'] })
  }
  if (value.categoryId === undefined && value.category_id === undefined) {
    ctx.addIssue({ code: 'custom', message: 'categoryId is required', path: ['categoryId'] })
  }
}).transform((value) => ({
  businessId: value.businessId ?? value.business_id,
  name: value.name ?? value.itemName as string,
  categoryId: value.categoryId ?? value.category_id,
  defaultUnit: value.defaultUnit ?? value.default_unit,
}))

export type CreateItemInput = z.infer<typeof createItemSchema>

export const itemResponseSchema = z.object({
  id: z.number().int().positive(),
  businessId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  categoryName: z.string(),
  name: z.string(),
  defaultUnit: z.string().nullable(),
  isActive: z.boolean(),
})
