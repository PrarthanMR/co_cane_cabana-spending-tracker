import { z } from 'zod'

export const purchaseItemInputSchema = z.object({
  itemId: z.coerce.number().int().positive().optional(),
  newItem: z.object({
    name: z.string().trim().min(1).max(100),
    categoryId: z.coerce.number().int().positive(),
    defaultUnit: z.string().trim().min(1).max(50).optional(),
  }).optional(),
  quantity: z.coerce.number().positive().optional(),
  unit: z.string().trim().min(1).optional(),
  amountPaise: z.coerce.number().int().positive(),
}).refine((value) => Boolean(value.itemId) || Boolean(value.newItem), {
  message: 'itemId or newItem is required',
})

export const createPurchaseSchema = z.object({
  businessId: z.coerce.number().int().positive().optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplierName: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(purchaseItemInputSchema).min(1, 'A purchase must contain at least one item'),
})

export const updatePurchaseSchema = createPurchaseSchema.extend({
  version: z.coerce.number().int().positive(),
})

export const deletePurchaseSchema = z.object({
  version: z.coerce.number().int().positive(),
})
