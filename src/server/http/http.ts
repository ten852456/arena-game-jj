// Shared request plumbing for the API handlers (was copied into fight, farm, meta and site).
export interface Res {
  status: number;
  json: unknown;
}
/** an error answer: `{"error": "..."}` with a 4xx status (400 by default) */
export const bad = (error: string, status = 400): Res => ({ status, json: { error } });
