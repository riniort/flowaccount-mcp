export interface ApiListResponse<T> {
  status: number;
  message?: string;
  data: T[];
  totalCount?: number;
  pageCount?: number;
  currentPage?: number;
}

export interface ApiSingleResponse<T> {
  status: number;
  message?: string;
  data: T;
}

export interface ApiErrorResponse {
  status: number;
  message: string;
  errors?: Record<string, string[]>;
}
