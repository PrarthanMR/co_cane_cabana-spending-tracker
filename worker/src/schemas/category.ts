import { z } from 'zod'

export const categoryResponseSchema = z.object({
  id: z.number().int().positive(),
  businessId: z.number().int().positive(),
  name: z.string().min(1),
  isActive: z.boolean(),
})

export type CategoryResponse = z.infer<typeof categoryResponseSchema>
