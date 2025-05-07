import { Round } from "../enums/round.enum";

const nextRoundMap = {
  [Round.Preflop]: Round.Flop,
  [Round.Flop]: Round.Turn,
  [Round.Turn]: Round.River,
  [Round.River]: Round.Showdown,
  [Round.Showdown]: Round.Showdown,
};