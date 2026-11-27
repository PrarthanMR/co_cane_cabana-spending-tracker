import { z } from 'zod'

const usernameSchema = z.string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/)
  .transform((value) => value.toLocaleLowerCase())

const pinSchema = z.string().regex(/^\d{8,12}$/, 'PIN must contain 8 to 12 digits')

export const registerOwnerSchema = z.object({
  bootstrapToken: z.string().min(24).max(256),
  businessName: z.string().trim().min(2).max(120),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).default('INR'),
  timeZone: z.string().trim().min(1).max(80).default('Asia/Kolkata'),
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(80),
  pin: pinSchema,
})

export const loginSchema = z.object({
  username: usernameSchema,
  pin: pinSchema,
})

export const joinBusinessSchema = z.object({
  invitationCode: z.string().min(20).max(128),
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(80),
  pin: pinSchema,
})

export const selectBusinessSchema = z.object({
  businessId: z.coerce.number().int().positive(),
})

export const createInvitationSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(168).default(24),
})

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(120),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).default('INR'),
  timeZone: z.string().trim().min(1).max(80).default('Asia/Kolkata'),
})
