// Response types for test assertions — mirrors the API envelope pattern.
// Uses Record<string, unknown> with explicit field access via cast.
// NO `any` — per TS handbook, always use `unknown` and narrow.

export interface ApiResponse {
  readonly [k: string]: unknown;
  readonly data: unknown;
  readonly meta: { readonly [k: string]: unknown; readonly timestamp: string };
}

export interface IdData {
  readonly id: string;
}
export interface PersonData {
  readonly fullName: string;
  readonly cpf: string | null;
  readonly birthDate: string;
}
export interface RoleData {
  readonly id: string;
  readonly system: string;
  readonly role: string;
}

export const parseJson = async (res: Response): Promise<ApiResponse> =>
  res.json() as Promise<ApiResponse>;

export const dataAs = <T>(body: ApiResponse): T => body.data as T;
export const dataAsArray = <T>(body: ApiResponse): T[] => body.data as T[];
