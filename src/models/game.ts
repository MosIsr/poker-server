import { UUID } from 'crypto';
import { DateTime } from 'luxon';

export default interface Game {
  id: UUID;
  blind_time: number;
  level: number,
  chips: number,
  start_time: DateTime;
  end_time?: DateTime | null;
}
