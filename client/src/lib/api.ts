// Thin fetch wrapper. Always sends cookies (session auth). Throws ApiError on
// non-2xx with the server's { error } message.
const BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText);
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};

export interface User {
  id: string;
  email: string;
  display_name: string;
  is_admin?: boolean;
}

export type ProjectType = 'dj' | 'dance' | 'general';

export interface Project {
  id: string;
  name: string;
  description: string;
  type: ProjectType;
  owner_id: string;
  role: string;
  capabilities?: string[];
  image_s3_key?: string | null;
  team_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type LaneKind = 'cues' | 'automation';
export type LaneType = 'point' | 'region';

export interface CueTemplateField {
  name: string;
  type: 'string' | 'color' | 'number' | 'text';
  required: boolean;
  default: string | number | null;
}

export interface CueTemplate {
  id: string;
  fields: CueTemplateField[];
  export_mapping: Record<string, unknown>;
}

export interface CueLane {
  id: string;
  department_id: string;
  name: string;
  kind: LaneKind;
  lane_type: LaneType;
  sort_order: number;
  template: CueTemplate | null;
}

export interface Department {
  id: string;
  project_id: string;
  name: string;
  color: string;
  sort_order: number;
  default_osc_address: string | null;
  default_osc_value: string | null;
  lanes: CueLane[];
}

export interface RoleDepartment {
  department_id: string;
  can_view: boolean;
  can_edit: boolean;
}

export interface ProjectRole {
  id: string;
  name: string;
  capabilities: string[];
  is_default: boolean;
  is_system: boolean;
  sort_order: number;
  departments?: RoleDepartment[]; // Phase 5d dept-scoped restrictions ([] = unrestricted)
}

export interface Member extends User {
  role: string;
  role_id: string;
  accepted_at: string | null;
}

export interface Team {
  id: string;
  name: string;
  role: 'owner' | 'member';
  projectCount?: number;
  created_at?: string;
}

export interface TeamMember extends User {
  role: 'owner' | 'member';
}

export interface DepartmentAssignment {
  user_id: string;
  department_id: string;
}
