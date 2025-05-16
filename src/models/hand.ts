import { UUID } from 'crypto';
import { DateTime } from 'luxon';
import { Round } from '../enums/round.enum';

export default interface Hand {
  id: UUID;
  game_id: UUID;
  level: number;
  dealer: UUID;
  small_blind: UUID | null;
  big_blind: UUID;
  pot_amount: number;
  ante: number;
  small_blind_amount: number;
  big_blind_amount: number;
  last_call_amount: number;
  current_max_bet: number;
  last_raise_amount: number;
  current_round: Round;
  is_changed_current_round: boolean;
  current_player_turn_id: UUID;
  created_at: DateTime;
}

