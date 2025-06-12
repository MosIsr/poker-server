import { inject, injectable } from "inversify";
import { TYPES } from "../di/types";
import { UUID } from "crypto";
import { DateTime } from "luxon";
import IGameService from "./interfaces/IGameService";
import DomainError from "../errors/domain.error";
import { IRepository } from "../repositories/interfaces/IRepository";
import { Players } from "../utils/get-players";
import { Round } from "../enums/round.enum";
import { PlayerAction } from "../enums/player-action.enum";
import Player from "../models/player";
import Hand from "../models/hand";
import ActionsOpportunities from "src/interfaces/actions-opportunities";
import Action from "src/models/action";

@injectable()
export default class GameService implements IGameService {
  constructor(@inject(TYPES.Repository) private repository: IRepository) {}

  async getActiveGame(): Promise<{
    players: Player[];
    hand: Hand;
    level: number;
    blindTime: number;
    playerActions: ActionsOpportunities;
  } | null> {
    const game = await this.repository.getLastActiveGame();

    if (!game) {
      return null;
    }

    const [players, hand] = await Promise.all([
      this.repository.getPlayers(game.id),
      this.repository.getGameLastHandByGameId(game.id),
    ]);

    if (!players) {
      throw new Error("Not find players.");
    }

    if (!hand) {
      throw new Error("Not find hand.");
    }

    const playerActions = await this.getPlayerActionsOpportunities(
      game.id,
      hand.id
    );

    return {
      players: players,
      hand: hand,
      level: game.level,
      blindTime: game.blind_time,
      playerActions,
    };
  }

  async startGame(
    blindTime: number,
    playersChips: number
  ): Promise<{
    players: Player[];
    hand: Hand;
    level: number;
    blindTime: number;
    playerActions: ActionsOpportunities;
  }> {
    console.log("startGame");

    try {
      const game = await this.repository.createGame(
        blindTime,
        playersChips,
        DateTime.now()
      );

      const gameBlind = await this.repository.getGameBlindByLevel(game.level);
      if (!gameBlind) {
        throw new DomainError(" Game Blind not found");
      }

      const smallBlindAmount = +gameBlind.small_blind_amount;
      const bigBlindAmount = +gameBlind.big_blind_amount;
      const ante = +gameBlind.ante;

      for (const [index, player] of Players.entries()) {
        let action = PlayerAction.Active;
        let actionAmount = 0;
        let amount = playersChips;

        if (index === 1) {
          action = PlayerAction.Bet;
        } else if (index === 2) {
          action = PlayerAction.Raise;
          amount = playersChips - ante;
        }

        await this.repository.createPlayer(
          game.id,
          player.name,
          amount,
          player.isOnline,
          player.isActive,
          action,
          actionAmount,
          actionAmount
        );
      }

      let players = await this.repository.getPlayers(game.id);
      const handLevel = 1;
      const dealerId = players[0].id;
      const smallBlindId = players[1].id;
      const bigBlindId = players[2].id;
      const currentPlayerTurnId = players[3].id;

      const hand = await this.repository.createHand(
        game.id,
        handLevel,
        dealerId,
        smallBlindId,
        bigBlindId,
        0,
        ante,
        smallBlindAmount,
        bigBlindAmount,
        0,
        0,
        0,
        Round.Preflop,
        false,
        currentPlayerTurnId
      );

      await this.performAction(
        game.id,
        hand.id,
        smallBlindId,
        PlayerAction.Bet,
        smallBlindAmount
      );
      await this.performAction(
        game.id,
        hand.id,
        bigBlindId,
        PlayerAction.Raise,
        bigBlindAmount
      );

      const playerActions = await this.getPlayerActionsOpportunities(
        game.id,
        hand.id
      );

      const [updatedHand, updatedPlayers] = await Promise.all([
        this.repository.getHandById(hand.id),
        this.repository.getPlayers(game.id),
      ]);

      if (!updatedHand) {
        throw new Error(`Ձեռքը ${hand.id} համարով գոյություն չունի`);
      }

      return {
        players: updatedPlayers,
        hand: updatedHand,
        level: handLevel,
        blindTime,
        playerActions,
      };
    } catch (error) {
      console.log("Start Game error: ", error);
      throw new DomainError("Start Game error");
    }
  }

  async endGame(
    gameId: UUID,
  ): Promise<{isEndedGame: boolean}> {
    try {
      const game = await this.repository.updateGame(gameId, { end_time: DateTime.now()});
      if (!game) {
        throw new Error(`End Game error: Game not found`);
      }
      return {
        isEndedGame: !!game?.end_time
      }
    } catch (error) {
      console.log("End Game error: ", error);
      return {
        isEndedGame: false,
      }
    }
  }

  async getPlayerActionsOpportunities(
    gameId: UUID,
    handId: UUID
  ): Promise<ActionsOpportunities> {
    const [game, hand] = await Promise.all([
      this.repository.getGame(gameId),
      this.repository.getHandById(handId),
    ]);
    if (!game) {
      throw new Error(`Խաղը ${gameId} համարով գոյություն չունի`);
    }
    if (!hand) {
      throw new Error(`Ձեռքը ${handId} համարով գոյություն չունի`);
    }

    const turnPlayer = await this.repository.getPlayerById(hand.current_player_turn_id);
    if (!turnPlayer) {
      throw new Error(
        `Խաղացողը ${hand.current_player_turn_id} համարով գոյություն չունի`
      );
    }
    const gameBlind = await this.repository.getGameBlindByLevel(game.level);
    if (!gameBlind) {
      throw new Error(
        `Խաղի տեղեկությունը ${game.level} համար գոյություն չունի`
      );
    }

    const currentRound = hand.current_round;

    let [
      isCurrentRoundHaveBet,
      isCurrentRoundHaveAllIn,
      isCurrentRoundHaveRaise,
    ] = await Promise.all([
      this.repository.hasAllActionTypes(handId, currentRound, [
        PlayerAction.Bet,
      ]),
      this.repository.hasAllActionTypes(handId, currentRound, [
        PlayerAction.AllIn,
      ]),
      this.repository.hasAllActionTypes(handId, currentRound, [
        PlayerAction.Raise,
      ]),
    ]);

    let isCurrentRoundHaveBetOrAllIn = await this.repository.hasAtLeastOneActionType(handId, currentRound, [
      PlayerAction.Bet,
      PlayerAction.AllIn,
    ]);

    if(hand.current_round === Round.Preflop && !hand.small_blind) {
      isCurrentRoundHaveBet = true;
      isCurrentRoundHaveBetOrAllIn = true;
    }
    
    const isCanFold = isCurrentRoundHaveBetOrAllIn;
    const isCanCall = isCurrentRoundHaveBetOrAllIn;
    const isCanCheck = !isCurrentRoundHaveBetOrAllIn;
    const isCanBet = !isCurrentRoundHaveBetOrAllIn;
    const raiseMinAmount = +hand.current_max_bet * 2;
    const isCanRaise = isCurrentRoundHaveBetOrAllIn ? (isCurrentRoundHaveBet || isCurrentRoundHaveAllIn) && isCurrentRoundHaveRaise ? false : true : false;

    const isCanReRaise = (isCurrentRoundHaveBet || isCurrentRoundHaveAllIn) && isCurrentRoundHaveRaise && turnPlayer.amount > raiseMinAmount ? true : false;

  
    let betMinAmount = +gameBlind.big_blind_amount;

    const actions: ActionsOpportunities = {
      isCanFold, // եթե կա bet կամ all-in ապա true, հակառակ դեպքում false,
      isCanCall, // եթե կա bet կամ all-in ապա true, հակառակ դեպքում false,
      // callAmount,                                // իր bet֊ի չափ պետք է հավասարվի ամենամեծ bet֊ի չափ (hand.current_max_bet),
      //                                            // իսկ եթե իր amount < hand.current_max_bet ֊ից,
      //                                            // ապա callAmount պետք է լինի ամբողջ իր amount֊ի չափ
      isCanCheck, // եթե կա bet կամ all-in ապա true, հակառակ դեպքում false,
      isCanBet, // եթե կա bet ապա false, եթե չկա bet ապա true
      betMinAmount, // Preflop-ում SB֊ի չափ, մնացած ռաունդներում BB֊ի չափ
      isCanRaise, // եթե չկա bet կամ all-in ապա false, եթե կա bet կամ all-in և չկա raise ապա true, եթե կա bet կամ all-in և կա raise ապա false
      isCanReRaise, // եթե կա bet կամ all-in և կա raise ապա true, հակառակ դեպքում false,
      raiseMinAmount, // Min ամենամեծ bet֊ի կրկնապատիկի չափ (2 * hand.current_max_bet)
      isCanAllIn: true, // միշտ true է
      allInAmount: +turnPlayer.amount, // միշտ պետք է լինի Player֊ի amount֊ի չափ
    };

    return actions;
  }

  async performAction(
    gameId: UUID,
    handId: UUID,
    playerId: UUID,
    actionType: string,
    betAmount?: number
  ): Promise<void> {
    console.log("+++++++++++++++ START ACTION +++++++++++++++");
    const [hand, player] = await Promise.all([
      this.repository.getHandById(handId),
      this.repository.getPlayerById(playerId),
    ]);

    if (!hand) {
      throw new Error(`Ձեռքը ${handId} համարով գոյություն չունի`);
    }
    if (!player) {
      throw new Error(`Խաղացողը ${playerId} համարով գոյություն չունի`);
    }

    if (hand?.game_id !== gameId || player?.game_id !== gameId) {
      throw new DomainError("Խաղացողը կամ ձեռքը չեն պատկանում նշված խաղին");
    }

    if (!player.is_active) {
      throw new Error(`Խաղացողը ${playerId} համարով դուրս է խաղից`);
    }

    if (actionType === PlayerAction.Raise && betAmount !== undefined) {
      await this.handleRaiseAction(gameId, hand, playerId, betAmount);
    } else if (actionType === PlayerAction.ReRaise && betAmount !== undefined) {
      await this.handleReRaiseAction(gameId, hand, playerId, betAmount);
    } else if (actionType === PlayerAction.Bet && betAmount !== undefined) {
      await this.handleBetAction(gameId, hand, playerId, betAmount);
    } else if (actionType === PlayerAction.Call) {
      await this.handleCallAction(gameId, hand, playerId);
    } else if (actionType === PlayerAction.Fold) {
      await this.handleFoldAction(gameId, hand, playerId);
    } else if (actionType === PlayerAction.Check) {
      await this.handleCheckAction(gameId, hand, playerId);
    } else if (actionType === PlayerAction.AllIn) {
      await this.handleAllInAction(gameId, hand, playerId);
    }

    console.log("+++++++++++++++ END ACTION +++++++++++++++");
  }

  async handleBetAction(
    gameId: UUID,
    hand: Hand,
    playerId: UUID,
    betAmount: number
  ) {
    console.log("************** START BET **************");

    const player = await this.repository.getPlayerById(playerId);
    if (player && betAmount) {
      await Promise.all([
        this.repository.updatePlayer(playerId, {
          amount: player?.amount - betAmount,
          action: PlayerAction.Bet,
          action_amount: +betAmount,
          all_bet_sum: +player.all_bet_sum + +betAmount,
        }),
        this.repository.updateHand(hand.id, {
          pot_amount: +hand.pot_amount + +betAmount,
          last_raise_amount: betAmount,
          current_max_bet: betAmount,
        }),
      ]);
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(
      hand.id
    );
    let currentBetAmount = betAmount || 0;
    const actionOrderCurrentLoop = 0;
    console.log("bbbbbbbbbbb");

    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      actionOrderCurrentLoop,
      PlayerAction.Bet,
      currentBetAmount
    );

    await this.nextPlayer(gameId, hand.id, playerId);

    console.log("************** END BET **************");
  }

  async handleRaiseAction(
    gameId: UUID,
    hand: Hand,
    playerId: UUID,
    betAmount: number
  ) {
    console.log("************** START RAISE **************");

    const minRaiseAmount =
      +hand.current_max_bet +
      (+hand.current_max_bet > 0
        ? +hand.last_raise_amount
        : +hand.big_blind_amount);

    if (betAmount < minRaiseAmount) {
      throw new Error(`Ռեյզի նվազագույն չափը պետք է լինի ${minRaiseAmount}`);
    }

    const player = await this.repository.getPlayerById(playerId);
    if (player && betAmount) {
      await Promise.all([
        this.repository.updatePlayer(playerId, {
          amount: player?.amount - betAmount,
          action: PlayerAction.Raise,
          action_amount: +betAmount,
          all_bet_sum: +player.all_bet_sum + +betAmount,
        }),
        this.repository.updateHand(hand.id, {
          pot_amount: +hand.pot_amount + +betAmount,
          last_raise_amount: betAmount - hand.current_max_bet,
          current_max_bet: betAmount,
        }),
      ]);
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(
      hand.id
    );

    let currentBetAmount = betAmount || 0;
    const actionOrderCurrentLoop = 0;

    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      actionOrderCurrentLoop,
      PlayerAction.Raise,
      currentBetAmount
    );
    await this.nextPlayer(gameId, hand.id, playerId);
    console.log("************** END RAISE **************");
  }

  async handleReRaiseAction(
    gameId: UUID,
    hand: Hand,
    playerId: UUID,
    betAmount: number
  ) {
    console.log("************** START RE-RAISE **************");
    const turnPlayerBetAmounts =
      await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
        hand.id,
        hand.current_player_turn_id,
        hand.current_round
      );
    const mustBeBet = betAmount - turnPlayerBetAmounts;
    const minRaiseAmount =
      +hand.current_max_bet +
      (+hand.current_max_bet > 0
        ? +hand.last_raise_amount
        : +hand.big_blind_amount);

    if (betAmount < minRaiseAmount) {
      throw new Error(`Ռե-Ռեյզի նվազագույն չափը պետք է լինի ${minRaiseAmount}`);
    }

    const player = await this.repository.getPlayerById(playerId);
    if (player && betAmount) {
      await Promise.all([
        this.repository.updatePlayer(playerId, {
          amount: player?.amount - mustBeBet,
          action: PlayerAction.ReRaise,
          action_amount: +betAmount,
          all_bet_sum: +player.all_bet_sum + +mustBeBet,
        }),
        this.repository.updateHand(hand.id, {
          pot_amount: +hand.pot_amount + +mustBeBet,
          last_raise_amount: betAmount,
          current_max_bet: betAmount,
        }),
      ]);
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(
      hand.id
    );

    const actionOrderCurrentLoop = 0;

    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      actionOrderCurrentLoop,
      PlayerAction.ReRaise,
      mustBeBet
    );
    await this.nextPlayer(gameId, hand.id, playerId);
    console.log("************** END RE-RAISE **************");
  }

  async handleCallAction(gameId: UUID, hand: Hand, playerId: UUID) {
    console.log("************** START CALL **************");
    const [turnPlayerBetAmounts, turnPlayer] = await Promise.all([
      this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
        hand.id,
        hand.current_player_turn_id,
        hand.current_round
      ),
      this.repository.getPlayerById(hand.current_player_turn_id),
    ]);

    if (!turnPlayer) {
      throw new Error(
        `Խաղացողը ${hand.current_player_turn_id} համարով գոյություն չունի`
      );
    }

    const mustBeBet = hand.current_max_bet - turnPlayerBetAmounts;

    let callAmount = +mustBeBet;
    let action = PlayerAction.Call;
    if (turnPlayer.amount <= mustBeBet) {
      callAmount = +turnPlayer.amount;
      action = PlayerAction.AllIn;
    }
    const player = await this.repository.getPlayerById(playerId);
    if (player) {
      console.log('+player.all_bet_sum + +callAmount,', +player.all_bet_sum + +callAmount);
      
      await Promise.all([
        this.repository.updateHandPot(hand.id, +hand.pot_amount + callAmount),
        this.repository.updatePlayer(playerId, {
          amount: player?.amount - callAmount,
          action: action,
          action_amount: callAmount + +turnPlayerBetAmounts,
          all_bet_sum: +player.all_bet_sum + +callAmount,
        }),
      ]);
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(
      hand.id
    );

    const actionOrderCurrentLoop = 0;
    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      actionOrderCurrentLoop,
      action,
      callAmount
    );
    await this.nextPlayer(gameId, hand.id, playerId);

    console.log("************** END CALL **************");
  }

  async handleFoldAction(gameId: UUID, hand: Hand, playerId: UUID) {
    console.log("************** START FOLD **************");
    const player = await this.repository.getPlayerById(playerId);
    if (player) {
      await this.repository.updatePlayer(playerId, {
        action: PlayerAction.Fold,
        action_amount: 0,
      });
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(
      hand.id
    );
    const actionOrderCurrentLoop = 0;
    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      actionOrderCurrentLoop,
      PlayerAction.Fold,
      0
    );
    await this.nextPlayer(gameId, hand.id, playerId);

    console.log("************** END FOLD **************");
  }

  async handleCheckAction(gameId: UUID, hand: Hand, playerId: UUID) {
    console.log("************** START CHECK **************");

    const { currentBettingRound, actionOrder } = await this.getActionOrders(
      hand.id
    );

    const player = await this.repository.getPlayerById(playerId);
    if (player) {
      await this.repository.updatePlayer(playerId, {
        action: PlayerAction.Check,
        action_amount: 0,
      });
    }
    const actionOrderCurrentLoop = 0;
    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      actionOrderCurrentLoop,
      PlayerAction.Check,
      0
    );
    await this.nextPlayer(gameId, hand.id, playerId);
    console.log("************** END CHECK **************");
  }

  async handleAllInAction(gameId: UUID, hand: Hand, playerId: UUID) {
    console.log("************** START ALL IN **************");
    let betAmount = 0;

    const [
      currentRoundPlayerBetAmounts,
      playerAllBet,
      player
    ] = await Promise.all([
      this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
        hand.id,
        playerId,
        hand.current_round
      ),
      this.repository.getActionsBetAmountsByHandIdAndPlayerId(
        hand.id,
        playerId
      ),
      this.repository.getPlayerById(playerId),
    ]);

    if (player) {
      betAmount = +player.amount + +currentRoundPlayerBetAmounts;
      let currentMaxBet = hand.current_max_bet;
      if (currentMaxBet < +player.amount + +playerAllBet) {
        currentMaxBet = +player.amount + +playerAllBet;
      }

      await Promise.all([
        this.repository.updatePlayer(playerId, {
          amount: 0,
          action: PlayerAction.AllIn,
          action_amount: +betAmount,
          all_bet_sum: +player.all_bet_sum + +player.amount,
        }),
        this.repository.updateHand(hand.id, {
          pot_amount: +hand.pot_amount + +player.amount,
          last_raise_amount: currentMaxBet,
          current_max_bet: currentMaxBet,
        }),
      ]);
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(
      hand.id
    );
    const actionOrderCurrentLoop = 0;
    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      actionOrderCurrentLoop,
      PlayerAction.AllIn,
      betAmount - +currentRoundPlayerBetAmounts
    );
    await this.nextPlayer(gameId, hand.id, playerId);

    console.log("************** END ALL IN **************");
  }

  async getActionOrders(handId: UUID): Promise<{
    actionOrder: number;
    currentBettingRound: number;
  }> {
    const lastAction = await this.repository.getLastActionForHand(handId);
    const currentBettingRound = lastAction ? +lastAction.betting_round + 1 : 1; // petq e hashvi miayn tvyal round-um
    const actionOrder = lastAction ? +lastAction.action_order + 1 : 1;

    return {
      actionOrder,
      currentBettingRound,
    };
  }

  async getPlayersInGame(gameId: UUID): Promise<Player[]> {
    return this.repository.getPlayers(gameId);
  }

  async getHandById(handId: UUID): Promise<Hand | null> {
    return await this.repository.getHandById(handId);
  }

  async getGameLastHandByGameId(gameId: UUID): Promise<Hand | null> {
    return await this.repository.getGameLastHandByGameId(gameId);
  }


  getNextActivePlayer(
    players: Player[],
    currentPlayerIndex: number,
    isChangedCurrentRound: boolean
  ): Player | null {
    let nextActivePlayer: Player | null = null;
    let nextIndex = currentPlayerIndex % players.length;
    let attempts = 0;

    if (isChangedCurrentRound) {
    } else {
      while (!nextActivePlayer && attempts < players.length) {
        const player = players[nextIndex];
        if (
          player.is_active &&
          player.action !== PlayerAction.Fold &&
          player.action !== PlayerAction.AllIn
        ) {
          nextActivePlayer = player;
        } else {
          nextIndex = (nextIndex + 1) % players.length;
          attempts++;
        }
      }
    }

    return nextActivePlayer;
  }

  async handleChipCapping(
    gameId: UUID,
    handId: UUID,
    actingPlayerId: UUID
  ): Promise<void> {
    console.log('');
    console.log('');
    console.log("=========== START CHIP CAPPING ============");
    console.log('');
    console.log('');
    
    // 1. պետք է գտնել հաջորդ խաղացողին, որին հնարավոր է գումար վերադարձնե
    // 2. պետք է հասկանալ արդյոք նախորդ անգամ խաղացողը All-in է արել թե ոչ
    // 3. պետք է ատանանք բոլոր խաղացողների bet֊երը
    // 4. վերցնենք ամենամաեծ bet արածին
    // 5. ստուգենք կա արդյոք իրեն հավասար bet արած այլ խաղացող
    // 6. եթե կա իրեն հավասար bet արած խաղացող, ոչինչ չենք անում
    // 7. եթե չկա, ապա գտնում ենք մնացած խաղացողների ամենամեծ bet արածի amount֊ը
    // 8. ամբողջ խաղացողների ամենամեծ bet արածին վերադարձնում ենք այդ երկու ամենամեծ bet֊երի տարբերությունը
    // 9. թարմացնում ենք pot-ը, current_max_bet֊ը և խաղացողի վերջին action-ի amount֊ը

    // 1. Get game state
    const [hand, players] = await Promise.all([
      this.repository.getHandById(handId),
      this.repository.getPlayers(gameId),
    ]);

    if (!hand || !players) {
      throw new Error("Hand or players not found");
    }

    const activePlayers = players.filter(
      (p) => p.is_active && p.action !== PlayerAction.Fold
    );
    if(activePlayers.length < 2 ) {
      return;
    }
    // 2. Get all players' bets in current round
    const playerBets = await Promise.all(
      activePlayers.map(async (player) => ({
        playerId: player.id,
        betAmount:
          await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
            handId,
            player.id,
            hand.current_round
          ),
        playerData: {
          ...player,
          amount: +player.amount,
          action_amount: +player.action_amount,
          all_bet_sum: +player.all_bet_sum,
        },
      }))
    );

    console.log("Player bets in current round:", playerBets);

    // 3. Find all all-in players (including partial all-ins)
    // const allInPlayers = playerBets.filter(
    //   (p) => p.playerData.action === PlayerAction.AllIn
    // );

    // if (allInPlayers.length < 2) {
    //   console.log("Not enough all-in players for capping check");
    //   return;
    // }

    // 4. For each all-in player, calculate their effective all-in amount
    const effectiveAllIns = playerBets.map((player) => {
      const totalInvested = +player.playerData.action_amount;
      const currentRoundInvested = +player.betAmount;
      const effectiveAllIn = +Math.min(
        totalInvested,
        currentRoundInvested + +player.playerData.amount
      );
      return {
        ...player,
        effectiveAllIn,
      };
    });

    // 5. Sort by effective all-in amount (descending)
    effectiveAllIns.sort((a, b) => +b.effectiveAllIn - +a.effectiveAllIn);

    // 6. Find the highest and second highest effective all-ins
    const highestAllIn = effectiveAllIns[0];
    const secondHighestAllIn = effectiveAllIns[1];

    console.log(
      `Highest all-in: ${highestAllIn.playerData.name} (${highestAllIn.effectiveAllIn})`
    );
    console.log(
      `Second highest all-in: ${secondHighestAllIn.playerData.name} (${secondHighestAllIn.effectiveAllIn})`
    );

    // 7. Calculate refund amount
    const refundAmount = +highestAllIn.effectiveAllIn - +secondHighestAllIn.effectiveAllIn;

    if (refundAmount <= 0) {
      console.log(
        "No refund needed - all-in amounts are equal or second is higher"
      );
      return;
    }

    console.log(`Refunding ${refundAmount} to ${highestAllIn.playerData.name}`);

    // 8. Update player and hand state
    const [currentPlayerData, currentHandData] = await Promise.all([
      this.repository.getPlayerById(highestAllIn.playerId),
      this.repository.getHandById(handId),
    ]);

    if (!currentPlayerData || !currentHandData) {
      throw new Error("Player or hand data not found for update");
    }

    // Update player's amount and bet sum
    await this.repository.updatePlayer(highestAllIn.playerId, {
      amount: +currentPlayerData.amount + +refundAmount,
      all_bet_sum: +currentPlayerData.all_bet_sum - +refundAmount,
      action_amount: +secondHighestAllIn.effectiveAllIn,
    });

    // Update hand's pot and max bet
    await this.repository.updateHand(handId, {
      pot_amount: +currentHandData.pot_amount - +refundAmount,
      current_max_bet: +secondHighestAllIn.effectiveAllIn,
      last_raise_amount: 0,
    });

    // Check if we should end the hand (only one non-all-in player left)
    const nonAllInPlayers = activePlayers.filter(
      (p) => p.action !== PlayerAction.AllIn || +p.amount > 0
    );

    if (nonAllInPlayers.length <= 1) {
      console.log("Only one non-all-in player left - ending hand");
      await this.repository.updateHand(handId, {
        current_round: Round.Showdown,
      });
    }

    console.log("=========== END CHIP CAPPING ============");
  }

  async handleChipCapping3(
    gameId: UUID,
    handId: UUID,
    actingPlayerId: UUID
  ): Promise<void> {
    console.log('');
    console.log('');
    console.log("=========== START CHIP CAPPING ============");
    console.log('');
    console.log('');
    
    // 1. պետք է գտնել հաջորդ խաղացողին, որին հնարավոր է գումար վերադարձնե
    // 2. պետք է հասկանալ արդյոք նախորդ անգամ խաղացողը All-in է արել թե ոչ
    // 3. պետք է ատանանք բոլոր խաղացողների bet֊երը
    // 4. վերցնենք ամենամաեծ bet արածին
    // 5. ստուգենք կա արդյոք իրեն հավասար bet արած այլ խաղացող
    // 6. եթե կա իրեն հավասար bet արած խաղացող, ոչինչ չենք անում
    // 7. եթե չկա, ապա գտնում ենք մնացած խաղացողների ամենամեծ bet արածի amount֊ը
    // 8. ամբողջ խաղացողների ամենամեծ bet արածին վերադարձնում ենք այդ երկու ամենամեծ bet֊երի տարբերությունը
    // 9. թարմացնում ենք pot-ը, current_max_bet֊ը և խաղացողի վերջին action-ի amount֊ը

    // 1. Get game state
    const [hand, players] = await Promise.all([
      this.repository.getHandById(handId),
      this.repository.getPlayers(gameId),
    ]);

    if (!hand || !players) {
      throw new Error("Hand or players not found");
    }

    const activePlayers = players.filter(
      (p) => p.is_active && p.action !== PlayerAction.Fold
    );

    console.log('activePlayers', activePlayers);

    const currentPlayerIndex = players.findIndex((p) => p.id === actingPlayerId);
    console.log("currentPlayerIndex", currentPlayerIndex);
    
    const nextPlayerIndex = this.getNextPlayerIndex(currentPlayerIndex, players);
    if(!nextPlayerIndex) {
      return;
    }
    const nextPlayer = players[nextPlayerIndex];
    console.log("nextPlayer", nextPlayer);

    if(nextPlayer.action !== PlayerAction.AllIn) {
      return;
    }

    const activePlayersBetsCurrentRound = await Promise.all(
      activePlayers.map((player) => {
        return this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
          handId,
          player.id,
          hand.current_round
        );
      })
    );
    console.log("activePlayersBetsCurrentRound", activePlayersBetsCurrentRound);




    console.log("=========== END CHIP CAPPING ============");
  }

  async nextPlayer(gameId: UUID, handId: UUID, playerId: UUID): Promise<void> {
    console.log("");
    console.log("************** HANDLE NEXT PLAYER **************");
    console.log("playerId", playerId);
    console.log(" ");
    console.log(" ");


    const hand = await this.repository.getHandById(handId);
    if (!hand) {
      throw new Error("Not find hand.");
    }

    const players = await this.repository.getPlayers(gameId);
    // console.log("players", players);

    const foldingPlayerIndex = players.findIndex((p) => p.id === playerId);
    console.log("foldingPlayerIndex", foldingPlayerIndex);

    const activeNotFoldedPlayers = players.filter(
      (p) => p.is_active && p.action !== PlayerAction.Fold
    );
    console.log("activeNotFoldedPlayers", activeNotFoldedPlayers);

    if (activeNotFoldedPlayers.length < 2) {
      //todo
      await this.handleChipCapping(gameId, handId, playerId);
      await this.repository.updateHand(handId, {
        current_round: Round.Showdown,
      });
      return;
    }

    const activeNotFoldedNotAllInPlayers = activeNotFoldedPlayers.filter(
      (player) => player.action !== PlayerAction.AllIn
    );
    console.log('========================================================');
    console.log('========================================================');
    console.log('activeNotFoldedNotAllInPlayers', activeNotFoldedNotAllInPlayers);
    console.log('activeNotFoldedNotAllInPlayers[0].id', activeNotFoldedNotAllInPlayers[0]?.id);
    console.log('activeNotFoldedPlayers[activeNotFoldedPlayers.length - 1].id', activeNotFoldedPlayers[activeNotFoldedPlayers.length - 1]?.id);
    console.log('========================================================');
    
    if (activeNotFoldedNotAllInPlayers.length === 1 && activeNotFoldedNotAllInPlayers[0].id === activeNotFoldedPlayers[activeNotFoldedPlayers.length - 1].id) {
      //todo
      await this.handleChipCapping(gameId, handId, playerId);
      await this.repository.updateHand(handId, {
        current_round: Round.Showdown,
      });
      return;
    }

    const playerThatShouldActNextId = hand.current_player_turn_id;
    const actionsOfThisPlayerThisRound: Action[] =
      await this.repository.getActionsByHandIdAndPlayerIdAndRound(
        handId,
        playerThatShouldActNextId,
        hand.current_round
      );

    console.log('actionsOfThisPlayerThisRound', actionsOfThisPlayerThisRound);
    
    const lastActionOfThisPlayer = actionsOfThisPlayerThisRound.sort(
      (a, b) => b.action_order - a.action_order
    )[0];
    console.log("lastActionOfThisPlayer", lastActionOfThisPlayer);


    const playersCurrentRoundActions = await Promise.all(
      activeNotFoldedNotAllInPlayers.map((player) => {
        return this.repository.getActionsByHandIdAndPlayerIdAndRound(
          handId,
          player.id,
          hand.current_round
        );
      })
    );
    console.log("playersCurrentRoundActions", playersCurrentRoundActions);

    const allPlayersActedCurrentRound = playersCurrentRoundActions.every(
      (action) => action.length > 0
    );
    console.log(
      "allPlayersActedCurrentRound***************",
      allPlayersActedCurrentRound
    );

    const playersBetAmounts = await Promise.all(
      activeNotFoldedPlayers.map((player) => {
        return this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
          handId,
          player.id,
          hand.current_round
        );
      })
    );
    console.log("playersBetAmounts", playersBetAmounts);

    const maxBetCurrentRound = Math.max(...playersBetAmounts);

    const allActionAmountsEqual = playersBetAmounts.every(
      (element) => element === maxBetCurrentRound
    );
    console.log("allActionAmountsEqual", allActionAmountsEqual);

    const nextRoundMap = {
      [Round.Preflop]: Round.Flop,
      [Round.Flop]: Round.Turn,
      [Round.Turn]: Round.River,
      [Round.River]: Round.Showdown,
      [Round.Showdown]: Round.Showdown,
    };

    let currentRound = hand.current_round;
    // let nextActivePlayer = null;
    let currentPlayerIndex = foldingPlayerIndex + 1;

    if (allPlayersActedCurrentRound) {
      console.log(
        "======================= allPlayersActedCurrentRound ======================="
      );

      if (!allActionAmountsEqual) {
        // գտնել ոչ հավասար խաղացողներին և ստուգել արդիոք All-in են արել թե ոչ։
        // եթե All-in են արել ապա պետք է ստուգել արդիոք ոչ All-in ֊նների քանակը 1 է, թե ոչ։
        // եթե քանակը 1 է, ապա hand֊ը ավարտվում է
        // եթե 1 չէ ապա խաղում են ոչ All-in խաղացողները այնքան ժամանակ միչև հասնենք կամ Round.Showdown կամ մնա 1 խաղացող ոչ All-in

        const unequalPlayerIndices: number[] = [];
        playersBetAmounts.forEach((amount, index) => {
          if (amount !== maxBetCurrentRound) {
            unequalPlayerIndices.push(index);
          } else {
          }
        });
        console.log("unequalPlayerIndices", unequalPlayerIndices);

        let allUnequalPlayersAreAllIn = true;

        if (unequalPlayerIndices.length === 0) {
          allUnequalPlayersAreAllIn = false;
        } else {
          for (const playerIndex of unequalPlayerIndices) {
            const player = activeNotFoldedPlayers[playerIndex];
            // Ստուգում ենք, որ խաղացողը գոյություն ունի և նրա action-ը AllIn չէ (կամ amount > 0)
            if (
              !player ||
              (player.action !== PlayerAction.AllIn && player.amount > 0)
            ) {
              allUnequalPlayersAreAllIn = false;
              break;
            }
          }
        }

        console.log("allUnequalPlayersAreAllIn", allUnequalPlayersAreAllIn);

        if (allUnequalPlayersAreAllIn) {
          const nonAllInPlayersOverall = activeNotFoldedPlayers.filter(
            (p) => p.action !== PlayerAction.AllIn && p.amount > 0
          );
          const countNonAllInOverall = nonAllInPlayersOverall.length;

          console.log("countNonAllInOverall", countNonAllInOverall);

          if (countNonAllInOverall <= 1) {
            // ավարտվեց Hand-ը
            currentRound = Round.River;

            const nextRound = nextRoundMap[currentRound];

            console.log("nextRound", nextRound);
            if (nextRound && nextRound !== currentRound) {
              // todo
              await this.handleChipCapping(gameId, handId, playerId);
              await Promise.all([
                this.repository.updateActiveNotFoldAndNotAllInPlayersByGameId(
                  gameId,
                  {
                    action: PlayerAction.Active,
                    action_amount: 0,
                  }
                ),
                this.repository.updateHand(handId, {
                  current_round: nextRound,
                  is_changed_current_round: true,
                }),
              ]);
              console.log(`Moved to next round: ${nextRound}`);
              // await this.repository.updateHand(handId, { current_round: Round.Showdown });
              return;
            } else {
              console.log("Already at the last round: Showdown");
              
              // todo
              await this.handleChipCapping(gameId, handId, playerId);
              await this.repository.updateHand(handId, {
                current_round: Round.Showdown,
              });
            }
          } else {
            // խաղը շարունակում են ոչ All֊In խաղացողները
            // պետք է անցին հաջորդ խաղացողին
            const nextRound = nextRoundMap[currentRound];

            // todo
            await this.handleChipCapping(gameId, handId, playerId);
            await Promise.all([
              this.repository.updateActiveNotFoldAndNotAllInPlayersByGameId(
                gameId,
                {
                  action: PlayerAction.Active,
                  action_amount: 0,
                }
              ),              
              this.repository.updateHand(handId, {
                current_round: nextRound,
                is_changed_current_round: true,
              }),
            ]);
            console.log(`Moved to next round: ${nextRound}`);

            // return;
          }
        } else {
          // պետք է անցին հաջորդ խաղացողին
        }
      } else {
        const isAllPlayerActionAllIn = activeNotFoldedPlayers.every(
          (element) => element.action === PlayerAction.AllIn
        );
        console.log("isAllPlayerActionAllIn", isAllPlayerActionAllIn);
        currentRound = isAllPlayerActionAllIn
          ? Round.River
          : hand.current_round;
        console.log("currentRound", currentRound);

        const nextRound = nextRoundMap[currentRound];

        console.log("nextRound", nextRound);
        if (nextRound && nextRound !== currentRound) {
          // todo
          await this.handleChipCapping(gameId, handId, playerId);
          await Promise.all([
            this.repository.updateActiveNotFoldAndNotAllInPlayersByGameId(
              gameId,
              {
                action: PlayerAction.Active,
                action_amount: 0,
              }
            ),
            this.repository.updateHand(handId, {
              current_round: nextRound,
              is_changed_current_round: true,
            }),
          ]);
          console.log(`Moved to next round: ${nextRound}`);
        } else {
          console.log("Already at the last round: Showdown");
          // todo
          await this.handleChipCapping(gameId, handId, playerId);
          await this.repository.updateHand(handId, {
            current_round: Round.Showdown,
          });
        }

        const players = await this.repository.getPlayers(gameId);
        const dealerPlayerIndex = players.findIndex(
          (p) => p.id === hand.dealer
        );
        console.log("dealerPlayerIndex", dealerPlayerIndex);

        const total = players.length;
        console.log("total", total);

        let nextIndex = -1;

        for (let offset = 1; offset < total; offset++) {
          const i = (dealerPlayerIndex + offset) % total;
          console.log("iiiiiiiii", i);
          const player = players[i];
          if (
            player.is_active &&
            player.action !== "all-in" &&
            player.action !== "fold"
          ) {
            nextIndex = i;
            break;
          }
        }

        console.log("Next valid player index:", nextIndex);
        if (nextIndex === -1) {
          console.log("No valid next player found");
          return;
        }

        currentPlayerIndex = nextIndex;
      }
    } else {
      // գտնել հաջորդ գործողություն խաղացողի ինդեքսը
      // currentPlayerIndex = foldingPlayerIndex + 1; // TODO
    }

    console.log("hand.", hand.is_changed_current_round);

    const nextActivePlayer = this.getNextActivePlayer(
      players,
      currentPlayerIndex,
      hand.is_changed_current_round
    );
    console.log("nextActivePlayer0", nextActivePlayer);

    if (nextActivePlayer) {
      

      await this.repository.updateHand(handId, {
        current_player_turn_id: nextActivePlayer.id,
        is_changed_current_round: false,
      });
    } else {
      console.log("Ձեռքն ավարտվեց, մնաց միայն մեկ ակտիվ խաղացող");
    }
  }

  getNextPlayerIndex(
    currentPlayerIndex: number,
    players: Player[]
  ): number | null {
    const total = players.length;
    console.log("total", total);

    let nextIndex = -1;

    for (let offset = 1; offset < total; offset++) {
      const i = (currentPlayerIndex + offset) % total;
      console.log("iiiiiiiii", i);
      const player = players[i];
      if (
        player.is_active &&
        player.action !== "all-in" &&
        player.action !== "fold"
      ) {
        nextIndex = i;
        break;
      }
    }

    console.log("Next valid player index:", nextIndex);
    if (nextIndex === -1) {
      console.log("No valid next player found");
      return null;
    }

    currentPlayerIndex = nextIndex;

    console.log("currentPlayerIndex", currentPlayerIndex);

    return nextIndex;
  }

  async handleNextHand(
    gameId: UUID,
    handId: UUID,
    winners: Array<{ id: UUID; amount: number }>,
    gameLevel: number,
    reBuyPlayers: UUID[],
  ): Promise<{
    players: Player[];
    hand: Hand;
    level: number;
    blindTime: number;
    playerActions: ActionsOpportunities;
  }> {
    for (const winner of winners) {
      await this.repository.incrementPlayerAmount(winner.id, winner.amount);
    }

    const game = await this.repository.getGame(gameId);
    for (const playerId of reBuyPlayers) {
      await this.repository.updatePlayer(playerId, {
        amount: game?.chips,
        is_active: true,
        action: PlayerAction.Active,
        action_amount: 0,
        all_bet_sum: 0,
        inactive_time_hand_id: null
      });
    }

    await this.repository.updateGame(gameId, { level: gameLevel });

    const [gameBlind, players] = await Promise.all([
      this.repository.getGameLevelBlind(gameId),
      this.repository.getPlayers(gameId),
    ]);

    if (!gameBlind) {
      throw new Error(
        `Blind configuration not found for the game's current level.`
      );
    }
    if (!players) {
      throw new Error("Not find players.");
    }

    for (const player of players) {
      if (+player.amount === 0 && !player.inactive_time_hand_id) {
        await this.repository.updatePlayer(
          player.id,
          {
            is_active: false,
            inactive_time_hand_id: handId
          }
        );
      }
    }

    const hand = await this.createNewHand(gameId, handId);
    if (!hand) {
      throw new Error("Not find hand.");
    }

    for (const player of players) {
      if (player.id === hand.big_blind) {
        await this.repository.updatePlayer(player.id, { amount: player.amount - gameBlind.ante });
      }
    }

    await this.repository.updatePlayersByGameId(gameId, {
      action: PlayerAction.Active,
      action_amount: 0,
      all_bet_sum: 0
    });

    if (hand.small_blind) {
      await this.performAction(
        gameId,
        hand.id,
        hand.small_blind,
        PlayerAction.Bet,
        gameBlind.small_blind_amount
      );
    }

    await this.performAction(
      gameId,
      hand.id,
      hand.big_blind,
      PlayerAction.Raise,
      gameBlind.big_blind_amount
    );

    const [updatedPlayers, playerActions, updatedHand] =
      await Promise.all([
        this.repository.getPlayers(gameId),
        this.getPlayerActionsOpportunities(gameId, hand.id),
        this.repository.getHandById(hand.id),
      ]);

    if (!updatedPlayers) {
      throw new Error("Not find players.");
    }
    if (!game) {
      throw new Error("Not find game.");
    }
    if (!updatedHand) {
      throw new Error("Not find hand.");
    }

    return {
      players: updatedPlayers,
      hand: updatedHand,
      level: game.level,
      blindTime: game.blind_time,
      playerActions,
    };
  }

  async createNewHand(gameId: UUID, lastHandId: UUID): Promise<Hand | null> {
    console.log("=========== CREATE NEW HAND ============");

    const [lastHand, players] = await Promise.all([
      this.repository.getHandById(lastHandId),
      this.repository.getPlayers(gameId),
    ]);

    if (!lastHand) {
      throw new Error("Not find hand.");
    }

    const activePlayers = players.filter((p) => p.is_active);
    if (activePlayers.length < 2) {
      throw new Error("Not enough active players to start a hand.");
    }

    const currentDealerIndex = players.findIndex(
      (p) => p.id === lastHand.dealer
    );

    let nextDealerId: UUID | undefined;
    for (let i = 1; i <= players.length; i++) {
      const nextIndex = (currentDealerIndex + i) % players.length;
      if (players[nextIndex].is_active) {
        nextDealerId = players[nextIndex].id;
        break;
      }
    }
    if (!nextDealerId) throw new Error("Could not find next dealer.");

    const gameBlind = await this.repository.getGameLevelBlind(gameId);
    if (!gameBlind) {
      throw new Error(
        `Blind configuration not found for the game's current level.`
      );
    }

    let smallBlindId = null;
    for (let i = 1; i <= players.length; i++) {
      const index = (players.findIndex((p) => p.id === nextDealerId) + i) % players.length;
      
      if (players[index].is_active) {
        smallBlindId = players[index].id;
        break;
      } else if(players[index].inactive_time_hand_id === lastHandId) {
        break;
      }
    }

    let bigBlindId: UUID | undefined;
    for (let i = 1; i <= players.length; i++) {
      let index = 0;
      if(!smallBlindId) {
        index = ((players.findIndex((p) => p.id === nextDealerId) + 1) + i) % players.length;
      } else {
        index = ((players.findIndex((p) => p.id === smallBlindId)) + i) % players.length;
      }
      if (players[index].is_active) {
        bigBlindId = players[index].id;
        break;
      }
    }
    if (!bigBlindId) throw new Error("Could not find big blind.");

    let currentPlayerTurnId: UUID | undefined;
    for (let i = 1; i <= players.length; i++) {
      const index =
        (players.findIndex((p) => p.id === bigBlindId) + i) % players.length;
      if (players[index].is_active) {
        currentPlayerTurnId = players[index].id;
        break;
      }
    }
    if (!currentPlayerTurnId) throw new Error("Could not find player to act.");

    const smallBlindAmount = +gameBlind.small_blind_amount;
    const bigBlindAmount = +gameBlind.big_blind_amount;

    const hand = await this.repository.createHand(
      gameId,
      +lastHand.level + 1,
      nextDealerId,
      smallBlindId,
      bigBlindId,
      0,
      +gameBlind.ante,
      smallBlindAmount,
      bigBlindAmount,
      0,
      0,
      0,
      Round.Preflop,
      false,
      currentPlayerTurnId
    );

    return hand;
  }

  async handlePlayerReBuy(
    gameId: UUID,
    handId: UUID,
    playerId: UUID
  ): Promise<{
    players: Player[];
    hand: Hand;
    level: number;
    blindTime: number;
    playerActions: ActionsOpportunities;
  }> {
    const game = await this.repository.getGame(gameId);

    await this.repository.updatePlayer(playerId, {
      amount: game?.chips,
      is_active: true,
      action: PlayerAction.Active,
      action_amount: 0,
      all_bet_sum: 0,
    });

    const [players, playerActions, hand] = await Promise.all([
      this.repository.getPlayers(gameId),
      this.getPlayerActionsOpportunities(gameId, handId),
      this.repository.getHandById(handId),
    ]);

    if (!players) {
      throw new Error("Not find players.");
    }
    if (!game) {
      throw new Error("Not find game.");
    }
    if (!hand) {
      throw new Error("Not find hand.");
    }

    return {
      players: players,
      hand: hand,
      level: game.level,
      blindTime: game.blind_time,
      playerActions,
    };
  }
}
