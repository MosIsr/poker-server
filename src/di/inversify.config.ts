import { Container } from "inversify";
import { TYPES } from "./types";
import { Pool } from 'pg';
import pool from '../config/db';

import GameService from '../services/game.service';
import IGameService from '../services/interfaces/IGameService';
import Repository from "../repositories/repository";
import { IRepository } from "../repositories/interfaces/IRepository";

import "reflect-metadata";

import '../controllers/user.controller';

const container = new Container({
  defaultScope: 'Singleton'
});

container.bind<Pool>(TYPES.Pool).toConstantValue(pool);

container.bind<IRepository>(TYPES.Repository).to(Repository);
container.bind<IGameService>(TYPES.GameService).to(GameService);

export default container;
