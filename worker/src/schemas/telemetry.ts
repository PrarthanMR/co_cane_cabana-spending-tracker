import { z } from 'zod'

export const frontendDiagnosticSchema = z.object({
  errorCode: z.enum([
    'frontend_unhandled_error',
    'frontend_unhandled_rejection',
    'frontend_render_error',
  ]),
  errorType: z.enum([
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'UnknownError',
  ]),
}).strict()

export const purchaseAuditQuerySchema = z.object({
  purchaseId: z.coerce.number().int().positive().optional(),
  beforeId: z.coerce.number().int().positive().optional(),
})
