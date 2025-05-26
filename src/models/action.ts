import { UUID } from 'crypto';
import { DateTime } from 'luxon';

export default interface Action {
  id: UUID;
  hand_id: UUID;
  player_id: UUID;
  round: string; // 'Preflop', 'Flop', 'Turn', 'River'
  betting_round: number; // Փուլի ներսում խաղադրույքների ռաունդի համարակալում
  action_order: number; // Գործողության հերթական համարը ձեռքում
  action_order_current_loop: number; // Գործողության հերթական համարը ռաունդի մեկ շրջանում
  action_type: 'Fold' | 'Call' | 'Raise' | 'Check' | 'Bet' | 'All-in';
  bet_amount?: number | null; // Գործողության դրամական արժեքը (եթե կա)
  created_at: DateTime;
}
