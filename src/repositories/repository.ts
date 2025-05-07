import { inject, injectable } from 'inversify';
import pg, { Pool, PoolClient, types } from 'pg';
import { DateTime } from 'luxon';
import { randomUUID, UUID } from 'crypto';

import BaseRepository from './base-repository';
import { IRepository } from './interfaces/IRepository';
import { TYPES } from '../di/types';
import Player from '../models/player';
import Hand from '../models/hand';

import DomainError from '../errors/domain.error';
import Action from 'src/models/action';
import Game from 'src/models/game';
import { Round } from 'src/enums/round.enum';


@injectable()
export default class Repository
  extends BaseRepository
  implements IRepository
{
  private pool: Pool;

  constructor(@inject(TYPES.Pool) pool: Pool) {
    super();
    types.setTypeParser(types.builtins.TIMESTAMPTZ, (stringValue) =>
      DateTime.fromSQL(stringValue, { zone: 'utc' })
    );
    this.pool = pool;
  }

  async createClientAndBeginTransaction(): Promise<PoolClient> {
    const client = await this.pool.connect();
    await client.query('BEGIN');
    return client;
  }

  async commitAndRelease(client: PoolClient): Promise<void> {
    try {
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  async rollbackAndRelease(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }

  async connect() {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
    });
    await pool.query('SELECT 1');
    this.pool = pool;

    this.setConnectionReady();
  }

  async disconnect(): Promise<void> {
    await this.pool?.end();
  }

  async createGame(
    blindTime: number,
    startTime: DateTime,
    client?: PoolClient | Pool
  ): Promise<Game> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'INSERT INTO games (id, blind_time, start_time) VALUES ($1, $2, $3) RETURNING *',
      [randomUUID(), blindTime, startTime]
    );
    
    return result.rows[0];
  }

  async getGame(
    id: UUID,
    client?: PoolClient | Pool
  ): Promise<Game | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM games WHERE id = $1',
      [id]
    );

    return result.rows.length ? result.rows[0] : null;
  }

  async updateGame(
    id: UUID,
    updateData: Partial<Game>,
    client?: PoolClient | Pool
  ): Promise<Game | null> {
    const queryClient = client ?? this.pool;
    const setClauses = Object.keys(updateData)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
    const values = [id, ...Object.values(updateData)];

    if (!setClauses) {
      return this.getGame(id, client);
    }

    const result = await queryClient.query(
      `UPDATE hands SET ${setClauses} WHERE id = $1 RETURNING *`,
      values
    );
    
    return result.rows.length ? result.rows[0] : null;
  }

  async createPlayer(
    gameId: UUID,
    name: string,
    amount: number = 0,
    isOnline: boolean = false,
    isActive: boolean = true,
    action: string = '',
    actionAmount: number = 0,
    client?: PoolClient | Pool
  ): Promise<void> {
    const queryClient = client ?? this.pool;
    await queryClient.query(
      'INSERT INTO players (id, game_id, name, amount, is_online, is_active, action, action_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [randomUUID(), gameId, name, amount, isOnline, isActive, action, actionAmount]
    );
  }

  async getPlayer(
    playerId: UUID,
    client?: PoolClient | Pool
  ): Promise<Player | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM players WHERE id = $1',
      [playerId]
    );
    return result.rows.length ? result.rows[0] : null;
  }

  async getPlayers(
    gameId: UUID,
    client?: PoolClient | Pool
  ): Promise<Player[]> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM players WHERE game_id = $1 ORDER BY created_at',
      [gameId]
    );

    return result.rows;
  }

  async getActiveNotFoldPlayers(
    gameId: UUID,
    client?: PoolClient | Pool
  ): Promise<Player[]> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      `SELECT * FROM players WHERE game_id = $1 AND is_active = true AND action != 'fold' ORDER BY created_at`,
      [gameId]
    );

    return result.rows;
  }

  async updatePlayer(
    playerId: UUID,
    updateData: Partial<Player>,
    client?: PoolClient | Pool
  ): Promise<Player | null> {
    const queryClient = client ?? this.pool;
    const setClauses = Object.keys(updateData)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
    const values = [playerId, ...Object.values(updateData)];

    if (!setClauses) {
      return this.getPlayer(playerId, client);
    }
    
    const result = await queryClient.query(
      `UPDATE players SET ${setClauses} WHERE id = $1 RETURNING *`,
      values
    );
    return result.rows.length ? result.rows[0] : null;
  }


  async createHand(
    gameId: UUID,
    level: number,
    dealer: UUID,
    smallBlind: UUID,
    bigBlind: UUID,
    potAmount: number,
    smallBlindAmount: number,
    bigBlindAmount: number,
    lastCallAmount: number,
    currentMaxBet: number,
    lastRaiseAmount: number,
    currentRound: Round,
    isChangedCurrentRound: boolean,
    currentPlayerTurnId: UUID,
    client?: PoolClient | Pool
  ): Promise<Hand> {
    const queryClient = client ?? this.pool;
    
    const result = await queryClient.query(
      `INSERT INTO hands (
        id, game_id, level, dealer, small_blind, big_blind, pot_amount, small_blind_amount, big_blind_amount, last_call_amount, current_max_bet, last_raise_amount, current_round, is_changed_current_round, current_player_turn_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [randomUUID(), gameId, level, dealer, smallBlind, bigBlind, potAmount, smallBlindAmount, bigBlindAmount, lastCallAmount, currentMaxBet, lastRaiseAmount, currentRound, isChangedCurrentRound, currentPlayerTurnId]
    );

    return result.rows[0];
  }

  async getHand(handId: UUID, client?: PoolClient | Pool): Promise<Hand | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM hands WHERE id = $1',
      [handId]
    );
    
    return result.rows.length ? result.rows[0] : null;
  }

  async updateHand(
    handId: UUID,
    updateData: Partial<Hand>,
    client?: PoolClient | Pool
  ): Promise<Hand | null> {
    const queryClient = client ?? this.pool;
    const setClauses = Object.keys(updateData)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
    const values = [handId, ...Object.values(updateData)];

    if (!setClauses) {
      return this.getHand(handId, client);
    }

    const result = await queryClient.query(
      `UPDATE hands SET ${setClauses} WHERE id = $1 RETURNING *`,
      values
    );
    
    return result.rows.length ? result.rows[0] : null;
  }


  async getHands(client?: PoolClient | Pool): Promise<Hand | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM hands ORDER BY created_at DESC LIMIT 1'
    );
    
    return result.rows.length ? result.rows[0] : null;
  }

  
  async getHandById(handId: UUID, client?: PoolClient | Pool): Promise<Hand | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM hands WHERE id = $1',
      [handId]
    );
    
    return result.rows.length ? result.rows[0] : null;
  }

  async getPlayerById(playerId: UUID, client?: PoolClient | Pool): Promise<Player | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM players WHERE id = $1',
      [playerId]
    );
    return result.rows[0];
  }

  // async getLastActionForHand(handId: number, client?: PoolClient | Pool): Promise<Action | null> {
  //   const queryClient = client ?? this.pool;
  //   const result = await queryClient.query(
  //     'SELECT * FROM actions WHERE hand_id = $1 ORDER BY timestamp DESC LIMIT 1',
  //     [handId]
  //   );
  //   
  //   return result.rows.length ? result.rows[0] : null;
  // }

  async updateHandLastRaiseAmount(handId: UUID, lastRaiseAmount: number, client?: PoolClient | Pool): Promise<void> {
    const queryClient = client ?? this.pool;
    await queryClient.query(
      'UPDATE hands SET last_raise_amount = $1 WHERE id = $2',
      [lastRaiseAmount, handId]
    );
  }

  async updateHandCurrentMaxBet(handId: UUID, currentMaxBet: number, client?: PoolClient | Pool): Promise<void> {
    const queryClient = client ?? this.pool;
    await queryClient.query(
      'UPDATE hands SET current_max_bet = $1 WHERE id = $2',
      [currentMaxBet, handId]
    );
  }

  async updateHandPot(handId: UUID, potAmount: number, client?: PoolClient | Pool): Promise<void> {
    const queryClient = client ?? this.pool;
    await queryClient.query(
      'UPDATE hands SET pot_amount = $1 WHERE id = $2',
      [potAmount, handId]
    );
  }

  async updatePlayerActiveStatus(playerId: UUID, isActive: boolean, client?: PoolClient | Pool): Promise<void> {
    const queryClient = client ?? this.pool;
    await queryClient.query(
      'UPDATE players SET is_active = $1 WHERE id = $2',
      [isActive, playerId]
    );
  }

  async createAction(
    handId: UUID,
    playerId: UUID,
    round: string,
    bettingRound: number,
    actionOrder: number,
    actionType: string,
    betAmount?: number | null,
    client?: PoolClient | Pool
  ): Promise<Action | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      `INSERT INTO actions (
        id, hand_id, player_id, round, betting_round, action_order, action_type, bet_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [randomUUID(), handId, playerId, round, bettingRound, actionOrder, actionType, betAmount]
    );
    
    return result.rows.length ? result.rows[0] : null;
  }

  async getActionsForHand(
    handId: UUID,
    client?: PoolClient | Pool
  ): Promise<Action[]> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM actions WHERE hand_id = $1 ORDER BY action_order',
      [handId]
    );
    
    return result.rows.length ? result.rows : [];
  }


  async getLastActionForHand(
    handId: UUID,
    client?: PoolClient | Pool
  ): Promise<Action | null> {    
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM actions WHERE hand_id = $1 ORDER BY created_at DESC LIMIT 1',
      [handId]
    );

    return result.rows.length ? result.rows[0] : null;
  }


  async getActionsBetAmountsByHandIdAndPlayerIdAndRound(
    handId: UUID,
    playerId: UUID,
    round: Round,
    client?: PoolClient | Pool
  ): Promise<number> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT SUM(bet_amount) AS total_bet FROM actions WHERE hand_id = $1 AND player_id = $2 AND round = $3',
      [handId, playerId, round]
    );
    
    return result.rows.length ? +result.rows[0]?.total_bet : 0;
  }

  async getActionsByHandIdAndPlayerIdAndRound(
    handId: UUID,
    playerId: UUID,
    round: Round,
    client?: PoolClient | Pool
  ): Promise<Action[]> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM actions WHERE hand_id = $1 AND player_id = $2 AND round = $3',
      [handId, playerId, round]
    );
    
    return result.rows.length ? result.rows : [];
  }





}
