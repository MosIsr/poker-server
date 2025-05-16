import { inject, injectable } from 'inversify';
import { TYPES } from '../di/types';
import { UUID } from 'crypto';
import { DateTime } from 'luxon';
import IGameService from './interfaces/IGameService';
import DomainError from '../errors/domain.error';
import { IRepository } from '../repositories/interfaces/IRepository';
import { Players } from '../utils/get-players';
import { Round } from '../enums/round.enum';
import { PlayerAction } from '../enums/player-action.enum';
import Player from '../models/player';
import Hand from '../models/hand';
import ActionsOpportunities from 'src/interfaces/actions-opportunities';


@injectable()
export default class GameService implements IGameService {
  constructor(
    @inject(TYPES.Repository) private repository: IRepository,
  ) {}

  async startGame(
    blindTime:number,
    playersChips: number
  ): Promise<{ 
    players: Player[]; 
    hand: Hand; 
    level: number; 
    blindTime: number,
    playerActions: ActionsOpportunities,
  }> {
    console.log('startGame');
    
    try {
      const game = await this.repository.createGame(blindTime, playersChips, DateTime.now());
      
      const gameBlind =  await this.repository.getGameBlindByLevel(game.level);
      if(!gameBlind) {
        throw new DomainError(' Game Blind not found');
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
          actionAmount,
        );
      }

      let players = await this.repository.getPlayers(game.id);
      const handLevel = 1;

      const hand = await this.repository.createHand(
        game.id,
        handLevel,
        players[0].id,
        players[1].id,
        players[2].id,
        0,
        ante,
        smallBlindAmount,
        bigBlindAmount,
        0,
        0,
        0,
        Round.Preflop,
        false,
        players[3].id,
      );

      await this.performAction(
        game.id,
        hand.id,
        players[1].id,
        PlayerAction.Bet,
        smallBlindAmount,
      );
      await this.performAction(
        game.id,
        hand.id,
        players[2].id,
        PlayerAction.Raise,
        bigBlindAmount,
      );

      const playerActions = await this.getPlayerActionsOpportunities(game.id, hand.id);
      const updatedHand = await this.repository.getHandById(hand.id);
      if(!updatedHand) {
        throw new Error(`Ձեռքը ${hand.id} համարով գոյություն չունի`);
      }
      players = await this.repository.getPlayers(game.id);

      return {
        players,
        hand: updatedHand,
        level: handLevel,
        blindTime,
        playerActions,
      }
    } catch (error) {
      console.log('Start Game error: ', error);
      throw new DomainError('Start Game error');
    }
  }

  async getPlayerActionsOpportunities(
    gameId: UUID,
    handId: UUID,
  ): Promise<ActionsOpportunities> {

    const game = await this.repository.getGame(gameId);
    if (!game) {
      throw new Error(`Խաղը ${gameId} համարով գոյություն չունի`);
    }
    const hand = await this.repository.getHandById(handId);
    if (!hand) {
      throw new Error(`Ձեռքը ${handId} համարով գոյություն չունի`);
    }
    const currentRound = hand.current_round;
    const isCurrentRoundHaveBet = await this.repository.hasAllActionTypes(
      handId,
      currentRound,
      [PlayerAction.Bet]
    );

    const isCurrentRoundHaveBetAndRaise = await this.repository.hasAllActionTypes(
      handId,
      currentRound,
      [PlayerAction.Bet, PlayerAction.Raise]
    );

    const turnPlayer = await this.repository.getPlayerById(hand.current_player_turn_id);
    if (!turnPlayer) {
      throw new Error(`Խաղացողը ${hand.current_player_turn_id} համարով գոյություն չունի`);
    }
    const isCanFold = isCurrentRoundHaveBet;
    const isCanCall = isCurrentRoundHaveBet;
    const isCanCheck = !isCurrentRoundHaveBet;
    const isCanBet = !isCurrentRoundHaveBet;
    const raiseMinAmount = +hand.current_max_bet * 2
    const isCanRaise = isCurrentRoundHaveBet ? isCurrentRoundHaveBetAndRaise ? false : true : false;
    const isCanReRaise = isCurrentRoundHaveBetAndRaise && turnPlayer.amount > raiseMinAmount ? true : false;

    const gameBlind = await this.repository.getGameBlindByLevel(game.level);
    if (!gameBlind) {
      throw new Error(`Խաղի տեղեկությունը ${game.level} համար գոյություն չունի`);
    }
    let betMinAmount = +gameBlind.big_blind_amount;
    if (currentRound === Round.Preflop) {
      betMinAmount = +gameBlind.small_blind_amount;
    }

    const actions: ActionsOpportunities = {
      isCanFold,                                  // եթե կա bet ապա true, եթե չկա bet ապա false, 
      isCanCall,                                  // եթե կա bet ապա true, եթե չկա bet ապա false
      // callAmount,                                // իր bet֊ի չափ պետք է հավասարվի ամենամեծ bet֊ի չափ (hand.current_max_bet), 
      //                                            // իսկ եթե իր amount < hand.current_max_bet ֊ից, 
      //                                            // ապա callAmount պետք է լինի ամբողջ իր amount֊ի չափ
      isCanCheck,                                 // եթե չկա bet ապա false
      isCanBet,                                   // եթե կա bet ապա false, եթե չկա bet ապա true
      betMinAmount,                               // Preflop-ում SB֊ի չափ, մնացած ռաունդներում BB֊ի չափ
      isCanRaise,                                 // եթե չկա bet ապա false, եթե կա bet և չկա raise ապա true, եթե կա bet և կա raise ապա false
      isCanReRaise,                               // եթե չկա bet ապա false, եթե կա bet և չկա raise ապա false, եթե կա bet և կա raise ապա true
      raiseMinAmount,                             // Min ամենամեծ bet֊ի կրկնապատիկի չափ (2 * hand.current_max_bet)
      isCanAllIn: true,                           // միշտ true է 
      allInAmount: +turnPlayer.amount,            // միշտ պետք է լինի Player֊ի amount֊ի չափ
    }
    
    return actions;
  }


  async performAction(
    gameId: UUID,
    handId: UUID,
    playerId: UUID,
    actionType: string,
    betAmount?: number,
  ): Promise<void> {
    console.log('+++++++++++++++ START ACTION +++++++++++++++');
    const hand = await this.repository.getHandById(handId);
    
    if (!hand) {
      throw new Error(`Ձեռքը ${handId} համարով գոյություն չունի`);
    }

    const player = await this.repository.getPlayerById(playerId);
    if (!player) {
      throw new Error(`Խաղացողը ${playerId} համարով գոյություն չունի`);
    }

    if (hand?.game_id !== gameId || player?.game_id !== gameId) {
      throw new DomainError('Խաղացողը կամ ձեռքը չեն պատկանում նշված խաղին');
    }

    if (!player.is_active) {
      throw new Error(`Խաղացողը ${playerId} համարով դուրս է խաղից`);
    }
 
    if (actionType === PlayerAction.Raise && betAmount !== undefined) {
      await this.handleRaiseAction(
        gameId,
        hand,
        playerId,
        betAmount,
      );
    } else if (actionType === PlayerAction.ReRaise && betAmount !== undefined) {
      await this.handleReRaiseAction(
        gameId,
        hand,
        playerId,
        betAmount,
      );
    } else if (actionType === PlayerAction.Bet && betAmount !== undefined) {
      await this.handleBetAction(
        gameId,
        hand,
        playerId,
        betAmount,
      );
    } else if (actionType === PlayerAction.Call) {
      await this.handleCallAction(
        gameId,
        hand,
        playerId,
      )
    } else if (actionType === PlayerAction.Fold) {
      await this.handleFoldAction(
        gameId,
        hand,
        playerId,
      );
    } else if (actionType === PlayerAction.Check) {
      await this.handleCheckAction(
        gameId,
        hand,
        playerId,
      );
    } else if (actionType === PlayerAction.AllIn) {
      await this.handleAllInAction(
        gameId,
        hand,
        playerId,
      );
      
    }

    

    console.log('========================================');
    console.log('');
    console.log('');
    console.log('');
    console.log('');
    
    // Ավելացնել տրամաբանություն փուլի ավարտի և հաջորդ փուլին անցնելու համար




    console.log('+++++++++++++++ END ACTION +++++++++++++++');
  }

  async handleBetAction(
    gameId: UUID,
    hand: Hand,
    playerId: UUID,
    betAmount: number,
  ) {
    console.log('************** START BET **************');

    const player = await this.repository.getPlayerById(playerId);
    if(player && betAmount) {
      await this.repository.updatePlayer(
        playerId,
        {
          amount: player?.amount - betAmount,
          action: PlayerAction.Bet,
          action_amount: +betAmount,
          all_bet_sum: +player.all_bet_sum + +betAmount,
        }
      );
      await this.repository.updateHand(
        hand.id,
        {
          pot_amount: +hand.pot_amount + +betAmount,
          last_raise_amount: betAmount,
          current_max_bet: betAmount,
        }
      );
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(hand.id);
    
    let currentBetAmount = betAmount || 0;

    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      PlayerAction.Bet,
      currentBetAmount,
    );

    await this.nextPlayer(gameId, hand.id, playerId);

    console.log('************** END BET **************');
  }

  async handleRaiseAction(
    gameId: UUID,
    hand: Hand,
    playerId: UUID,
    betAmount: number,
  ) {
    console.log('************** START RAISE **************');
    
    const minRaiseAmount = +hand.current_max_bet + (+hand.current_max_bet > 0 ? +hand.last_raise_amount : +hand.big_blind_amount);
    
    if (betAmount < minRaiseAmount) {
      throw new Error(`Ռեյզի նվազագույն չափը պետք է լինի ${minRaiseAmount}`);
    }
    
    const player = await this.repository.getPlayerById(playerId);
    if(player && betAmount) {
      await this.repository.updatePlayer(
        playerId,
        { 
          amount: player?.amount - betAmount,
          action: PlayerAction.Raise,
          action_amount: +betAmount,
          all_bet_sum: +player.all_bet_sum + +betAmount,
        }
      );
      await this.repository.updateHand(
        hand.id,
        {
          pot_amount: +hand.pot_amount + +betAmount,
          last_raise_amount: betAmount - hand.current_max_bet,
          current_max_bet: betAmount,
        }
      );
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(hand.id);
    
    let currentBetAmount = betAmount || 0;

    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      PlayerAction.Raise,
      currentBetAmount,
    );
    await this.nextPlayer(gameId, hand.id, playerId);
    console.log('************** END RAISE **************');
  }

  async handleReRaiseAction(
    gameId: UUID,
    hand: Hand,
    playerId: UUID,
    betAmount: number,
  ) {
    console.log('************** START RE-RAISE **************');
    const turnPlayerBetAmounts = await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
      hand.id,
      hand.current_player_turn_id,
      hand.current_round
    );
    const mustBeBet = betAmount - turnPlayerBetAmounts;    
    const minRaiseAmount = +hand.current_max_bet + (+hand.current_max_bet > 0 ? +hand.last_raise_amount : +hand.big_blind_amount);
    
    if (betAmount < minRaiseAmount) {
      throw new Error(`Ռե-Ռեյզի նվազագույն չափը պետք է լինի ${minRaiseAmount}`);
    }

    const player = await this.repository.getPlayerById(playerId);
    if(player && betAmount) {
      await this.repository.updatePlayer(
        playerId,
        { 
          amount: player?.amount - mustBeBet,
          action: PlayerAction.ReRaise,
          action_amount: +betAmount,
          all_bet_sum: +player.all_bet_sum + +mustBeBet,
        }
      );
      await this.repository.updateHand(
        hand.id,
        {
          pot_amount: +hand.pot_amount + +mustBeBet,
          last_raise_amount: betAmount,
          current_max_bet: betAmount,
        }
      );
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(hand.id);

    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      PlayerAction.ReRaise,
      mustBeBet,
    );
    await this.nextPlayer(gameId, hand.id, playerId);
    console.log('************** END RE-RAISE **************');
  }

  async handleCallAction(
    gameId: UUID,
    hand: Hand,
    playerId: UUID,
  ) {
    console.log('************** START CALL **************');
    const turnPlayerBetAmounts = await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(
      hand.id,
      hand.current_player_turn_id,
      hand.current_round
    );
    
    const turnPlayer = await this.repository.getPlayerById(hand.current_player_turn_id);
    if (!turnPlayer) {
      throw new Error(`Խաղացողը ${hand.current_player_turn_id} համարով գոյություն չունի`);
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
      await this.repository.updateHandPot(hand.id, +hand.pot_amount + callAmount);
      await this.repository.updatePlayer(
        playerId,
        { 
          amount: player?.amount - callAmount,
          action: action,
          action_amount: callAmount + +turnPlayerBetAmounts,
          all_bet_sum: +player.all_bet_sum + +callAmount,
        }
      );
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(hand.id);

    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      action,
      callAmount,
    );
    await this.nextPlayer(gameId, hand.id, playerId);
    
    console.log('************** END CALL **************');
  }

  async handleFoldAction(
    gameId: UUID,
    hand: Hand,
    playerId: UUID,
  ) {
    console.log('************** START FOLD **************');
    const player = await this.repository.getPlayerById(playerId);
    if (player) {
      await this.repository.updatePlayer(playerId, { action: PlayerAction.Fold, action_amount: 0 });
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(hand.id);
    
    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      PlayerAction.Fold,
      0,
    );
    await this.nextPlayer(gameId, hand.id, playerId);

    console.log('************** END FOLD **************');
  }

  async handleCheckAction(
    gameId: UUID,
    hand: Hand,
    playerId: UUID,
  ) {
    console.log('************** START CHECK **************');

    const { currentBettingRound, actionOrder } = await this.getActionOrders(hand.id);
    
    const player = await this.repository.getPlayerById(playerId);
    if (player) {
      await this.repository.updatePlayer(playerId, { action: PlayerAction.Check, action_amount: 0 });
    }
    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      PlayerAction.Check,
      0,
    );
    await this.nextPlayer(gameId, hand.id, playerId);
    console.log('************** END CHECK **************');
  }

  async handleAllInAction(
    gameId: UUID,
    hand: Hand,
    playerId: UUID,
  ) {
    console.log('************** START ALL IN **************');
    let betAmount = 0;
    const playerAllBet = await this.repository.getActionsBetAmountsByHandIdAndPlayerId(hand.id, playerId);
    console.log('playerAllBet', playerAllBet);
    
    const player = await this.repository.getPlayerById(playerId);
    if (player) {
      betAmount = +player.amount;
      // await this.repository.updateHandPot(hand.id, +hand.pot_amount + betAmount);
      console.log('betAmount', betAmount);
      console.log('playerAllBet', playerAllBet);
      
      await this.repository.updatePlayer(
        playerId,
        { 
          amount: 0,
          action: PlayerAction.AllIn,
          action_amount: +betAmount + +playerAllBet,
          all_bet_sum: +player.all_bet_sum + +betAmount,
        }
      );
      let currentMaxBet = hand.current_max_bet;

      if (currentMaxBet < +player.amount + +playerAllBet) {
        currentMaxBet = +player.amount + +playerAllBet;
      }

      await this.repository.updateHand(
        hand.id,
        {
          pot_amount: +hand.pot_amount + +betAmount,
          last_raise_amount: currentMaxBet,
          current_max_bet: currentMaxBet,
        }
      );
    }

    const { currentBettingRound, actionOrder } = await this.getActionOrders(hand.id);
    
    await this.repository.createAction(
      hand.id,
      playerId,
      hand.current_round,
      currentBettingRound,
      actionOrder,
      PlayerAction.AllIn,
      betAmount,
    );
    await this.nextPlayer(gameId, hand.id, playerId);
    
    console.log('************** END ALL IN **************');
  }

  async getActionOrders(
    handId: UUID
  ): Promise<{
    actionOrder: number,
    currentBettingRound: number
  }> {
    const lastAction = await this.repository.getLastActionForHand(handId);
    const currentBettingRound = lastAction ? +lastAction.betting_round + 1 : 1; // petq e hashvi miayn tvyal round-um
    const actionOrder = lastAction ? +lastAction.action_order + 1 : 1;

    return {
      actionOrder,
      currentBettingRound,
    }
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


  async nextPlayer(
    gameId: UUID,
    handId: UUID,
    playerId: UUID,
  ): Promise<void> {
    console.log('');
    console.log('************** HANDLE NEXT PLAYER **************');
    console.log('');
    
    const hand = await this.repository.getHandById(handId);    
    if (hand) {
      const activePlayers = await this.repository.getPlayers(gameId);
      const foldingPlayerIndex = activePlayers.findIndex(p => p.id === playerId);
      const activeNotFoldedPlayers = activePlayers.filter(p => p.is_active && p.action !== PlayerAction.Fold);
      console.log('************activeNotFoldedPlayers********************', activeNotFoldedPlayers);
      if (activeNotFoldedPlayers.length < 2) {
        await this.repository.updateHand(handId, { current_round: Round.Showdown });
      } else {
        const playerTotalBetInCurrentRound = await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(handId, playerId, hand.current_round);
        const playersCurrentRoundActions = await Promise.all(
          activeNotFoldedPlayers.map(player => {
            return this.repository.getActionsByHandIdAndPlayerIdAndRound(handId, player.id, hand.current_round);
          })
        );
        const allPlayersActedCurrentRound = playersCurrentRoundActions.every(action => action.length > 0);
        const allPlayersActed = activeNotFoldedPlayers.every(player => player.action !== null && player.action !== '');
        
        const playersBetAmounts = await Promise.all(
          activeNotFoldedPlayers.map(player => {
            return this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(handId, player.id, hand.current_round);
          })
        );
        console.log('playersBetAmounts', playersBetAmounts);
        console.log('activeNotFoldedPlayers', activeNotFoldedPlayers);
        
        const allActionAmountsEqual = playersBetAmounts.every((element) => element === playersBetAmounts[0]);
        const allPlayerActionEqual = activeNotFoldedPlayers.every((element) => element.action === activeNotFoldedPlayers[0].action && ![PlayerAction.Raise].includes(element.action));
        console.log('allPlayerActionEqual', allPlayerActionEqual);
        
        let nextActivePlayer = null;
        
        if ((allPlayerActionEqual || allActionAmountsEqual ) && allPlayersActed && allPlayersActedCurrentRound && !hand.is_changed_current_round) {
    
          console.log('All active players have equal action_amount!');
          const isAllPlayerActionAllIn = activeNotFoldedPlayers.every((element) => element.action === PlayerAction.AllIn);
          
          const currentRound = isAllPlayerActionAllIn ? Round.River : hand.current_round;
          const nextRoundMap = {
            [Round.Preflop]: Round.Flop,
            [Round.Flop]: Round.Turn,
            [Round.Turn]: Round.River,
            [Round.River]: Round.Showdown,
            [Round.Showdown]: Round.Showdown,
          };
      
          const nextRound = nextRoundMap[currentRound];
          
          if (nextRound && nextRound !== currentRound) {
            await this.repository.updateActiveNotFoldAndNotAllInPlayersByGameId(
              gameId,
              {
                action: PlayerAction.Active,
                action_amount: 0,
              }
            )
            await this.repository.updateHand(handId, { current_round: nextRound, is_changed_current_round: true });
            console.log(`Moved to next round: ${nextRound}`);
          } else {
            console.log('Already at the last round: Showdown');
          }
        
          
          const activePlayers = await this.repository.getPlayers(gameId);
    
          const bigBlindPlayerIndex = activePlayers.findIndex(p => p.id === hand.dealer);
    
          if (bigBlindPlayerIndex === -1) {
            console.error('Big blind player not found!');
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
          await this.repository.updateHand(handId, { current_player_turn_id: nextActivePlayer.id, is_changed_current_round: false });
        } else {
          console.log('Ձեռքն ավարտվեց, մնաց միայն մեկ ակտիվ խաղացող');
        }
      }
    }
  }


  async handleNextHand(
    gameId: UUID,
    handId: UUID,
    winners: Array<{id: UUID, amount: number}>,
  ): Promise<{
    players: Player[];
    hand: Hand;
    level: number;
    blindTime: number,
    playerActions: ActionsOpportunities,
  }> {
    for (const winner of winners) {
      await this.repository.incrementPlayerAmount(winner.id, winner.amount)
    }
    const hand = await this.createNewHand(gameId, handId);
    if(!hand) {
      throw new Error('Not find hand.');
    }

    const gameBlind = await this.repository.getGameLevelBlind(gameId);
    if (!gameBlind) {
      throw new Error(`Blind configuration not found for the game's current level.`);
    }

    let players = await this.repository.getPlayers(gameId);
    if(!players) {
      throw new Error('Not find players.');
    }
    
    for (const player of players) {
      if(+player.amount === 0) {
        await this.repository.updatePlayer(player.id, { is_active: false});
      }
      if(player.id === hand.big_blind) {
        await this.repository.updatePlayer(player.id, { amount: player.amount - gameBlind.ante});
      }
    }
    await this.repository.updatePlayersByGameId(gameId, { action: PlayerAction.Active,  action_amount: 0})

    
    if (hand.small_blind) {
      await this.performAction(
        gameId,
        hand.id,
        hand.small_blind,
        PlayerAction.Bet,
        gameBlind.small_blind_amount,
      );
    }

    await this.performAction(
      gameId,
      hand.id,
      hand.big_blind,
      PlayerAction.Raise,
      gameBlind.big_blind_amount,
    );

    players = await this.repository.getPlayers(gameId);
    if(!players) {
      throw new Error('Not find players.');
    }
    const game = await this.repository.getGame(gameId);
    if(!game) {
      throw new Error('Not find game.');
    }

    const playerActions = await this.getPlayerActionsOpportunities(gameId, hand.id);
    const updatedHand = await this.repository.getHandById(hand.id);
    if(!updatedHand) {
      throw new Error('Not find hand.');
    }

    return {
      players,
      hand: updatedHand,
      level: game.level,
      blindTime: game.blind_time,
      playerActions,
    }
  }

  async createNewHand(
    gameId: UUID,
    lastHandId: UUID
  ): Promise<Hand | null> {
    console.log('=========== CREATE NEW HAND ============');

    const lastHand = await this.repository.getHandById(lastHandId);
    if(!lastHand) {
      throw new Error('Not find hand.');
    }
    const players = await this.repository.getPlayers(gameId);
    const activePlayers = players.filter(p => p.is_active);
    if (activePlayers.length < 2) {
      throw new Error('Not enough active players to start a hand.');
      // END GAME
    }

    const currentDealerIndex = players.findIndex(p => p.id === lastHand.dealer);

    let nextDealerId: UUID | undefined;;
    for (let i = 1; i <= players.length; i++) {
      const nextIndex = (currentDealerIndex + i) % players.length;
      if (players[nextIndex].is_active) {
        nextDealerId = players[nextIndex].id;
        break;
      }
    }
    if (!nextDealerId) throw new Error('Could not find next dealer.');
    
    const gameBlind = await this.repository.getGameLevelBlind(gameId);
    if (!gameBlind) {
      throw new Error(`Blind configuration not found for the game's current level.`);
    }

    let smallBlindId = null;
    for (let i = 1; i <= players.length; i++) {
      const index = (players.findIndex(p => p.id === nextDealerId) + i) % players.length;
      if (players[index].is_active) {
        smallBlindId = players[index].id;
        break;
      } else {
        break;
      }
    }
    
    let bigBlindId: UUID | undefined;
    for (let i = 1; i <= players.length; i++) {
      const index = (players.findIndex(p => p.id === nextDealerId)+ 1 + i) % players.length;
      if (players[index].is_active) {
        bigBlindId = players[index].id;
        break;
      }
    }
    if (!bigBlindId) throw new Error('Could not find big blind.');

    let currentPlayerTurnId: UUID | undefined;
    for (let i = 1; i <= players.length; i++) {
      const index = (players.findIndex(p => p.id === bigBlindId) + i) % players.length;
      if (players[index].is_active) {
        currentPlayerTurnId = players[index].id;
        break;
      }
    }
    if (!currentPlayerTurnId) throw new Error('Could not find player to act.');

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
}
