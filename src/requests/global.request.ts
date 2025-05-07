import { Request } from 'express';
import { Container } from 'inversify';

export interface GlobalRequest extends Request {
  container: Container;
}
