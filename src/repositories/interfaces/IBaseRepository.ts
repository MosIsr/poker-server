export interface IBaseRepository {
  connect(): Promise<void>;

  disconnect(): Promise<void>;

  isConnectionReady(): boolean;
}
