import { UUID } from 'crypto';

export default interface GameBlind {
  id: UUID;
  game_level: number;
  small_blind_amount: number,
  big_blind_amount: number,
  ante: number,
}
