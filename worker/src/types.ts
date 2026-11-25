export interface Env {
  DB: D1Database
  APP_ENV: string
  OWNER_ACCESS_TOKEN?: string
  OWNER_BUSINESS_ID?: string
  ASSETS?: Fetcher
}
