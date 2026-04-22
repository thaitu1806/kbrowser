/**
 * Action Logger types.
 * Types for audit logging and log querying.
 */

/** A single action log entry. */
export interface ActionLogEntry {
  id: string;
  userId: string;
  username: string;
  action: string;
  profileId?: string;
  details: Record<string, unknown>;
  timestamp: string;
}

/** Filter criteria for querying action logs. */
export interface LogFilter {
  userId?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}
