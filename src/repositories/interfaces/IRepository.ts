import { Pool, PoolClient } from 'pg';
import Player from '../../models/player';
import Hand from '../../models/hand';
import { UUID } from 'crypto';
import Action from 'src/models/action';
import Game from 'src/models/game';
import { DateTime } from 'luxon';
import { Round } from 'src/enums/round.enum';
import GameBlind from 'src/models/game-blinds';
import { PlayerAction } from 'src/enums/player-action.enum';

export interface IRepository {
  createClientAndBeginTransaction(): Promise<PoolClient>;

  commitAndRelease(client: PoolClient): Promise<void>;

  rollbackAndRelease(client: PoolClient): Promise<void>;

  createGame(
    blindTime: number,
    playersChips: number,
    startTime: DateTime,
    client?: PoolClient | Pool
  ): Promise<Game>;

  getGame(
    id: UUID,
    client?: PoolClient | Pool
  ): Promise<Game | null>;

  updateGame(
    id: UUID,
    updateData: Partial<Game>,
    client?: PoolClient | Pool
  ): Promise<Game | null>;

  createGameBlind(
    game_level: number,
    smallBlindAmount: number,
    bigBlindAmount: number,
    ante: number,
    client?: PoolClient | Pool
  ): Promise<GameBlind>;

  getGameBlindByLevel(
    level: number,
    client?: PoolClient | Pool
  ): Promise<GameBlind | null>;

  getGameLevelBlind(
    gameId: UUID,
    client?: PoolClient | Pool
  ): Promise<GameBlind | null>;

  createPlayer(
    gameId: UUID,
    name: string,
    amount: number,
    isOnline: boolean,
    isActive: boolean,
    action: string,
    actionAmount: number,
    allBetSum: number,
    client?: PoolClient | Pool
  ): Promise<void>;

  getPlayer(
    playerId: UUID,
    client?: PoolClient | Pool
  ): Promise<Player | null>;

  getPlayers(
    gameId: UUID,
    client?: PoolClient | Pool
  ): Promise<Player[]>;

  getActiveNotFoldPlayers(
    gameId: UUID,
    client?: PoolClient | Pool
  ): Promise<Player[]>;

  updatePlayersByGameId(
    gameId: UUID,
    updateData: Partial<Player>,
    client?: PoolClient | Pool
  ): Promise<void>;

  updateActiveNotFoldPlayersByGameId(
    gameId: UUID,
    updateData: Partial<Player>,
    client?: PoolClient | Pool
  ): Promise<void>;

  updateActiveNotFoldAndNotAllInPlayersByGameId(
    gameId: UUID,
    updateData: Partial<Player>,
    client?: PoolClient | Pool
  ): Promise<void>;

  updatePlayer(
    playerId: UUID,
    updateData: Partial<Player>,
    client?: PoolClient | Pool
  ): Promise<Player | null>;

  incrementPlayerAmount(
    playerId: UUID,
    amount: number,
    client?: PoolClient | Pool
  ): Promise<Player | null>;

  createHand(
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
  ): Promise<Hand>;

  getHands(client?: PoolClient | Pool): Promise<Hand | null>;

  getHandById(handId: UUID, client?: PoolClient | Pool): Promise<Hand | null>;

  getGameLastHandByGameId(
    gameId: UUID,
    client?: PoolClient | Pool
  ): Promise<Hand | null>;

  getPlayerById(playerId: UUID, client?: PoolClient | Pool): Promise<Player | null>;

  updateHand(
    handId: UUID,
    updateData: Partial<Hand>,
    client?: PoolClient | Pool
  ): Promise<Hand | null>;

  updateHandLastRaiseAmount(handId: UUID, lastRaiseAmount: number, client?: PoolClient | Pool): Promise<void>;

  updateHandCurrentMaxBet(handId: UUID, currentMaxBet: number, client?: PoolClient | Pool): Promise<void>;

  updateHandPot(handId: UUID, potAmount: number, client?: PoolClient | Pool): Promise<void>;

  updatePlayerActiveStatus(playerId: UUID, isActive: boolean, client?: PoolClient | Pool): Promise<void>;

  createAction(
    handId: UUID,
    playerId: UUID,
    round: string,
    bettingRound: number,
    actionOrder: number,
    actionType: string,
    betAmount?: number | null,
    client?: PoolClient | Pool
  ): Promise<Action | null>;

  getActionsForHand(
    handId: UUID,
    client?: PoolClient | Pool
  ): Promise<Action[]>;

  getLastActionForHand(handId: UUID, client?: PoolClient | Pool): Promise<Action | null>;

  getActionsBetAmountsByHandIdAndPlayerIdAndRound(
    handId: UUID,
    playerId: UUID,
    round: Round,
    client?: PoolClient | Pool
  ): Promise<number>;

  getActionsBetAmountsByHandIdAndPlayerId(
    handId: UUID,
    playerId: UUID,
    client?: PoolClient | Pool
  ): Promise<number>;

  getActionsByHandIdAndRound(
    handId: UUID,
    round: Round,
    client?: PoolClient | Pool
  ): Promise<Action[]>;

  hasAllActionTypes(
    handId: UUID,
    round: Round,
    actionTypes: PlayerAction[],
    client?: PoolClient | Pool
  ): Promise<boolean>;

  getActionsByHandIdAndPlayerIdAndRound(
    handId: UUID,
    playerId: UUID,
    round: Round,
    client?: PoolClient | Pool
  ): Promise<Action[]>;
}
