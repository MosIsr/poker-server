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

    const currentRound = hand.current_round;

    const [
      isCurrentRoundHaveBet,
      isCurrentRoundHaveAllIn,
      isCurrentRoundHaveRaise,
      turnPlayer
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
      this.repository.getPlayerById(hand.current_player_turn_id),
    ]);

    const isCurrentRoundHaveBetOrAllIn = await this.repository.hasAtLeastOneActionType(handId, currentRound, [
      PlayerAction.Bet,
      PlayerAction.AllIn,
    ])

    if (!turnPlayer) {
      throw new Error(
        `Խաղացողը ${hand.current_player_turn_id} համարով գոյություն չունի`
      );
    }
    
    const isCanFold = isCurrentRoundHaveBetOrAllIn;
    const isCanCall = isCurrentRoundHaveBetOrAllIn;
    const isCanCheck = !isCurrentRoundHaveBetOrAllIn;
    const isCanBet = !isCurrentRoundHaveBetOrAllIn;
    const raiseMinAmount = +hand.current_max_bet * 2;
    const isCanRaise = isCurrentRoundHaveBetOrAllIn ? (isCurrentRoundHaveBet || isCurrentRoundHaveAllIn) && isCurrentRoundHaveRaise ? false : true : false;

    const isCanReRaise = (isCurrentRoundHaveBet || isCurrentRoundHaveAllIn) && isCurrentRoundHaveRaise && turnPlayer.amount > raiseMinAmount ? true : false;

    const gameBlind = await this.repository.getGameBlindByLevel(game.level);
    if (!gameBlind) {
      throw new Error(
        `Խաղի տեղեկությունը ${game.level} համար գոյություն չունի`
      );
    }
    let betMinAmount = +gameBlind.big_blind_amount;
    if (currentRound === Round.Preflop) {
      betMinAmount = +gameBlind.small_blind_amount;
    }

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
    console.log('turnPlayer', turnPlayer);
    console.log('turnPlayerBetAmounts0', turnPlayerBetAmounts);
    

    const mustBeBet = hand.current_max_bet - turnPlayerBetAmounts;
    console.log('mustBeBet', mustBeBet);
    console.log('turnPlayer.amount', turnPlayer.amount);

    let callAmount = +mustBeBet;
    let action = PlayerAction.Call;
    if (turnPlayer.amount <= mustBeBet) {
      callAmount = +turnPlayer.amount;
      action = PlayerAction.AllIn;
    }
    console.log('callAmount', callAmount);

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
      console.log('currentRoundPlayerBetAmounts', currentRoundPlayerBetAmounts);
      betAmount = +player.amount + +currentRoundPlayerBetAmounts;
      
      let currentMaxBet = hand.current_max_bet;
      console.log('currentMaxBet', currentMaxBet);
      console.log('playerAllBet', playerAllBet);
      console.log('player.amount', player.amount);
      if (currentMaxBet < +player.amount + +playerAllBet) {
        currentMaxBet = +player.amount + +playerAllBet;
      }

      await Promise.all([
        this.repository.updatePlayer(playerId, {
          amount: 0,
          action: PlayerAction.AllIn,
          action_amount: +betAmount,
          all_bet_sum: +player.all_bet_sum,
        }),
        this.repository.updateHand(hand.id, {
          pot_amount: +hand.pot_amount + +betAmount,
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
      betAmount
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

  async handleChipCapping(
    gameId: UUID,
    handId: UUID,
    actingPlayerId: UUID,
    initialCurrentHand: Hand, // Սկզբնական currentHand օբյեկտը
    initialAllGamePlayers: Player[], // Խաղի բոլոր խաղացողների սկզբնական զանգվածը
    opponentsInPlay: Player[] // Ակտիվ խաղացողների սկզբնական զանգվածը
  ): Promise<Hand | null> {
    // Վերադարձնում է թարմացված Hand օբյեկտը կամ null՝ կրիտիկական սխալի դեպքում
    console.log(
      "[Chip Capping] Սկսվում է ֆիշկաների սահմանափակման ստուգումը..."
    );
    let handToProcess = initialCurrentHand; // Աշխատում ենք այս օբյեկտի հետ

    const actingPlayerObject = initialAllGamePlayers.find(
      (p) => p.id === actingPlayerId
    );
    if (!actingPlayerObject) {
      console.error(
        `[Chip Capping] Սխալ: Գործողություն կատարած խաղացողը ${actingPlayerId} ID-ով չի գտնվել։`
      );
      return null; // Վերադարձնում ենք null, որպեսզի կանչողը մշակի սխալը
    }
    console.log("actingPlayerObject", actingPlayerObject);

    const actingPlayerInvestmentThisRound =
      await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
        handId,
        actingPlayerId,
        handToProcess.current_round
      );
    console.log(
      "actingPlayerInvestmentThisRound",
      actingPlayerInvestmentThisRound
    );
    console.log("handToProcess.current_max_bet", handToProcess.current_max_bet);

    // Ստուգում ենք, արդյո՞ք գործողություն կատարած խաղացողի ներդրումն է սահմանել/հասել է current_max_bet-ին
    // Եվ current_max_bet-ը 0-ից մեծ է (այսինքն՝ խաղադրույք կամ raise է եղել)
    if (
      actingPlayerInvestmentThisRound === +handToProcess.current_max_bet &&
      +handToProcess.current_max_bet > 0
    ) {
      console.log("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

      if (opponentsInPlay.length > 0) {
        let maxOpponentTotalCommitmentCapacityThisRound = 0;
        let allOpponentsAreEffectivelyCapped = true;

        for (const opponent of opponentsInPlay) {
          const opponentAlreadyInvestedThisRound =
            await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
              handId,
              opponent.id,
              handToProcess.current_round
            );
          console.log(
            "opponentAlreadyInvestedThisRound",
            opponentAlreadyInvestedThisRound
          );
          const opponentMaxPossibleInvestment =
            +opponent.amount + +opponentAlreadyInvestedThisRound;
          console.log(
            "opponentMaxPossibleInvestment",
            opponentMaxPossibleInvestment
          );

          if (opponentMaxPossibleInvestment < +handToProcess.current_max_bet) {
            maxOpponentTotalCommitmentCapacityThisRound = Math.max(
              maxOpponentTotalCommitmentCapacityThisRound,
              opponentMaxPossibleInvestment
            );
          } else {
            allOpponentsAreEffectivelyCapped = false;
            break;
          }
        }

        console.log(
          "maxOpponentTotalCommitmentCapacityThisRound",
          maxOpponentTotalCommitmentCapacityThisRound
        );
        console.log(
          "allOpponentsAreEffectivelyCapped",
          allOpponentsAreEffectivelyCapped
        );

        if (
          allOpponentsAreEffectivelyCapped &&
          +handToProcess.current_max_bet >
            +maxOpponentTotalCommitmentCapacityThisRound
        ) {
          const amountToReturn =
            +handToProcess.current_max_bet -
            +maxOpponentTotalCommitmentCapacityThisRound;
          console.log("amountToReturn", amountToReturn);
          if (amountToReturn > 0) {
            console.log(
              `[Chip Capping] ${actingPlayerObject.name} (${actingPlayerId}) խաղացողի խաղադրույքը ${handToProcess.current_max_bet} էր, սահմանափակվեց մինչև ${maxOpponentTotalCommitmentCapacityThisRound}, վերադարձվում է ${amountToReturn}`
            );

            // 1. Թարմացնել գործողություն կատարած խաղացողի տվյալները
            // Ստանում ենք խաղացողի թարմ տվյալները բազայից՝ համոզվելու համար, որ թարմացնում ենք ճիշտ amount-ը
            const currentActingPlayerData = await this.repository.getPlayerById(
              actingPlayerId
            );
            if (!currentActingPlayerData) {
              console.error(
                `[Chip Capping] Սխալ: Գործողություն կատարած խաղացողը ${actingPlayerId} ID-ով չի գտնվել թարմացման համար։`
              );
              return null;
            }
            console.log("currentActingPlayerData", currentActingPlayerData);

            const updatedPlayerAmount =
              currentActingPlayerData.amount + amountToReturn;
            const updatedPlayerAllBetSum =
              (currentActingPlayerData.all_bet_sum || 0) - amountToReturn;
            const updatedPlayerActionAmount =
              maxOpponentTotalCommitmentCapacityThisRound;
            console.log("updatedPlayerAmount", updatedPlayerAmount);
            console.log("updatedPlayerAllBetSum", updatedPlayerAllBetSum);
            console.log("updatedPlayerActionAmount", updatedPlayerActionAmount);

            await this.repository.updatePlayer(actingPlayerId, {
              amount: updatedPlayerAmount,
              all_bet_sum: updatedPlayerAllBetSum,
              action_amount: updatedPlayerActionAmount,
            });

            // 2. Թարմացնել ձեռքի տվյալները
            const betLevelBeforeThisRaiseAction =
              handToProcess.current_max_bet - handToProcess.last_raise_amount;

            console.log(
              "betLevelBeforeThisRaiseAction",
              betLevelBeforeThisRaiseAction
            );
            let newLastRaiseAmount = handToProcess.last_raise_amount;
            console.log("newLastRaiseAmount", newLastRaiseAmount);
            if (
              handToProcess.last_raise_amount > 0 &&
              actingPlayerInvestmentThisRound === handToProcess.current_max_bet
            ) {
              newLastRaiseAmount =
                maxOpponentTotalCommitmentCapacityThisRound -
                betLevelBeforeThisRaiseAction;
              console.log("newLastRaiseAmount", newLastRaiseAmount);
              if (newLastRaiseAmount < 0) newLastRaiseAmount = 0;
            }

            await this.repository.updateHand(handId, {
              pot_amount: handToProcess.pot_amount - amountToReturn,
              current_max_bet: maxOpponentTotalCommitmentCapacityThisRound,
              last_raise_amount: newLastRaiseAmount,
            });

            // Թարմացնում ենք handToProcess-ը՝ վերադարձնելու համար թարմացված վիճակը
            const refreshedHand = await this.repository.getHandById(handId);
            console.log("refreshedHand", refreshedHand);
            if (!refreshedHand) {
              console.error(
                "[Chip Capping] Սխալ: Ձեռքը չի գտնվել բազայում թարմացումից հետո։"
              );
              return null;
            }
            handToProcess = refreshedHand;
            console.log(
              "[Chip Capping] Ֆիշկաների սահմանափակումը և տվյալների թարմացումը կատարված են։"
            );
          } else {
            console.log(
              "[Chip Capping] Վերադարձվող գումար չկա (amountToReturn <= 0)։"
            );
          }
        } else {
          console.log(
            "[Chip Capping] Սահմանափակման պայմանները չեն բավարարվել (ոչ բոլոր հակառակորդներն են սահմանափակված կամ խաղադրույքը փոքր է կամ հավասար է մաքսիմում հնարավորին)։"
          );
        }
      } else if (
        opponentsInPlay.length === 0 &&
        handToProcess.current_max_bet > 0 &&
        actingPlayerInvestmentThisRound === handToProcess.current_max_bet
      ) {
        console.log(
          `[Chip Capping] ${actingPlayerId} խաղացողը խաղադրույք է կատարել, բայց այլ հակառակորդներ չկան։ Uncalled bet-ի վերադարձը պետք է մշակվի այլ տրամաբանությամբ։`
        );
      }
    } else {
      console.log(
        `[Chip Capping] ${actingPlayerId} խաղացողի ներդրումը (${actingPlayerInvestmentThisRound}) հավասար չէ current_max_bet-ին (${handToProcess.current_max_bet}) կամ current_max_bet-ը 0 է։ Սահմանափակում չի կիրառվում։`
      );
    }

    console.log("handToProcess===============", handToProcess);

    return handToProcess; // Վերադարձնում ենք ձեռքի վիճակը (կամ թարմացված, կամ սկզբնական)
  }

  async nextPlayer4(gameId: UUID, handId: UUID, playerId: UUID): Promise<void> {
    console.log("");
    console.log("************** HANDLE NEXT PLAYER **************");
    console.log("");

    const hand = await this.repository.getHandById(handId);
    if (!hand) {
      throw new Error("Not find hand.");
    }

    const players = await this.repository.getPlayers(gameId);
    console.log("players", players);

    // ???
    let activeNotFoldedPlayers = await this.repository.getActiveNotFoldPlayers(
      gameId
    );
    console.log("activeNotFoldedPlayers", activeNotFoldedPlayers);

    // console.log('+++++++++++++ ԿԱՆՉՈՒՄ ԵՆՔ CHIP CAPPING ՄԵԹՈԴԸ +++++++++++++');
    // // +++++++++++++ ԿԱՆՉՈՒՄ ԵՆՔ CHIP CAPPING ՄԵԹՈԴԸ +++++++++++++
    // const handAfterCapping = await this.handleChipCapping(
    //   gameId,
    //   handId,
    //   playerId,
    //   hand,
    //   players,
    //   activeNotFoldedPlayers
    // );

    // if (!handAfterCapping) {
    //   console.error("Ֆիշկաների սահմանափակման (capping) մեթոդը վերադարձրել է null։ nextPlayer-ը դադարեցվում է։");
    //   return;
    // }
    // let currentHand: Hand = handAfterCapping; // Օգտագործում ենք capping-ից հետո ստացված (կամ չփոփոխված) ձեռքը
    // // +++++++++++++ ԱՎԱՐՏ CHIP CAPPING ՄԵԹՈԴԻ ԿԱՆՉԻ +++++++++++++

    // console.log('+++++++++++++ ԱՎԱՐՏ CHIP CAPPING ՄԵԹՈԴԻ ԿԱՆՉԻ +++++++++++++', handAfterCapping);

    if (activeNotFoldedPlayers.length < 2) {
      await this.repository.updateHand(handId, {
        current_round: Round.Showdown,
      });
      return;
    }

    const playersCurrentRoundActions = await Promise.all(
      activeNotFoldedPlayers.map((player) => {
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
    console.log("allPlayersActedCurrentRound", allPlayersActedCurrentRound);

    // ????????
    const allPlayersActed = activeNotFoldedPlayers.every(
      (player) => player.action !== null && player.action !== ""
    );
    console.log("allPlayersActed", allPlayersActed);

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
    console.log("maxBetCurrentRound", maxBetCurrentRound);

    const allActionAmountsEqual = playersBetAmounts.every(
      (element) => element === maxBetCurrentRound
    );
    console.log("allActionAmountsEqual", allActionAmountsEqual);

    const allPlayerActionEqual = activeNotFoldedPlayers.every(
      (element) =>
        element.action === activeNotFoldedPlayers[0].action &&
        ![PlayerAction.Raise, PlayerAction.ReRaise].includes(element.action)
    );
    console.log("allPlayerActionEqual", allPlayerActionEqual);

    let nextActivePlayer = null;

    if (
      (allPlayerActionEqual || allActionAmountsEqual) &&
      allPlayersActed &&
      allPlayersActedCurrentRound &&
      !hand.is_changed_current_round
    ) {
      console.log("All active players have equal action_amount!");
      const isAllPlayerActionAllIn = activeNotFoldedPlayers.every(
        (element) => element.action === PlayerAction.AllIn
      );
      console.log("isAllPlayerActionAllIn", isAllPlayerActionAllIn);

      const currentRound = isAllPlayerActionAllIn
        ? Round.River
        : hand.current_round;
      console.log("currentRound", currentRound);

      const nextRoundMap = {
        [Round.Preflop]: Round.Flop,
        [Round.Flop]: Round.Turn,
        [Round.Turn]: Round.River,
        [Round.River]: Round.Showdown,
        [Round.Showdown]: Round.Showdown,
      };

      const nextRound = nextRoundMap[currentRound];
      console.log("nextRound", nextRound);

      if (nextRound && nextRound !== currentRound) {
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
      }

      const activePlayers = await this.repository.getPlayers(gameId);

      const bigBlindPlayerIndex = activePlayers.findIndex(
        (p) => p.id === hand.dealer
      );

      if (bigBlindPlayerIndex === -1) {
        console.error("Big blind player not found!");
        return;
      }

      let nextIndex = (bigBlindPlayerIndex + 1) % activePlayers.length;
      let attempts = 0;
      while (attempts < activePlayers.length) {
        const player = activePlayers[nextIndex];

        if (player.is_active && player.action !== PlayerAction.Fold) {
          nextActivePlayer = player;
          break;
        }

        nextIndex = (nextIndex + 1) % activePlayers.length;
        attempts++;
      }
    } else {
      const activePlayers = await this.repository.getPlayers(gameId);
      const foldingPlayerIndex = activePlayers.findIndex(
        (p) => p.id === playerId
      );
      console.log("foldingPlayerIndex", foldingPlayerIndex);

      let nextIndex = (foldingPlayerIndex + 1) % activePlayers.length;
      let attempts = 0;
      while (!nextActivePlayer && attempts < activePlayers.length) {
        const player = activePlayers[nextIndex];
        if (player.is_active && player.action !== PlayerAction.Fold) {
          nextActivePlayer = player;
        } else {
          nextIndex = (nextIndex + 1) % activePlayers.length;
          attempts++;
        }
      }
    }

    if (nextActivePlayer) {
      await this.repository.updateHand(handId, {
        current_player_turn_id: nextActivePlayer.id,
        is_changed_current_round: false,
      });
    } else {
      console.log("Ձեռքն ավարտվեց, մնաց միայն մեկ ակտիվ խաղացող");
    }
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

  async handleChipCapping2(
    gameId: UUID,
    handId: UUID,
    actingPlayerId: UUID,
    initialCurrentHand: Hand,
    initialAllGamePlayers: Player[],
    playersInRound: Player[]
  ): Promise<Hand | null> {
    let handToProcess = initialCurrentHand;
    if (!playersInRound || playersInRound.length < 2) {
      console.log(
        "[ChipCapping2] Ռաունդում 2-ից քիչ խաղացող կա, սահմանափակում չի կիրառվում։"
      );
      return handToProcess;
    }

    const playerLastActionInCurrentRound =
      await this.repository.getActionsByHandIdAndPlayerIdAndRound(
        handId,
        actingPlayerId,
        initialCurrentHand.current_round
      );
    console.log(
      "playerLastActionInCurrentRound",
      playerLastActionInCurrentRound
    );

    if (
      !playerLastActionInCurrentRound ||
      playerLastActionInCurrentRound.length === 0
    ) {
      return handToProcess;
    }

    // պետք է ատանանք բոլոր խաղացողների bet֊երը
    // վերցնենք ամենամաեծ bet արածին
    // ստուգենք կա արդյոք իրեն հավասար bet արած այլ խաղացող
    // եթե կա իրեն հավասար bet արած խաղացող, ոչինչ չենք անում
    // եթե չկա, ապա գտնում ենք մնացած խաղացողների ամենամեծ bet արածի amount֊ը
    // ամբողջ խաղացողների ամենամեծ bet արածին վերադարձնում ենք այդ երկու ամենամեծ bet֊երի տարբերությունը
    // թարմացնում ենք pot-ը, current_max_bet֊ը և խաղացողի վերջին action-ի amount֊ը

    // 1. Ստանում ենք ռաունդում գտնվող բոլոր խաղացողների խաղադրույքները այս ռաունդի համար
    const playerBetsData = await Promise.all(
      playersInRound.map(async (player) => {
        const betAmount =
          await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
            handId,
            player.id,
            handToProcess.current_round
          );
        return { playerId: player.id, betAmount, playerObject: player };
      })
    );
    console.log(
      "[ChipCapping 111] Խաղացողների խաղադրույքների տվյալները:",
      playerBetsData
    );

    if (playerBetsData.length === 0) {
      console.log(
        "[ChipCapping 111111111111111] Խաղադրույքների տվյալներ չկան։"
      );
      return handToProcess;
    }

    // 2. Գտնում ենք ամենամեծ խաղադրույքը (overallMaxBet)
    let overallMaxBet = 0;
    playerBetsData.forEach((data) => {
      if (+data.betAmount > +overallMaxBet) {
        overallMaxBet = +data.betAmount;
      }
    });
    console.log(
      "[ChipCapping 222] Այս ռաունդի ընդհանուր առավելագույն խաղադրույքը:",
      overallMaxBet
    );

    if (+overallMaxBet == 0) {
      console.log(
        "[ChipCapping 222222222222] Դրական խաղադրույքներ չեն կատարվել, սահմանափակում չի կիրառվում։"
      );
      return handToProcess;
    }

    // 3. Գտնում ենք բոլոր խաղացողներին, ովքեր կատարել են այս overallMaxBet-ը
    const maxBetPlayersData = playerBetsData.filter(
      (data) => +data.betAmount == +overallMaxBet
    );
    console.log(
      "[ChipCapping 333] Ամենամեծ խաղադրույք կատարած խաղացող(ներ)ը:",
      maxBetPlayersData.map((p) => p.playerId)
    );

    // 4. Եթե մեկից ավելի խաղացող կա, ով կատարել է ամենամեծ խաղադրույքը, ոչինչ չենք անում
    if (maxBetPlayersData.length > 1) {
      console.log(
        "[ChipCapping 44444] Մեկից ավելի խաղացող կատարել է առավելագույն խաղադրույքը։ Սահմանափակում չի կիրառվում։"
      );
      return handToProcess;
    }

    // 5. Եթե ճիշտ մեկ խաղացող է կատարել եզակի overallMaxBet-ը
    if (maxBetPlayersData.length === 1) {
      const playerToRefundData = maxBetPlayersData[0]; // Տվյալները այն խաղացողի, ով կարող է գումար հետ ստանալ
      const playerToRefundObject = playerToRefundData.playerObject; // Այդ խաղացողի Player օբյեկտը

      console.log(
        `[ChipCapping 555] Եզակի ամենամեծ խաղադրույքը կատարել է ${
          playerToRefundObject.name
        } (${playerToRefundData.playerId}) խաղացողը՝ ${+overallMaxBet} չափով։`
      );

      // Գտնում ենք երկրորդ ամենամեծ խաղադրույքը մնացած բոլոր խաղացողների մեջ
      let secondHighestBet = 0;
      playerBetsData.forEach((data) => {
        if (data.playerId !== playerToRefundData.playerId) {
          // Բացառում ենք ամենամեծ խաղադրույք կատարած խաղացողին
          if (+data.betAmount > +secondHighestBet) {
            secondHighestBet = +data.betAmount;
          }
        }
      });
      console.log(
        "[ChipCapping 5555555555] Երկրորդ ամենամեծ խաղադրույքը մյուսների մեջ:",
        +secondHighestBet
      );

      // 6. Եթե overallMaxBet-ը իրոք մեծ է secondHighestBet-ից
      // (այսինքն՝ նրա խաղադրույքը ոչ ոք չի հասցրել, և կա ավելի ցածր խաղադրույք)
      if (+overallMaxBet > +secondHighestBet) {
        const amountToReturn = +overallMaxBet - +secondHighestBet;
        console.log(
          `[ChipCapping 6] Վերադարձվող գումարը ${
            playerToRefundObject.name
          }-ին (${playerToRefundData.playerId}): ${+amountToReturn}`
        );

        if (+amountToReturn > 0) {
          // Ստանում ենք խաղացողի թարմ տվյալները բազայից՝ ճշգրիտ թարմացման համար
          const currentPlayerDataForUpdate =
            await this.repository.getPlayerById(playerToRefundObject.id);
          if (!currentPlayerDataForUpdate) {
            console.error(
              `[ChipCapping 66] Սխալ: ${playerToRefundObject.id} ID-ով խաղացողը չի գտնվել թարմացման համար։`
            );
            return null; // Կրիտիկական սխալ
          }
          // Ստանում ենք ձեռքի թարմ տվյալները
          const currentHandDataForUpdate = await this.repository.getHandById(
            handId
          );
          if (!currentHandDataForUpdate) {
            console.error(
              `[ChipCapping 666] Սխալ: ${handId} ID-ով ձեռքը չի գտնվել թարմացման համար։`
            );
            return null; // Կրիտիկական սխալ
          }

          // Թարմացնում ենք այն խաղացողին, ով հետ է ստանում գումարը
          await this.repository.updatePlayer(playerToRefundObject.id, {
            amount: +currentPlayerDataForUpdate.amount + +amountToReturn,
            all_bet_sum:
              (+currentPlayerDataForUpdate.all_bet_sum || 0) - +amountToReturn,
            // action_amount-ը (եթե այն ցույց է տալիս ռաունդի ընթացիկ ընդհանուր ներդրումը) պետք է դառնա secondHighestBet
            action_amount: +secondHighestBet,
          });
          console.log(
            `[ChipCapping 6666] ${playerToRefundObject.name} (${
              playerToRefundObject.id
            }) խաղացողը թարմացված է։ Նոր գումար՝ ${
              +currentPlayerDataForUpdate.amount + +amountToReturn
            }`
          );

          // Թարմացնում ենք ձեռքի տվյալները
          // last_raise_amount-ի ճշգրտումը կարևոր է, եթե overallMaxBet-ը raise էր։
          let newLastRaiseAmount = +currentHandDataForUpdate.last_raise_amount;
          // Եթե վերջին raise-ը հենց այս խաղացողի overallMaxBet-ն էր
          if (
            +currentHandDataForUpdate.last_raise_amount > 0 &&
            +playerToRefundData.betAmount ===
              +currentHandDataForUpdate.current_max_bet
          ) {
            const betLevelBeforePlayerToRefundsRaise =
              +currentHandDataForUpdate.current_max_bet -
              +currentHandDataForUpdate.last_raise_amount;
            newLastRaiseAmount =
              +secondHighestBet - +betLevelBeforePlayerToRefundsRaise;
            if (+newLastRaiseAmount < 0) {
              // Եթե capped bet-ը (secondHighestBet) փոքր է նախորդ խաղադրույքի մակարդակից,
              // ապա սա այլևս raise չէ այդ նախորդ մակարդակի նկատմամբ։
              newLastRaiseAmount = 0;
            }
          }

          await this.repository.updateHand(handToProcess.id, {
            // Օգտագործում ենք handToProcess.id, որը նույնն է, ինչ handId
            pot_amount: +currentHandDataForUpdate.pot_amount - +amountToReturn,
            current_max_bet: +secondHighestBet, // Նոր արդյունավետ առավելագույն խաղադրույքը secondHighestBet-ն է
            last_raise_amount: +newLastRaiseAmount,
          });
          console.log(
            `[ChipCapping 66666] Ձեռքը թարմացված է։ Նոր բանկ՝ ${
              +currentHandDataForUpdate.pot_amount - +amountToReturn
            }, նոր current_max_bet՝ ${+secondHighestBet}`
          );

          // Խաղացողի վերջին action-ի amount-ի թարմացումը 'actions' աղյուսակում բարդ է և այս պարզեցված տարբերակում կարելի է բաց թողնել։
          // Հիմնականը խաղացողի և ձեռքի ընդհանուր գումարների ճշգրտումն է։

          // Վերստանում ենք ձեռքը՝ վերադարձնելու ամենաթարմ վիճակը
          const refreshedHand = await this.repository.getHandById(handId);
          if (!refreshedHand) {
            console.error(
              "[ChipCapping 6 6 6 6 6 6] Կրիտիկական սխալ: Ձեռքը չի գտնվել թարմացումից հետո։"
            );
            return null;
          }
          handToProcess = refreshedHand; // Վերագրում ենք թարմացված ձեռքը
        } else {
          console.log(
            "[ChipCapping 6 + 66++6+6+6+] Վերադարձվող գումար չկա (amountToReturn <= 0)։"
          );
        }
      } else {
        console.log(
          "[ChipCapping6*6*6*6*6*6**6] Առավելագույն խաղադրույքը հավասար է կամ փոքր է երկրորդ ամենամեծ խաղադրույքից (կամ այլ խաղադրույքներ չկան)։ Սահմանափակում չի կիրառվում այս կանոնով։"
        );
      }
    } else {
      console.log(
        "[ChipCapping2] Եզակի ամենամեծ խաղադրույք կատարած խաղացող չի գտնվել։ Սահմանափակում չի կիրառվում։"
      );
    }

    return handToProcess;
  }

  findNextActiveNotFoldPlayerIndex(
    players: Player[],
    currentIndex: number
  ): number {
    const total = players.length;
    let nextIndex = (currentIndex + 1) % total;

    for (let i = 0; i < total; i++) {
      const player = players[nextIndex];
      if (
        player.is_active &&
        // player.action !== 'all-in' &&
        player.action !== "fold"
      ) {
        return nextIndex;
      }
      nextIndex = (nextIndex + 1) % total;
    }

    return -1;
  }

  findNextActiveNotFoldNotAllInPlayerIndex(
    players: Player[],
    currentIndex: number
  ): number {
    const total = players.length;
    let nextIndex = (currentIndex + 1) % total;

    for (let i = 0; i < total; i++) {
      const player = players[nextIndex];
      if (
        player.is_active &&
        player.action !== "all-in" &&
        player.action !== "fold"
      ) {
        return nextIndex;
      }
      nextIndex = (nextIndex + 1) % total;
    }

    return -1;
  }

  asd(
    palyers: Player[],
    nextActiveNotFoldNotAllInPlayerIndex: number,
    nextActiveNotFoldPlayerIndex: number
  ) {
    while (
      nextActiveNotFoldNotAllInPlayerIndex - nextActiveNotFoldPlayerIndex >
      0
    ) {
      this.asd(
        palyers,
        nextActiveNotFoldNotAllInPlayerIndex,
        nextActiveNotFoldPlayerIndex + 1
      );
    }
  }

  async handleChipCapping8(gameId: UUID, handId: UUID, actingPlayerId: UUID) {
    // 1. պետք է գտնել հաջորդ խաղացողին, որին հնարավոր է գումար վերադարձնե
    // 2. պետք է հասկանալ արդյոք նախորդ անգամ խաղացողը All-in է արել թե ոչ
    // 3. պետք է ատանանք բոլոր խաղացողների bet֊երը
    // 4. վերցնենք ամենամաեծ bet արածին
    // 5. ստուգենք կա արդյոք իրեն հավասար bet արած այլ խաղացող
    // 6. եթե կա իրեն հավասար bet արած խաղացող, ոչինչ չենք անում
    // 7. եթե չկա, ապա գտնում ենք մնացած խաղացողների ամենամեծ bet արածի amount֊ը
    // 8. ամբողջ խաղացողների ամենամեծ bet արածին վերադարձնում ենք այդ երկու ամենամեծ bet֊երի տարբերությունը
    // 9. թարմացնում ենք pot-ը, current_max_bet֊ը և խաղացողի վերջին action-ի amount֊ը

    const hand = await this.repository.getHandById(handId);
    if (!hand) {
      throw new Error("Not find hand.");
    }
    const players = await this.repository.getPlayers(gameId);
    console.log("players======", players);

    const lastActingPlayerIndex = players.findIndex(
      (p) => p.id === actingPlayerId
    );
    console.log("lastActingPlayerIndex", lastActingPlayerIndex);

    // 1.
    const nextActiveNotFoldPlayerIndex = this.findNextActiveNotFoldPlayerIndex(
      players,
      lastActingPlayerIndex
    );
    console.log("nextActiveNotFoldPlayerIndex", nextActiveNotFoldPlayerIndex);
    if (nextActiveNotFoldPlayerIndex === -1) {
      return;
    }

    const nextActiveNotFoldNotAllInPlayerIndex =
      this.findNextActiveNotFoldNotAllInPlayerIndex(
        players,
        lastActingPlayerIndex
      );
    console.log("nextActiveNotFoldPlayerIndex", nextActiveNotFoldPlayerIndex);

    this.asd(
      players,
      nextActiveNotFoldNotAllInPlayerIndex,
      nextActiveNotFoldPlayerIndex
    );

    // const nextActivePlayer = this.getNextActivePlayer(players, nextActiveNotFoldNotAllInPlayerIndex, hand.is_changed_current_round);
    // console.log('nextActivePlayer0', nextActivePlayer);

    // 2.
    // if(nextActivePlayer?.amount == 0) {

    // }

    // if (!playersInRound || playersInRound.length < 2) {
    //   console.log('[ChipCapping2] Ռաունդում 2-ից քիչ խաղացող կա, սահմանափակում չի կիրառվում։');
    //   return handToProcess;
    // }

    // const playerLastActionInCurrentRound = await this.repository.getActionsByHandIdAndPlayerIdAndRound(handId, actingPlayerId, initialCurrentHand.current_round);
    // console.log('playerLastActionInCurrentRound', playerLastActionInCurrentRound);

    // if(!playerLastActionInCurrentRound || playerLastActionInCurrentRound.length === 0) {
    //   return handToProcess;
    // }

    // 1. Ստանում ենք ռաունդում գտնվող բոլոր խաղացողների խաղադրույքները այս ռաունդի համար
    // const playerBetsData = await Promise.all(
    //   playersInRound.map(async (player) => {
    //     const betAmount = await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
    //       handId,
    //       player.id,
    //       handToProcess.current_round
    //     );
    //     return { playerId: player.id, betAmount, playerObject: player };
    //   })
    // );
    // console.log('[ChipCapping 111] Խաղացողների խաղադրույքների տվյալները:', playerBetsData);

    // if (playerBetsData.length === 0) {
    //   console.log('[ChipCapping 111111111111111] Խաղադրույքների տվյալներ չկան։');
    //   return handToProcess;
    // }

    // 2. Գտնում ենք ամենամեծ խաղադրույքը (overallMaxBet)
    // let overallMaxBet = 0;
    // playerBetsData.forEach(data => {
    //   if (+data.betAmount > +overallMaxBet) {
    //     overallMaxBet = +data.betAmount;
    //   }
    // });
    // console.log('[ChipCapping 222] Այս ռաունդի ընդհանուր առավելագույն խաղադրույքը:', overallMaxBet);

    // if (+overallMaxBet == 0) {
    //   console.log('[ChipCapping 222222222222] Դրական խաղադրույքներ չեն կատարվել, սահմանափակում չի կիրառվում։');
    //   return handToProcess;
    // }

    // 3. Գտնում ենք բոլոր խաղացողներին, ովքեր կատարել են այս overallMaxBet-ը
    // const maxBetPlayersData = playerBetsData.filter(data => +data.betAmount == +overallMaxBet);
    // console.log('[ChipCapping 333] Ամենամեծ խաղադրույք կատարած խաղացող(ներ)ը:', maxBetPlayersData.map(p => p.playerId));

    // 4. Եթե մեկից ավելի խաղացող կա, ով կատարել է ամենամեծ խաղադրույքը, ոչինչ չենք անում
    // if (maxBetPlayersData.length > 1) {
    //   console.log('[ChipCapping 44444] Մեկից ավելի խաղացող կատարել է առավելագույն խաղադրույքը։ Սահմանափակում չի կիրառվում։');
    //   return handToProcess;
    // }

    // 5. Եթե ճիշտ մեկ խաղացող է կատարել եզակի overallMaxBet-ը
    // if (maxBetPlayersData.length === 1) {
    //   const playerToRefundData = maxBetPlayersData[0]; // Տվյալները այն խաղացողի, ով կարող է գումար հետ ստանալ
    //   const playerToRefundObject = playerToRefundData.playerObject; // Այդ խաղացողի Player օբյեկտը

    //   console.log(`[ChipCapping 555] Եզակի ամենամեծ խաղադրույքը կատարել է ${playerToRefundObject.name} (${playerToRefundData.playerId}) խաղացողը՝ ${+overallMaxBet} չափով։`);

    //   // Գտնում ենք երկրորդ ամենամեծ խաղադրույքը մնացած բոլոր խաղացողների մեջ
    //   let secondHighestBet = 0;
    //   playerBetsData.forEach(data => {
    //     if (data.playerId !== playerToRefundData.playerId) { // Բացառում ենք ամենամեծ խաղադրույք կատարած խաղացողին
    //       if (+data.betAmount > +secondHighestBet) {
    //         secondHighestBet = +data.betAmount;
    //       }
    //     }
    //   });
    //   console.log('[ChipCapping 5555555555] Երկրորդ ամենամեծ խաղադրույքը մյուսների մեջ:', +secondHighestBet);

    //   // 6. Եթե overallMaxBet-ը իրոք մեծ է secondHighestBet-ից
    //   // (այսինքն՝ նրա խաղադրույքը ոչ ոք չի հասցրել, և կա ավելի ցածր խաղադրույք)
    //   if (+overallMaxBet > +secondHighestBet) {
    //     const amountToReturn = +overallMaxBet - +secondHighestBet;
    //     console.log(`[ChipCapping 6] Վերադարձվող գումարը ${playerToRefundObject.name}-ին (${playerToRefundData.playerId}): ${+amountToReturn}`);

    //     if (+amountToReturn > 0) {
    //       // Ստանում ենք խաղացողի թարմ տվյալները բազայից՝ ճշգրիտ թարմացման համար
    //       const currentPlayerDataForUpdate = await this.repository.getPlayerById(playerToRefundObject.id);
    //       if (!currentPlayerDataForUpdate) {
    //         console.error(`[ChipCapping 66] Սխալ: ${playerToRefundObject.id} ID-ով խաղացողը չի գտնվել թարմացման համար։`);
    //         return null; // Կրիտիկական սխալ
    //       }
    //       // Ստանում ենք ձեռքի թարմ տվյալները
    //       const currentHandDataForUpdate = await this.repository.getHandById(handId);
    //        if (!currentHandDataForUpdate) {
    //         console.error(`[ChipCapping 666] Սխալ: ${handId} ID-ով ձեռքը չի գտնվել թարմացման համար։`);
    //         return null; // Կրիտիկական սխալ
    //       }

    //       // Թարմացնում ենք այն խաղացողին, ով հետ է ստանում գումարը
    //       await this.repository.updatePlayer(playerToRefundObject.id, {
    //         amount: +currentPlayerDataForUpdate.amount + +amountToReturn,
    //         all_bet_sum: (+currentPlayerDataForUpdate.all_bet_sum || 0) - +amountToReturn,
    //         // action_amount-ը (եթե այն ցույց է տալիս ռաունդի ընթացիկ ընդհանուր ներդրումը) պետք է դառնա secondHighestBet
    //         action_amount: +secondHighestBet,
    //       });
    //       console.log(`[ChipCapping 6666] ${playerToRefundObject.name} (${playerToRefundObject.id}) խաղացողը թարմացված է։ Նոր գումար՝ ${+currentPlayerDataForUpdate.amount + +amountToReturn}`);

    //       // Թարմացնում ենք ձեռքի տվյալները
    //       // last_raise_amount-ի ճշգրտումը կարևոր է, եթե overallMaxBet-ը raise էր։
    //       let newLastRaiseAmount = +currentHandDataForUpdate.last_raise_amount;
    //       // Եթե վերջին raise-ը հենց այս խաղացողի overallMaxBet-ն էր
    //       if (+currentHandDataForUpdate.last_raise_amount > 0 && +playerToRefundData.betAmount === +currentHandDataForUpdate.current_max_bet) {
    //         const betLevelBeforePlayerToRefundsRaise = +currentHandDataForUpdate.current_max_bet - +currentHandDataForUpdate.last_raise_amount;
    //         newLastRaiseAmount = +secondHighestBet - +betLevelBeforePlayerToRefundsRaise;
    //         if (+newLastRaiseAmount < 0) {
    //           // Եթե capped bet-ը (secondHighestBet) փոքր է նախորդ խաղադրույքի մակարդակից,
    //           // ապա սա այլևս raise չէ այդ նախորդ մակարդակի նկատմամբ։
    //           newLastRaiseAmount = 0;
    //         }
    //       }

    //       await this.repository.updateHand(handToProcess.id, { // Օգտագործում ենք handToProcess.id, որը նույնն է, ինչ handId
    //         pot_amount: +currentHandDataForUpdate.pot_amount - +amountToReturn,
    //         current_max_bet: +secondHighestBet, // Նոր արդյունավետ առավելագույն խաղադրույքը secondHighestBet-ն է
    //         last_raise_amount: +newLastRaiseAmount,
    //       });
    //       console.log(`[ChipCapping 66666] Ձեռքը թարմացված է։ Նոր բանկ՝ ${+currentHandDataForUpdate.pot_amount - +amountToReturn}, նոր current_max_bet՝ ${+secondHighestBet}`);

    //       // Խաղացողի վերջին action-ի amount-ի թարմացումը 'actions' աղյուսակում բարդ է և այս պարզեցված տարբերակում կարելի է բաց թողնել։
    //       // Հիմնականը խաղացողի և ձեռքի ընդհանուր գումարների ճշգրտումն է։

    //       // Վերստանում ենք ձեռքը՝ վերադարձնելու ամենաթարմ վիճակը
    //       const refreshedHand = await this.repository.getHandById(handId);
    //       if (!refreshedHand) {
    //         console.error("[ChipCapping 6 6 6 6 6 6] Կրիտիկական սխալ: Ձեռքը չի գտնվել թարմացումից հետո։");
    //         return null;
    //       }
    //       handToProcess = refreshedHand; // Վերագրում ենք թարմացված ձեռքը
    //     } else {
    //       console.log('[ChipCapping 6 + 66++6+6+6+] Վերադարձվող գումար չկա (amountToReturn <= 0)։');
    //     }
    //   } else {
    //     console.log('[ChipCapping6*6*6*6*6*6**6] Առավելագույն խաղադրույքը հավասար է կամ փոքր է երկրորդ ամենամեծ խաղադրույքից (կամ այլ խաղադրույքներ չկան)։ Սահմանափակում չի կիրառվում այս կանոնով։');
    //   }
    // } else {
    //   console.log('[ChipCapping2] Եզակի ամենամեծ խաղադրույք կատարած խաղացող չի գտնվել։ Սահմանափակում չի կիրառվում։');
    // }
  }

  private async reviewAndRefundUncalledAllInBet(
    gameId: UUID,
    handId: UUID,
    allInPlayerId: UUID, // Այն խաղացողի ID-ն, ով նախկինում All-in է գնացել
    currentHandInput: Hand, // Ձեռքի ընթացիկ վիճակը
    allGamePlayersInput: Player[] // Խաղի բոլոր խաղացողների զանգվածը (թարմ վիճակում)
  ): Promise<Hand | null> {
    // Վերադարձնում է թարմացված Hand օբյեկտը կամ null՝ սխալի դեպքում

    let modifiableHand: Hand | null = currentHandInput;
    const allInPlayer = allGamePlayersInput.find((p) => p.id === allInPlayerId);

    if (
      !allInPlayer ||
      allInPlayer.amount !== 0 ||
      allInPlayer.action === PlayerAction.Fold
    ) {
      console.log(
        `[ReviewAllIn] ${allInPlayerId} խաղացողը All-in չէ կամ fold է արել։ Ստուգում չի կատարվում։`
      );
      return modifiableHand;
    }

    const allInPlayerTotalBetInHand =
      await this.repository.getActionsBetAmountsByHandIdAndPlayerId(
        handId,
        allInPlayerId
      );

    if (allInPlayerTotalBetInHand === 0) {
      console.log(
        `[ReviewAllIn] ${allInPlayerId} խաղացողը խաղադրույք չի կատարել այս ձեռքում։ Վերադարձ չկա։`
      );
      return modifiableHand;
    }

    const otherActivePlayersInHand = allGamePlayersInput.filter(
      (p) =>
        p.id !== allInPlayerId && p.is_active && p.action !== PlayerAction.Fold
    );

    if (otherActivePlayersInHand.length === 0) {
      console.log(
        `[ReviewAllIn] ${allInPlayerId} խաղացողը All-in է։ Այլ ակտիվ խաղացողներ չկան։ Ձեռքը շահված է։`
      );
      return modifiableHand; // Այս դեպքում խաղացողը կշահի բանկը, վերադարձ չկա այս տրամաբանությամբ
    }

    // Հաշվարկում ենք All-in խաղացողի խաղադրույքից որքանն է առավելագույնը "ծածկվել" մեկ այլ խաղացողի կողմից։
    let maxBetCoveredByAnySingleOpponent = 0;
    for (const opponent of otherActivePlayersInHand) {
      const opponentTotalBetInHand =
        await this.repository.getActionsBetAmountsByHandIdAndPlayerId(
          handId,
          opponent.id
        );
      maxBetCoveredByAnySingleOpponent = Math.max(
        maxBetCoveredByAnySingleOpponent,
        Math.min(allInPlayerTotalBetInHand, opponentTotalBetInHand)
      );
    }

    if (allInPlayerTotalBetInHand > maxBetCoveredByAnySingleOpponent) {
      const amountToReturn =
        allInPlayerTotalBetInHand - maxBetCoveredByAnySingleOpponent;

      if (amountToReturn > 0) {
        console.log(
          `[ReviewAllIn] ${allInPlayer.name} (${allInPlayerId}) (All-in ${allInPlayerTotalBetInHand}-ով) հետ է ստանում ${amountToReturn}։ Արդյունավետ խաղադրույքը սահմանափակվել է ${maxBetCoveredByAnySingleOpponent}-ով։`
        );

        const currentAllInPlayerData = await this.repository.getPlayerById(
          allInPlayerId
        );
        const currentHandData = await this.repository.getHandById(handId);
        if (!currentAllInPlayerData || !currentHandData) {
          console.error(
            "[ReviewAllIn] Սխալ: Խաղացողի կամ ձեռքի տվյալները չեն գտնվել թարմացման համար։"
          );
          return modifiableHand;
        }

        await this.repository.updatePlayer(allInPlayerId, {
          amount: (currentAllInPlayerData.amount || 0) + amountToReturn,
          all_bet_sum:
            (currentAllInPlayerData.all_bet_sum || 0) - amountToReturn,
        });

        await this.repository.updateHand(handId, {
          pot_amount: currentHandData.pot_amount - amountToReturn,
        });

        modifiableHand = await this.repository.getHandById(handId);
        if (!modifiableHand) {
          console.error(
            "[ReviewAllIn] Սխալ: Ձեռքը չի գտնվել թարմացումից հետո։"
          );
          return null;
        }
        console.log(
          "[ReviewAllIn] All-in խաղացողի գումարի վերադարձը և տվյալների թարմացումը կատարված են։"
        );
      }
    } else {
      console.log(
        `[ReviewAllIn] ${allInPlayerId} խաղացողի All-in-ը (${allInPlayerTotalBetInHand}) ամբողջությամբ կամ մասամբ ծածկված է մինչև ${maxBetCoveredByAnySingleOpponent}։ Վերադարձ չկա։`
      );
    }
    return modifiableHand;
  }

  private async adjustBetForPlayerWhoseTurnIsIt(
    gameId: UUID,
    handId: UUID,
    playerWhoseTurnItIsId: UUID, // Այն խաղացողի ID-ն, ում հերթն է հիմա
    currentHandInput: Hand,
    playersInRound: Player[] // Բոլոր ակտիվ և չֆոլդ արած խաղացողները ռաունդում
  ): Promise<Hand | null> {
    let modifiableHand = currentHandInput;
    console.log(
      `[AdjustBetFT] Ստուգում է ${playerWhoseTurnItIsId} խաղացողի խաղադրույքը, քանի որ հերթը նորից հասել է նրան։`
    );

    if (playersInRound.length < 1) {
      return modifiableHand;
    }

    const playerWhoseTurnDataObject = playersInRound.find(
      (p) => p.id === playerWhoseTurnItIsId
    );
    if (!playerWhoseTurnDataObject) {
      console.error(
        `[AdjustBetFT] ${playerWhoseTurnItIsId} ID-ով խաղացողը չի գտնվել playersInRound-ում։`
      );
      return null;
    }

    const playerTurnTotalBetThisRound =
      await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
        handId,
        playerWhoseTurnItIsId,
        modifiableHand.current_round
      );

    if (
      playerTurnTotalBetThisRound !== modifiableHand.current_max_bet ||
      modifiableHand.current_max_bet === 0
    ) {
      console.log(
        `[AdjustBetFT] ${playerWhoseTurnItIsId} խաղացողի խաղադրույքը (${playerTurnTotalBetThisRound}) current_max_bet (${modifiableHand.current_max_bet}) չէ, կամ max_bet-ը 0 է։ Ճշգրտում չի կատարվում։`
      );
      return modifiableHand;
    }

    const otherPlayerBetsData = await Promise.all(
      playersInRound
        .filter((p) => p.id !== playerWhoseTurnItIsId)
        .map(async (opponent) => {
          const betAmount =
            await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
              handId,
              opponent.id,
              modifiableHand.current_round
            );
          return { playerId: opponent.id, betAmount, playerObject: opponent };
        })
    );

    const hasMatchingBet = otherPlayerBetsData.some(
      (data) => data.betAmount === playerTurnTotalBetThisRound
    );

    if (hasMatchingBet) {
      console.log(
        `[AdjustBetFT] Առնվազն մեկ այլ խաղացող հասցրել է ${playerWhoseTurnItIsId}-ի ${playerTurnTotalBetThisRound} խաղադրույքը։ Ճշգրտում չկա։`
      );
      return modifiableHand;
    }

    let secondHighestBet = 0;
    if (otherPlayerBetsData.length > 0) {
      otherPlayerBetsData.forEach((data) => {
        if (data.betAmount > secondHighestBet) {
          secondHighestBet = data.betAmount;
        }
      });
    } else {
      console.log(
        `[AdjustBetFT] ${playerWhoseTurnItIsId}-ից բացի այլ ակտիվ խաղացողներ չկան այս խաղադրույքի մակարդակում։`
      );
    }
    console.log(
      `[AdjustBetFT] ${playerWhoseTurnItIsId}-ի խաղադրույքը ոչ ոք չի հասցրել։ Մյուսների մեջ ամենամեծ խաղադրույքը՝ ${secondHighestBet}։`
    );

    if (playerTurnTotalBetThisRound > secondHighestBet) {
      const amountToReturn = playerTurnTotalBetThisRound - secondHighestBet;
      console.log(
        `[AdjustBetFT] Վերադարձվում է ${amountToReturn} գումար ${playerWhoseTurnItIsId} խաղացողին։ Նրա արդյունավետ խաղադրույքը դառնում է ${secondHighestBet}։`
      );

      const currentPlayerDataForUpdate = await this.repository.getPlayerById(
        playerWhoseTurnItIsId
      );
      if (!currentPlayerDataForUpdate) {
        console.error(
          `[AdjustBetFT] ${playerWhoseTurnItIsId} ID-ով խաղացողը չի գտնվել թարմացման համար։`
        );
        return null;
      }
      const currentHandDataForUpdate = await this.repository.getHandById(
        handId
      );
      if (!currentHandDataForUpdate) {
        console.error(
          `[AdjustBetFT] ${handId} ID-ով ձեռքը չի գտնվել թարմացման համար։`
        );
        return null;
      }

      await this.repository.updatePlayer(playerWhoseTurnItIsId, {
        amount: currentPlayerDataForUpdate.amount + amountToReturn,
        all_bet_sum:
          (currentPlayerDataForUpdate.all_bet_sum || 0) - amountToReturn,
        action_amount: secondHighestBet,
      });

      let newLastRaiseAmount = currentHandDataForUpdate.last_raise_amount;
      if (
        currentHandDataForUpdate.last_raise_amount > 0 &&
        playerTurnTotalBetThisRound === currentHandDataForUpdate.current_max_bet
      ) {
        const betLevelBeforeOriginalRaise =
          currentHandDataForUpdate.current_max_bet -
          currentHandDataForUpdate.last_raise_amount;
        newLastRaiseAmount = secondHighestBet - betLevelBeforeOriginalRaise;
        if (newLastRaiseAmount < 0) newLastRaiseAmount = 0;
      }

      await this.repository.updateHand(handId, {
        pot_amount: currentHandDataForUpdate.pot_amount - amountToReturn,
        current_max_bet: secondHighestBet,
        last_raise_amount: newLastRaiseAmount,
      });

      const refreshedHand = await this.repository.getHandById(handId);
      if (!refreshedHand) {
        console.error(
          "[AdjustBetFT] Կրիտիկական սխալ: Ձեռքը չի գտնվել թարմացումից հետո։"
        );
        return null;
      }
      modifiableHand = refreshedHand;
      console.log(
        `[AdjustBetFT] ${playerWhoseTurnItIsId} խաղացողը և ձեռքը թարմացված են։`
      );
    } else {
      console.log(
        `[AdjustBetFT] ${playerWhoseTurnItIsId} խաղացողի խաղադրույքը (${playerTurnTotalBetThisRound}) մեծ չէ երկրորդ ամենամեծ խաղադրույքից (${secondHighestBet})։ Վերադարձ չկա։`
      );
    }
    return modifiableHand;
  }

  /**
   * Կառավարում է խաղացողի հերթը և խաղադրույքների ճշգրտման տրամաբանությունը։
   *
   * @param gameId Խաղի ID-ն։
   * @param handId Ձեռքի ID-ն։
   * @param actingPlayerId Այն խաղացողի ID-ն, ով հենց նոր կատարեց գործողություն։
   */
  private async processPlayerTurnAndBetting(
    gameId: UUID,
    handId: UUID,
    actingPlayerId: UUID // Փոփոխված պարամետրի անուն
  ): Promise<void> {
    console.log(
      `[ProcessTurn] Սկսվում է խաղացողի հերթի և խաղադրույքի մշակումը։`
    );

    // 1. Ստացում սկզբնական տվյալների
    let currentHand = await this.repository.getHandById(handId);
    if (!currentHand) {
      console.error(`[ProcessTurn] Ձեռքը ${handId} չի գտնվել։`);
      return; // Դուրս գալ, եթե ձեռքը չի գտնվել
    }
    let allGamePlayers = await this.repository.getPlayers(gameId);
    let activeNotFoldedPlayers = allGamePlayers.filter(
      (p) => p.is_active && p.action !== PlayerAction.Fold
    );

    // 1.1. Գտնել հաջորդ խաղացողին, ում հերթն է հիմա
    const lastActingPlayerIndexInAllPlayers = allGamePlayers.findIndex(
      (p) => p.id === actingPlayerId
    );
    // console.log(
    //   `[ProcessTurn] ֊ lastActingPlayerIndexInAllPlayers ։ `,
    //   lastActingPlayerIndexInAllPlayers
    // );
    if (lastActingPlayerIndexInAllPlayers === -1) {
      console.error(
        `[ProcessTurn] Նախորդ գործողություն կատարած խաղացողը (${actingPlayerId}) չի գտնվել բոլոր խաղացողների ցուցակում։`
      );
      return;
    }

    let playerWhoseTurnIsDetermined: Player | null = null;
    const numberOfAllPlayers = allGamePlayers.length;

    for (let i = 1; i <= numberOfAllPlayers; i++) {
      console.log(" ");
      console.log(" ");

      const nextPotentialPlayerIndex =
        (lastActingPlayerIndexInAllPlayers + i) % numberOfAllPlayers;

      console.log(
        `[ProcessTurn] ֊ nextPotentialPlayerIndex ։ `,
        nextPotentialPlayerIndex
      );
      const potentialNextPlayer = allGamePlayers[nextPotentialPlayerIndex];
      console.log(
        `[ProcessTurn] ֊ potentialNextPlayer ։ `,
        potentialNextPlayer
      );
      const isPlayerActiveAndNotInFold = activeNotFoldedPlayers.some(
        (p) => p.id === potentialNextPlayer.id
      );

      console.log(
        `[ProcessTurn] ֊ isPlayerActiveAndNotInFold ։ `,
        isPlayerActiveAndNotInFold
      );

      if (isPlayerActiveAndNotInFold) {
        const playerInvestmentInRound =
          await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
            handId,
            potentialNextPlayer.id,
            currentHand.current_round
          );

        console.log(
          `[ProcessTurn] ֊ playerInvestmentInRound ։ `,
          playerInvestmentInRound
        );

        const targetBetForRound = +currentHand.current_max_bet;
        console.log(`[ProcessTurn] ֊ targetBetForRound ։ `, targetBetForRound);

        if (
          +potentialNextPlayer.amount > 0 &&
          playerInvestmentInRound < targetBetForRound
        ) {
          console.log(`[ProcessTurn] ֊ 1111 ։ `);
          playerWhoseTurnIsDetermined = potentialNextPlayer;
          break;
        } else if (
          +potentialNextPlayer.amount > 0 &&
          playerInvestmentInRound === targetBetForRound &&
          currentHand.current_round === Round.Preflop &&
          potentialNextPlayer.id === currentHand.big_blind &&
          potentialNextPlayer.action !== PlayerAction.Check &&
          potentialNextPlayer.action !== PlayerAction.Raise &&
          potentialNextPlayer.action !== PlayerAction.ReRaise
        ) {
          console.log(`[ProcessTurn] ֊ 2222 ։ `);
          playerWhoseTurnIsDetermined = potentialNextPlayer;
          break;
        }
      }
    }

    // 2. Ստուգել արդյոք նախորդ անգամ խաղացողը All-in է արել թե ոչ
    const actingPlayerObject = allGamePlayers.find(
      (p) => p.id === actingPlayerId
    ); // Օգտագործում է նոր անունը
    if (!actingPlayerObject) {
      console.error(
        `[ProcessTurn] Նախորդ գործողություն կատարած խաղացողը (${actingPlayerId}) չի գտնվել։`
      );
      return;
    }

    if (
      +actingPlayerObject.amount === 0 &&
      actingPlayerObject.action === PlayerAction.AllIn
    ) {
      console.log(
        `[ProcessTurn] Նախորդ գործողություն կատարող (${actingPlayerId}) All-in էր։ Ստուգում է վերադարձը։`
      );
      // Կանչում ենք reviewAndRefundUncalledAllInBet մեթոդը
      // Այս մեթոդը թարմացնում է բազան և վերադարձնում է թարմացված Hand օբյեկտը։
      // Քանի որ այս մեթոդը հիմա ոչինչ չի վերադարձնում, պետք է նորից ստանանք Hand-ը
      const handAfterRefundReview = await this.reviewAndRefundUncalledAllInBet(
        gameId,
        handId,
        actingPlayerId,
        currentHand, // Փոխանցում ենք currentHand, որը կօգտագործվի reviewAndRefund-ի ներսում
        allGamePlayers
      );

      console.log(
        `[ProcessTurn] ֊ handAfterRefundReview ։ `,
        handAfterRefundReview
      );
      // Եթե reviewAndRefundUncalledAllInBet-ը վերադարձնում է Hand | null,
      // ապա այստեղ պետք է այն ստանանք և թարմացնենք currentHand-ը։
      // Եթե reviewAndRefundUncalledAllInBet-ը փոփոխվել է void վերադարձնելու, ապա պարզապես
      // կվերստանանք currentHand-ը բազայից։
      if (!handAfterRefundReview) {
        // reviewAndRefundUncalledAllInBet-ը կարող է դառնալ void
        console.error(
          "[ProcessTurn] All-in խաղացողի վերադարձի ստուգումը ձախողվեց։"
        );
        return;
      }
      currentHand = handAfterRefundReview; // Թարմացնում ենք currentHand-ը
      // Թարմացնել խաղացողների ցանկը, քանի որ նախորդ All-in խաղացողի ֆիշկաները կարող էին փոխվել
      allGamePlayers = await this.repository.getPlayers(gameId);
      activeNotFoldedPlayers = allGamePlayers.filter(
        (p) => p.is_active && p.action !== PlayerAction.Fold
      );
    }

    // 3-9. Խաղադրույքների ճշգրտման հիմնական տրամաբանություն
    // Սա պետք է աշխատի այն դեպքում, երբ հերթը նորից հասել է այն խաղացողին, ով նախկինում ագրեսիվ խաղադրույք է կատարել։

    console.log(
      `[ProcessTurn] ֊ playerWhoseTurnIsDetermined ։ `,
      playerWhoseTurnIsDetermined
    );
    if (playerWhoseTurnIsDetermined) {
      // Կանչում ենք adjustBetForPlayerWhoseTurnIsIt մեթոդը։
      // Այն նույնպես թարմացնում է բազան և վերադարձնում է թարմացված Hand օբյեկտը։
      const handAfterAdjustment = await this.adjustBetForPlayerWhoseTurnIsIt(
        gameId,
        handId,
        playerWhoseTurnIsDetermined.id,
        currentHand, // Փոխանցում ենք currentHand-ի թարմ վիճակը
        activeNotFoldedPlayers // Ակտիվ և չֆոլդ արած խաղացողների թարմացված ցուցակը
      );
      if (!handAfterAdjustment) {
        console.error("[ProcessTurn] Խաղադրույքի ճշգրտման մեթոդը ձախողվեց։");
        return;
      }
      currentHand = handAfterAdjustment; // Թարմացնում ենք currentHand-ը
      // Թարմացնել խաղացողների ցանկը, քանի որ խաղադրույքի ճշգրտումը կարող էր փոխել դրանք
      allGamePlayers = await this.repository.getPlayers(gameId);
      activeNotFoldedPlayers = allGamePlayers.filter(
        (p) => p.is_active && p.action !== PlayerAction.Fold
      );
    }

    // Այստեղից կարող է շարունակվել nextPlayer-ի հիմնական տրամաբանությունը (ռաունդի ավարտ, Showdown)
    // քանի որ currentHand-ը և activeNotFoldedPlayers-ը արդեն թարմացված են։

    // Վերջնական որոշում՝ ում հերթն է լինելու
    if (playerWhoseTurnIsDetermined) {
      await this.repository.updateHand(handId, {
        current_player_turn_id: playerWhoseTurnIsDetermined.id,
        is_changed_current_round: false,
      });
      console.log(
        `[ProcessTurn] Հերթը հաստատված է: ${playerWhoseTurnIsDetermined.name} (ID: ${playerWhoseTurnIsDetermined.id})։`
      );
    } else {
      console.log(
        "[ProcessTurn] Հաջորդ գործող խաղացող չի գտնվել։ Ռաունդը պետք է ավարտվի։"
      );
      // Այստեղից դուք պետք է անցնեք ռաունդի ավարտի տրամաբանությանը։
    }
  }

  async handleChipCapping13(
    gameId: UUID,
    handId: UUID,
    actingPlayerId: UUID
  ): Promise<void> {
    console.log("=========== START CHIP CAPPING 3 ============");

    // 1. Find the next player who might need a refund
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
    const actingPlayerIndex = players.findIndex((p) => p.id === actingPlayerId);

    // Find next active player who hasn't folded and isn't all-in
    let nextPlayerIndex = -1;
    for (let i = 1; i <= players.length; i++) {
      const index = (actingPlayerIndex + i) % players.length;
      const player = players[index];
      if (player.is_active && player.action !== PlayerAction.Fold) {
        nextPlayerIndex = index;
        break;
      }
    }
    console.log("nextPlayerIndex", nextPlayerIndex);

    if (nextPlayerIndex === -1) {
      console.log("No eligible next player found for chip capping");
      return;
    }

    const nextPlayer = players[nextPlayerIndex];

    console.log("nextPlayer", nextPlayer);
    console.log(
      `Next player to check for capping: ${nextPlayer.name} (${nextPlayer.id})`
    );

    // 2. Check if next player went all-in
    const isNextPlayerAllIn =
      nextPlayer.action === PlayerAction.AllIn && +nextPlayer.amount === 0;
    console.log(`Is next player all-in: ${isNextPlayerAllIn}`);

    // 3. Get all players' bets in current round
    const playerBets = await Promise.all(
      activePlayers.map(async (player) => ({
        playerId: player.id,
        betAmount:
          await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
            handId,
            player.id,
            hand.current_round
          ),
        playerData: player,
      }))
    );

    console.log("Player bets in current round:", playerBets);

    // 4. Find the maximum bet amount
    const maxBet = Math.max(...playerBets.map((p) => +p.betAmount));
    console.log(`Max bet in current round: ${maxBet}`);

    // 5. Check if any other player has matched next player's bet
    const nextPlayerBet =
      playerBets.find((p) => p.playerId === nextPlayer.id)?.betAmount || 0;
    console.log(`Next player's bet: ${nextPlayerBet}`);

    const hasMatchingBet = playerBets.some(
      (p) => p.playerId !== nextPlayer.id && +p.betAmount === +nextPlayerBet
    );

    console.log("hasMatchingBet", hasMatchingBet);

    if (hasMatchingBet) {
      console.log("Another player has matched the bet, no capping needed");
      return;
    }

    // 7. Find second highest bet amount (excluding next player)
    let secondHighestBet = 0;
    playerBets.forEach((p) => {
      if (p.playerId !== nextPlayer.id && p.betAmount > secondHighestBet) {
        secondHighestBet = p.betAmount;
      }
    });
    console.log(`Second highest bet: ${secondHighestBet}`);

    // 8. Calculate amount to refund
    const amountToRefund = +nextPlayerBet - secondHighestBet;
    if (amountToRefund <= 0) {
      console.log("No refund needed");
      return;
    }

    console.log(`Amount to refund to ${nextPlayer.name}: ${amountToRefund}`);

    // 9. Update pot, current_max_bet and player's last action amount
    const [currentPlayerData, currentHandData] = await Promise.all([
      this.repository.getPlayerById(nextPlayer.id),
      this.repository.getHandById(handId),
    ]);

    if (!currentPlayerData || !currentHandData) {
      throw new Error("Player or hand data not found for update");
    }

    // Update player's amount and bet sum
    await this.repository.updatePlayer(nextPlayer.id, {
      amount: +currentPlayerData.amount + +amountToRefund,
      all_bet_sum: currentPlayerData.all_bet_sum - amountToRefund,
      action_amount: secondHighestBet,
    });

    // Update hand's pot and max bet
    await this.repository.updateHand(handId, {
      pot_amount: currentHandData.pot_amount - amountToRefund,
      current_max_bet: secondHighestBet,
      last_raise_amount: Math.max(
        0,
        secondHighestBet - (maxBet - hand.last_raise_amount)
      ),
    });

    // // Update the player's last action amount
    // const lastAction = await this.repository.getLastActionForPlayerInRound(
    //   handId,
    //   nextPlayer.id,
    //   hand.current_round
    // );

    // if (lastAction) {
    //   await this.repository.updateAction(lastAction.id, {
    //     amount: secondHighestBet
    //   });
    // }

    console.log("=========== END CHIP CAPPING 3 ============");
  }

  async handleChipCapping3(
    gameId: UUID,
    handId: UUID,
    actingPlayerId: UUID
  ): Promise<void> {
    console.log("=========== START CHIP CAPPING 3 ============");

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
    const allInPlayers = playerBets.filter(
      (p) => p.playerData.action === PlayerAction.AllIn
    );

    if (allInPlayers.length < 2) {
      console.log("Not enough all-in players for capping check");
      return;
    }

    // 4. For each all-in player, calculate their effective all-in amount
    const effectiveAllIns = allInPlayers.map((player) => {
      const totalInvested = +player.playerData.all_bet_sum;
      const currentRoundInvested = +player.betAmount;
      return {
        ...player,
        effectiveAllIn: +Math.min(
          totalInvested,
          currentRoundInvested + +player.playerData.amount
        ),
      };
    });

    // 5. Sort by effective all-in amount (descending)
    effectiveAllIns.sort((a, b) => +b.effectiveAllIn - +a.effectiveAllIn);
    console.log("effectiveAllIns", effectiveAllIns);

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
    const refundAmount =
      +highestAllIn.effectiveAllIn - +secondHighestAllIn.effectiveAllIn;
    console.log("refundAmount", refundAmount);

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

    // Update the player's last action amount
    // const lastAction = await this.repository.getLastActionForPlayerInRound(
    //   handId,
    //   highestAllIn.playerId,
    //   hand.current_round
    // );

    // if (lastAction) {
    //   await this.repository.updateAction(lastAction.id, {
    //     amount: secondHighestAllIn.effectiveAllIn.toString()
    //   });
    // }

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

    console.log("=========== END CHIP CAPPING 3 ============");
  }

  async nextPlayer(gameId: UUID, handId: UUID, playerId: UUID): Promise<void> {
    console.log("");
    console.log("************** HANDLE NEXT PLAYER **************");
    console.log("playerId", playerId);
    console.log(" ");
    console.log(" ");

    // console.log("+++++++++++++ ԿԱՆՉՈՒՄ ԵՆՔ CHIP CAPPING ՄԵԹՈԴԸ +++++++++++++");
    // await this.handleChipCapping3(gameId, handId, playerId);
    // // await this.processPlayerTurnAndBetting(gameId, handId, playerId);
    // console.log("+++++++++++++ ԱՎԱՐՏ CHIP CAPPING ՄԵԹՈԴԻ ԿԱՆՉԻ +++++++++++++");
    // console.log(" ");
    // console.log(" ");

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
      await this.handleChipCapping3(gameId, handId, playerId);
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

    const activeNotFoldedNotAllInPlayers = activeNotFoldedPlayers.filter(
      (player) => player.action !== PlayerAction.AllIn
    );
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
              await this.handleChipCapping3(gameId, handId, playerId);
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
              await this.handleChipCapping3(gameId, handId, playerId);
              await this.repository.updateHand(handId, {
                current_round: Round.Showdown,
              });
            }
          } else {
            // խաղը շարունակում են ոչ All֊In խաղացողները
            // պետք է անցին հաջորդ խաղացողին
            const nextRound = nextRoundMap[currentRound];

            // todo
            await this.handleChipCapping3(gameId, handId, playerId);
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
          await this.handleChipCapping3(gameId, handId, playerId);
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
          await this.handleChipCapping3(gameId, handId, playerId);
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
      // console.log('+++++++++++++ ԿԱՆՉՈՒՄ ԵՆՔ CHIP CAPPING ՄԵԹՈԴԸ +++++++++++++');
      // const handAfterCapping = await this.handleChipCapping2(
      //   gameId,
      //   handId,
      //   nextActivePlayer.id,
      //   hand,
      //   players,
      //   activeNotFoldedPlayers
      // );

      // if (!handAfterCapping) {
      //   console.error("Ֆիշկաների սահմանափակման (capping) մեթոդը վերադարձրել է null։ nextPlayer-ը դադարեցվում է։");
      //   return;
      // }
      // let currentHand: Hand = handAfterCapping; // Օգտագործում ենք capping-ից հետո ստացված (կամ չփոփոխված) ձեռքը

      // console.log('+++++++++++++ ԱՎԱՐՏ CHIP CAPPING ՄԵԹՈԴԻ ԿԱՆՉԻ +++++++++++++', handAfterCapping);

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

  async nextPlayer2(gameId: UUID, handId: UUID, playerId: UUID): Promise<void> {
    console.log("");
    console.log("************** HANDLE NEXT PLAYER **************");
    console.log("");

    const hand = await this.repository.getHandById(handId);
    if (hand) {
      const activePlayers = await this.repository.getPlayers(gameId);
      const foldingPlayerIndex = activePlayers.findIndex(
        (p) => p.id === playerId
      );
      const activeNotFoldedPlayers = activePlayers.filter(
        (p) => p.is_active && p.action !== PlayerAction.Fold
      );
      if (activeNotFoldedPlayers.length < 2) {
        await this.repository.updateHand(handId, {
          current_round: Round.Showdown,
        });
      } else {
        const playersCurrentRoundActions = await Promise.all(
          activeNotFoldedPlayers.map((player) => {
            return this.repository.getActionsByHandIdAndPlayerIdAndRound(
              handId,
              player.id,
              hand.current_round
            );
          })
        );
        const allPlayersActedCurrentRound = playersCurrentRoundActions.every(
          (action) => action.length > 0
        );
        const allPlayersActed = activeNotFoldedPlayers.every(
          (player) => player.action !== null && player.action !== ""
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

        const allActionAmountsEqual = playersBetAmounts.every(
          (element) => element === playersBetAmounts[0]
        );
        const allPlayerActionEqual = activeNotFoldedPlayers.every(
          (element) =>
            element.action === activeNotFoldedPlayers[0].action &&
            ![PlayerAction.Raise, PlayerAction.ReRaise].includes(element.action)
        );

        let nextActivePlayer = null;

        if (
          (allPlayerActionEqual || allActionAmountsEqual) &&
          allPlayersActed &&
          allPlayersActedCurrentRound &&
          !hand.is_changed_current_round
        ) {
          console.log("All active players have equal action_amount!");
          const isAllPlayerActionAllIn = activeNotFoldedPlayers.every(
            (element) => element.action === PlayerAction.AllIn
          );

          const currentRound = isAllPlayerActionAllIn
            ? Round.River
            : hand.current_round;
          const nextRoundMap = {
            [Round.Preflop]: Round.Flop,
            [Round.Flop]: Round.Turn,
            [Round.Turn]: Round.River,
            [Round.River]: Round.Showdown,
            [Round.Showdown]: Round.Showdown,
          };

          const nextRound = nextRoundMap[currentRound];
          if (nextRound && nextRound !== currentRound) {
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
          }

          const activePlayers = await this.repository.getPlayers(gameId);

          const bigBlindPlayerIndex = activePlayers.findIndex(
            (p) => p.id === hand.dealer
          );

          if (bigBlindPlayerIndex === -1) {
            console.error("Big blind player not found!");
            return;
          }

          let nextIndex = (bigBlindPlayerIndex + 1) % activePlayers.length;
          let attempts = 0;
          while (attempts < activePlayers.length) {
            const player = activePlayers[nextIndex];

            if (player.is_active && player.action !== PlayerAction.Fold) {
              nextActivePlayer = player;
              break;
            }

            nextIndex = (nextIndex + 1) % activePlayers.length;
            attempts++;
          }
        } else {
          let nextIndex = (foldingPlayerIndex + 1) % activePlayers.length;
          let attempts = 0;
          while (!nextActivePlayer && attempts < activePlayers.length) {
            const player = activePlayers[nextIndex];
            if (player.is_active && player.action !== PlayerAction.Fold) {
              nextActivePlayer = player;
            } else {
              nextIndex = (nextIndex + 1) % activePlayers.length;
              attempts++;
            }
          }
        }

        if (nextActivePlayer) {
          await this.repository.updateHand(handId, {
            current_player_turn_id: nextActivePlayer.id,
            is_changed_current_round: false,
          });
        } else {
          console.log("Ձեռքն ավարտվեց, մնաց միայն մեկ ակտիվ խաղացող");
        }
      }
    }
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
