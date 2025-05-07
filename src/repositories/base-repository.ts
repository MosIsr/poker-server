import { injectable } from 'inversify';
import { IBaseRepository } from './interfaces/IBaseRepository';

@injectable()
export default abstract class BaseRepository implements IBaseRepository {

  private isConnected = false;

  abstract connect(): Promise<void>;

  abstract disconnect(): Promise<void>;

  isConnectionReady() {
    return this.isConnected;
  }

  protected setConnectionReady() {
    this.isConnected = true;
    console.log('Connected Repository');
  }
}
