import { UUID } from 'crypto';
import Hand from 'src/models/hand';
import Player from 'src/models/player';

export default interface IGameService {
  startGame(blindTime:number, smallBlind: number): Promise<any>;
  performAction(
    gameId: UUID,
    handId: UUID,
    playerId: UUID,
    actionType: string,
    betAmount?: number,
  ): Promise<void>;

  getPlayersInGame(gameId: UUID): Promise<Player[]>;

  getHandById(handId: UUID): Promise<Hand | null>;

  getGameLastHandByGameId(gameId: UUID): Promise<Hand | null>;

  handleNextHand(
    gameId: UUID,
    handId: UUID,
    winners: Array<{id: UUID, amount: number}>,
  ): Promise<{
    players: Player[];
    hand: Hand;
    level: number;
    blindTime: number
  }>;

}

