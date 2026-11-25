import { HealthRepository } from '../repositories/healthRepository'

export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  async getHealth(environment: string) {
    await this.repository.checkDatabase()

    return {
      status: 'ok' as const,
      environment,
    }
  }
}
