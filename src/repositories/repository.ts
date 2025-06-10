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
import GameBlind from 'src/models/game-blinds';
import { PlayerAction } from 'src/enums/player-action.enum';


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
    playersChips: number,
    startTime: DateTime,
    client?: PoolClient | Pool
  ): Promise<Game> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'INSERT INTO games (id, blind_time, chips, start_time) VALUES ($1, $2, $3, $4) RETURNING *',
      [randomUUID(), blindTime, playersChips, startTime]
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

  async getLastActiveGame(
    client?: PoolClient | Pool
  ): Promise<Game | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM games WHERE end_time IS NULL'
    );
    console.log('result', result.rows);
    
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
      `UPDATE games SET ${setClauses} WHERE id = $1 RETURNING *`,
      values
    );
    
    return result.rows.length ? result.rows[0] : null;
  }


  async createGameBlind(
    game_level: number,
    smallBlindAmount: number,
    bigBlindAmount: number,
    ante: number,
    client?: PoolClient | Pool
  ): Promise<GameBlind> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      `INSERT INTO game_blinds (
        id, game_level, small_blind_amount, big_blind_amount, ante
      ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [randomUUID(), game_level, smallBlindAmount, bigBlindAmount, ante]
    );
    
    return result.rows[0];
  }

  async getGameBlindByLevel(
    level: number,
    client?: PoolClient | Pool
  ): Promise<GameBlind | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM game_blinds WHERE game_level = $1',
      [level]
    );

    return result.rows.length ? result.rows[0] : null;
  }

  async getGameLevelBlind(
    gameId: UUID,
    client?: PoolClient | Pool
  ): Promise<GameBlind | null> {
    const queryClient = client ?? this.pool;
  
    const result = await queryClient.query(
      `
      SELECT gb.*
      FROM game_blinds gb
      JOIN games g ON g.level = gb.game_level
      WHERE g.id = $1
      LIMIT 1
      `,
      [gameId]
    );
  
    return result.rows.length ? result.rows[0] : null;
  }



  async createPlayer(
    gameId: UUID,
    name: string,
    amount: number,
    isOnline: boolean,
    isActive: boolean,
    action: PlayerAction,
    actionAmount: number,
    allBetSum: number,
    client?: PoolClient | Pool
  ): Promise<void> {
    const queryClient = client ?? this.pool;

    await queryClient.query(
      'INSERT INTO players (id, game_id, name, amount, is_online, is_active, action, action_amount, all_bet_sum) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [randomUUID(), gameId, name, amount, isOnline, isActive, action, actionAmount, allBetSum]
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

  async updatePlayersByGameId(
    gameId: UUID,
    updateData: Partial<Player>,
    client?: PoolClient | Pool
  ): Promise<void> {
    const queryClient = client ?? this.pool;
  
    const setClauses = Object.keys(updateData)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
  
    if (!setClauses) return;
  
    const values = [gameId, ...Object.values(updateData)];
  
    await queryClient.query(
      `UPDATE players SET ${setClauses} WHERE game_id = $1`,
      values
    );
  }

  async updateActiveNotFoldPlayersByGameId(
    gameId: UUID,
    updateData: Partial<Player>,
    client?: PoolClient | Pool
  ): Promise<void> {
    const queryClient = client ?? this.pool;
  
    const setClauses = Object.keys(updateData)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
  
    if (!setClauses) return;
  
    const values = [gameId, ...Object.values(updateData)];
  
    await queryClient.query(
      `UPDATE players SET ${setClauses} WHERE game_id = $1 AND is_active = true AND action != 'fold'`,
      values
    );
  }

  async updateActiveNotFoldAndNotAllInPlayersByGameId(
    gameId: UUID,
    updateData: Partial<Player>,
    client?: PoolClient | Pool
  ): Promise<void> {
    const queryClient = client ?? this.pool;
  
    const setClauses = Object.keys(updateData)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
  
    if (!setClauses) return;
  
    const values = [gameId, ...Object.values(updateData)];
  
    await queryClient.query(
      `UPDATE players SET ${setClauses} WHERE game_id = $1 AND is_active = true AND action != 'fold' AND action != 'all-in'`,
      values
    );
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

  async incrementPlayerAmount(
    playerId: UUID,
    amount: number,
    client?: PoolClient | Pool
  ): Promise<Player | null> {
    const queryClient = client ?? this.pool;
    console.log('playerId', playerId);
    console.log('amount', amount);
    
     try {
      
       const result = await queryClient.query(
         `UPDATE players SET amount = amount + $2 WHERE id = $1 RETURNING *`,
         [playerId, amount]
       );
   
       return result.rows.length ? result.rows[0] : null;
     } catch (error) {
      console.log('error', error);
      
      return null
     }
  }




  async createHand(
    gameId: UUID,
    level: number,
    dealer: UUID,
    smallBlind: UUID | null,
    bigBlind: UUID,
    potAmount: number,
    ante: number,
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
        id, game_id, level, dealer, small_blind, big_blind, pot_amount, ante, small_blind_amount, big_blind_amount, last_call_amount, current_max_bet, last_raise_amount, current_round, is_changed_current_round, current_player_turn_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [randomUUID(), gameId, level, dealer, smallBlind, bigBlind, potAmount, ante, smallBlindAmount, bigBlindAmount, lastCallAmount, currentMaxBet, lastRaiseAmount, currentRound, isChangedCurrentRound, currentPlayerTurnId]
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

  async getGameLastHandByGameId(
    gameId: UUID,
    client?: PoolClient | Pool
  ): Promise<Hand | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM hands WHERE game_id = $1 ORDER BY created_at DESC LIMIT 1',
      [gameId]
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
    actionOrderCurrentLoop: number,
    actionType: string,
    betAmount?: number | null,
    client?: PoolClient | Pool
  ): Promise<Action | null> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      `INSERT INTO actions (
        id, hand_id, player_id, round, betting_round, action_order, action_order_current_loop, action_type, bet_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [randomUUID(), handId, playerId, round, bettingRound, actionOrder, actionOrderCurrentLoop, actionType, betAmount]
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

  async getActionsBetAmountsByHandIdAndPlayerId(
    handId: UUID,
    playerId: UUID,
    client?: PoolClient | Pool
  ): Promise<number> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT SUM(bet_amount) AS total_bet FROM actions WHERE hand_id = $1 AND player_id = $2',
      [handId, playerId]
    );
    
    return result.rows.length ? +result.rows[0]?.total_bet : 0;
  }

  async getActionsByHandIdAndRound(
    handId: UUID,
    round: Round,
    client?: PoolClient | Pool
  ): Promise<Action[]> {
    const queryClient = client ?? this.pool;
    const result = await queryClient.query(
      'SELECT * FROM actions WHERE hand_id = $1 AND round = $2',
      [handId, round]
    );
    
    return result.rows.length ? result.rows : [];
  }

  async hasAllActionTypes(
    handId: UUID,
    round: Round,
    actionTypes: PlayerAction[],
    client?: PoolClient | Pool
  ): Promise<boolean> {
    if (actionTypes.length === 0) return false;
  
    const queryClient = client ?? this.pool;
  
    const placeholders = actionTypes.map((_, idx) => `$${idx + 3}`).join(', ');
    const sql = `
      SELECT COUNT(DISTINCT action_type) = $${actionTypes.length + 3} AS has_all
      FROM actions
      WHERE hand_id = $1
        AND round = $2
        AND action_type IN (${placeholders})
    `;
  
    const values = [handId, round, ...actionTypes, actionTypes.length];

    console.log('placeholders', placeholders);
    console.log('values', values);
    const result = await queryClient.query(sql, values);
    console.log('result.rows', result.rows);
    
    return result.rows[0]?.has_all ?? false;
  }

  async hasAtLeastOneActionType(
    handId: UUID,
    round: Round,
    actionTypes: PlayerAction[],
    client?: PoolClient | Pool
  ): Promise<boolean> {
    if (actionTypes.length === 0) return false;
  
    const queryClient = client ?? this.pool;
  
    const placeholders = actionTypes.map((_, idx) => `$${idx + 3}`).join(', ');
    const sql = `
      SELECT 1
      FROM actions
      WHERE hand_id = $1
        AND round = $2
        AND action_type IN (${placeholders})
      LIMIT 1
    `;
  
    const values = [handId, round, ...actionTypes];
    const result = await queryClient.query(sql, values);
  
    return result.rows.length > 0;
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
