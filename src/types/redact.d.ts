export interface SerializedError {
  cause?: unknown;
  message: string;
  name: string;
  stack?: string;
}
