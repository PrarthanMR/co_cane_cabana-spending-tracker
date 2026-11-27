export interface Env {
  DB: D1Database
  APP_ENV: string
  APP_VERSION: string
  BOOTSTRAP_TOKEN?: string
  PIN_PEPPER?: string
  APP_ORIGIN?: string
  ASSETS?: Fetcher
}
