import { z } from 'zod'

export const analyticsQuerySchema = z.object({
  preset: z.enum(['today', 'week', 'month', 'last-month', 'custom']).default('month'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  itemId: z.coerce.number().int().positive().optional(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
