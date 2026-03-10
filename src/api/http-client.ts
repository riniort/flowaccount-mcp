import axios, { type AxiosRequestConfig } from "axios";
import FormData from "form-data";
import { createReadStream } from "fs";
import { logger } from "../utils/logger.js";
import type { TokenManager } from "../auth/token-manager.js";

// Each endpoint specifies its own base URL (discovered via network interception)
export interface Endpoint {
  base: string;
  path: string;
}

export class FlowAccountHttpClient {
  private refreshPromise: Promise<void> | null = null;

  constructor(private tokenManager: TokenManager) {}

  private async makeRequest<T>(
    method: string,
    ep: Endpoint,
    options: { params?: Record<string, unknown>; data?: unknown } = {},
    retryCount = 0
  ): Promise<T> {
    const headers = await this.tokenManager.getAuthHeaders(ep.base);
    const config: AxiosRequestConfig = {
      method,
      baseURL: ep.base,
      url: ep.path,
      timeout: 30000,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    };
    if (options.params) config.params = options.params;
    if (options.data) config.data = options.data;

    try {
      const r = await axios.request<T>(config);
      return r.data;
    } catch (error: unknown) {
      const axiosErr = error as { response?: { status?: number; data?: unknown; headers?: unknown }; config?: { url?: string; baseURL?: string; method?: string } };
      if (axiosErr.response) {
        logger.error(`API Error ${axiosErr.response.status}: ${method} ${ep.base}${ep.path}`);
        logger.error(`Response body: ${JSON.stringify(axiosErr.response.data)}`);
      }
      if (axiosErr.response?.status === 401 && retryCount < 1) {
        // Use shared promise so concurrent requests don't trigger multiple re-auths
        if (!this.refreshPromise) {
          this.refreshPromise = this.tokenManager
            .refreshOrReauthenticate()
            .finally(() => { this.refreshPromise = null; });
        }
        await this.refreshPromise;
        return this.makeRequest<T>(method, ep, options, retryCount + 1);
      }
      throw error;
    }
  }

  private sanitizePath(path: string): string {
    // Mask numeric IDs in paths to avoid leaking record IDs in logs
    return path.replace(/\/\d+/g, "/:id");
  }

  async get<T>(ep: Endpoint, params?: Record<string, unknown>): Promise<T> {
    logger.debug(`GET ${this.sanitizePath(ep.path)}`);
    return this.makeRequest<T>("GET", ep, { params });
  }

  async post<T>(ep: Endpoint, data?: unknown): Promise<T> {
    logger.debug(`POST ${this.sanitizePath(ep.path)}`);
    return this.makeRequest<T>("POST", ep, { data });
  }

  async put<T>(ep: Endpoint, data?: unknown): Promise<T> {
    logger.debug(`PUT ${this.sanitizePath(ep.path)}`);
    return this.makeRequest<T>("PUT", ep, { data });
  }

  async delete<T>(ep: Endpoint): Promise<T> {
    logger.debug(`DELETE ${this.sanitizePath(ep.path)}`);
    return this.makeRequest<T>("DELETE", ep);
  }

  async postFile<T>(ep: Endpoint, filePath: string, fieldName = "file"): Promise<T> {
    logger.debug(`POST(file) ${this.sanitizePath(ep.path)}`);
    const form = new FormData();
    form.append(fieldName, createReadStream(filePath));

    const headers = await this.tokenManager.getAuthHeaders(ep.base);
    const config: AxiosRequestConfig = {
      method: "POST",
      baseURL: ep.base,
      url: ep.path,
      timeout: 60000,
      data: form,
      headers: { ...form.getHeaders(), Accept: "application/json", ...headers },
    };

    try {
      const r = await axios.request<T>(config);
      return r.data;
    } catch (error: unknown) {
      const axiosErr = error as { response?: { status?: number; data?: unknown } };
      if (axiosErr.response) {
        logger.error(`API Error ${axiosErr.response.status}: POST(file) ${ep.base}${ep.path}`);
        logger.error(`Response body: ${JSON.stringify(axiosErr.response.data)}`);
      }
      if (axiosErr.response?.status === 401) {
        if (!this.refreshPromise) {
          this.refreshPromise = this.tokenManager
            .refreshOrReauthenticate()
            .finally(() => { this.refreshPromise = null; });
        }
        await this.refreshPromise;
        // Retry once after token refresh
        const retryHeaders = await this.tokenManager.getAuthHeaders(ep.base);
        const retryForm = new FormData();
        retryForm.append(fieldName, createReadStream(filePath));
        const retryConfig: AxiosRequestConfig = {
          method: "POST",
          baseURL: ep.base,
          url: ep.path,
          timeout: 60000,
          data: retryForm,
          headers: { ...retryForm.getHeaders(), Accept: "application/json", ...retryHeaders },
        };
        const r = await axios.request<T>(retryConfig);
        return r.data;
      }
      throw error;
    }
  }
}
