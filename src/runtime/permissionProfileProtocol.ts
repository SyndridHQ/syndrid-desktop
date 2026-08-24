export interface PermissionProfileListParams {
  cursor?: string | null;
  limit?: number | null;
  cwd?: string | null;
}

export interface PermissionProfileSummary {
  id: string;
  description: string | null;
  allowed: boolean;
}

export interface PermissionProfileListResponse {
  data: PermissionProfileSummary[];
  nextCursor: string | null;
}
