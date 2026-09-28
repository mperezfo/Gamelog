import type { Health } from '../types/health'
import { apiFetch } from './client'

export function getHealth(): Promise<Health> {
  return apiFetch<Health>('/health')
}
