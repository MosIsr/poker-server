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


@injectable()
export default class GameService implements IGameService {
  constructor(
    @inject(TYPES.Repository) private repository: IRepository,
  ) {}

  async startGame(
    blindTime:number,
    smallBlindAmount: number
  ): Promise<{ players: Player[]; hand: Hand; level: number; blindTime: number }> {

    try {
      const game = await this.repository.createGame(blindTime, DateTime.now());
      
      for (const [index, player] of Players.entries()) {
      
        let actionAmount = player.actionAmount;
        let amount = player.amount;
      
        if (index === 1) {
          actionAmount = smallBlindAmount;
          amount = player.amount - smallBlindAmount;
        } else if (index === 2) {
          actionAmount = smallBlindAmount * 2;
          amount = player.amount - 4 * smallBlindAmount;
        }
      
        await this.repository.createPlayer(
          game.id,
          player.name,
          amount,
          player.isOnline,
          player.isActive,
          player.action,
          actionAmount,
        );
      }

      const players = await this.repository.getPlayers(game.id);      
      const bigBlindAmount = smallBlindAmount * 2;
      const potAmount = +smallBlindAmount + +bigBlindAmount;
      const handLevel = 1;

      const hand = await this.repository.createHand(
        game.id,
        handLevel,
        players[0].id,
        players[1].id,
        players[2].id,
        potAmount,
        smallBlindAmount,
        bigBlindAmount,
        bigBlindAmount,
        bigBlindAmount,
        bigBlindAmount,
        Round.Preflop,
        false,
        players[3].id,
      );
          
      return {
        players,
        hand,
        level: handLevel,
        blindTime,
      }
    } catch (error) {
      console.log('Start Game error: ', error);
      throw new DomainError('Start Game error');
    }
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

    const currentRound = hand.current_round || 'Preflop';
    const lastAction = await this.repository.getLastActionForHand(handId);
    const currentBettingRound = lastAction ? +lastAction.betting_round + 1 : 1;
    const actionOrder = lastAction ? +lastAction.action_order + 1 : 1;
    let currentBetAmount = betAmount || 0;
    // Ռեյզի ստուգում
    if (actionType === PlayerAction.Raise && betAmount !== undefined) {
      console.log('************** START RAISE **************');
      
      const minRaiseAmount = +hand.current_max_bet + (+hand.current_max_bet > 0 ? +hand.last_raise_amount : +hand.big_blind_amount);
      if (betAmount < minRaiseAmount) {
        throw new Error(`Ռեյզի նվազագույն չափը պետք է լինի ${minRaiseAmount}`);
      }
      await Promise.all([
        this.repository.updateHandLastRaiseAmount(handId, betAmount - hand.current_max_bet),
        this.repository.updateHandCurrentMaxBet(handId, betAmount),
        this.repository.updateHandPot(handId, +hand.pot_amount + +betAmount)
      ])
      const player = await this.repository.getPlayerById(playerId);
      if(player && betAmount) {
        await this.repository.updatePlayer(
          playerId,
          { 
            amount: player?.amount - betAmount,
            action: PlayerAction.Raise,
            action_amount: +betAmount,
          }
        );
        await this.repository.updateHand(
          handId,
          {
            last_raise_amount: betAmount,
            current_max_bet: betAmount,
          }
        );
      }

      await this.repository.createAction(
        handId,
        playerId,
        currentRound,
        currentBettingRound,
        actionOrder,
        actionType,
        currentBetAmount,
      );
      await this.nextPlayer(gameId, handId, playerId, actionType);
      console.log('************** END RAISE **************');
    } else if (actionType === 'Bet' && betAmount !== undefined) {
      console.log('************** START BET **************');
      await this.repository.updateHandCurrentMaxBet(handId, betAmount);
      await this.repository.updateHandLastRaiseAmount(handId, betAmount);
      await this.repository.updateHandPot(handId, +hand.pot_amount + +betAmount);

      await this.repository.createAction(
        handId,
        playerId,
        currentRound,
        currentBettingRound,
        actionOrder,
        actionType,
        currentBetAmount,
      );
      await this.nextPlayer(gameId, handId, playerId, actionType);

      console.log('************** END BET **************');
    } else if (actionType === PlayerAction.Call && betAmount !== undefined) {
      console.log('************** START CALL **************');
      const playerTotalBetInCurrentRound = await this.repository.getActionsBetAmountsByHandIdAndPlayerIdAndRound(handId, playerId, hand.current_round);
      
      if (playerTotalBetInCurrentRound !== 0) {
        currentBetAmount = +hand.current_max_bet - +playerTotalBetInCurrentRound
      }
      await this.repository.updateHandPot(handId, +hand.pot_amount + currentBetAmount);
      const player = await this.repository.getPlayerById(playerId);
      if (player) {
        await this.repository.updatePlayer(
          playerId,
          { 
            amount: player?.amount - currentBetAmount,
            action: PlayerAction.Call,
            action_amount: + currentBetAmount,
          }
        );
      }
      await this.repository.createAction(
        handId,
        playerId,
        currentRound,
        currentBettingRound,
        actionOrder,
        actionType,
        currentBetAmount,
      );
      await this.nextPlayer(gameId, handId, playerId, actionType);
      
      console.log('************** END CALL **************');
    } else if (actionType === PlayerAction.Fold) {
      console.log('************** START FOLD **************');
      const player = await this.repository.getPlayerById(playerId);
      if (player) {
        await this.repository.updatePlayer(playerId, { action: PlayerAction.Fold });
      }
      await this.repository.createAction(
        handId,
        playerId,
        currentRound,
        currentBettingRound,
        actionOrder,
        actionType,
        currentBetAmount,
      );
      await this.nextPlayer(gameId, handId, playerId, actionType);

      console.log('************** END FOLD **************');
    } else if (actionType === PlayerAction.Check) {
      console.log('************** START CHECK **************');
      const UPDATED_PLAYER = await this.repository.updatePlayer(playerId, { action: PlayerAction.Check });
      await this.repository.createAction(
        handId,
        playerId,
        currentRound,
        currentBettingRound,
        actionOrder,
        actionType,
        currentBetAmount,
      );
      await this.nextPlayer(gameId, handId, playerId, actionType);
      // Այստեղ կարող եք ավելացնել ստուգումներ, թե արդյոք խաղացողը իրավունք ունի check անել
      console.log('************** END CHECK **************');
    }

    

    console.log('========================================');
    console.log('');
    console.log('');
    console.log('');
    console.log('');
    
    // Ավելացնել տրամաբանություն փուլի ավարտի և հաջորդ փուլին անցնելու համար




  }

  async getPlayersInGame(gameId: UUID): Promise<Player[]> {
    return this.repository.getPlayers(gameId);
  }

  async getHandById(handId: UUID): Promise<Hand | null> {
    return await this.repository.getHandById(handId);
  }


  async nextPlayer(
    gameId: UUID,
    handId: UUID,
    playerId: UUID,
    actionType: string,
  ): Promise<void> {
    console.log('');
    console.log('************** HANDLE NEXT PLAYER **************');
    console.log('');
    
    const hand = await this.repository.getHandById(handId);    
    if (hand) {
      const activePlayers = await this.repository.getPlayers(gameId);
      const foldingPlayerIndex = activePlayers.findIndex(p => p.id === playerId);
      const activeNotFoldedPlayers = activePlayers.filter(p => p.is_active && p.action !== PlayerAction.Fold);
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
      const allActionAmountsEqual = playersBetAmounts.every((element) => element === playersBetAmounts[0]);
      const allPlayerActionEqual = activeNotFoldedPlayers.every((element) => element.action === activeNotFoldedPlayers[0].action);

      let nextActivePlayer = null;

      console.log('---------------------------------');
      console.log('');
      console.log('allPlayerActionEqual', allPlayerActionEqual);
      console.log('allActionAmountsEqual', allActionAmountsEqual);
      console.log('allPlayersActed', allPlayersActed);
      console.log('allPlayersActedCurrentRound', allPlayersActedCurrentRound);
      console.log('!hand.is_changed_current_round', !hand.is_changed_current_round);
      console.log('');
      console.log('---------------------------------');
      
      
      if ((allPlayerActionEqual || allActionAmountsEqual) && allPlayersActed && allPlayersActedCurrentRound && !hand.is_changed_current_round) {
  
        console.log('All active players have equal action_amount!');
        
        const currentRound = hand.current_round;
        const nextRoundMap = {
          [Round.Preflop]: Round.Flop,
          [Round.Flop]: Round.Turn,
          [Round.Turn]: Round.River,
          [Round.River]: Round.Showdown,
          [Round.Showdown]: Round.Showdown,
        };
    
        const nextRound = nextRoundMap[currentRound];
        console.log('nextRound', nextRound);
        
        if (nextRound && nextRound !== currentRound) {
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


  async nextPlayer3(
    gameId: UUID,
    handId: UUID,
    playerId: UUID,
    actionType: string,
  ): Promise<void> {
    console.log('************** HANDLE NEXT PLAYER **************');
    const hand = await this.repository.getHandById(handId);

    if (hand) {
      const activePlayers = await this.repository.getActiveNotFoldPlayers(gameId);
      const activeNotFoldedPlayers = activePlayers.filter(p => p.is_active && p.action !== PlayerAction.Fold);

      // Ստուգում ենք՝ արդյոք բոլոր ակտիվ խաղացողները գործել են իրենց հերթին և արել են հավասար խաղադրույքներ
      const allBettingFinished = activeNotFoldedPlayers.every(player => {
        // Առաջին խաղացողը փուլում միշտ պետք է բեթ կամ ռեյզ անի
        if (activeNotFoldedPlayers.indexOf(player) === 0 && hand.current_max_bet === 0) {
          return false;
        }
        return +player.action_amount >= +hand.current_max_bet || player.id === hand.current_player_turn_id;
      });

      const allChecked = activeNotFoldedPlayers.every(player => player.action === PlayerAction.Check);

      // Եթե բոլորը հավասարաչափ են բեթ արել կամ բոլորը չեք են արել (եթե current_max_bet-ը 0 է), անցնում ենք հաջորդ փուլ
      if ((allBettingFinished && hand.current_max_bet > 0) || (allChecked && hand.current_max_bet === 0 && hand.current_round !== Round.Preflop)) {
        console.log('Բոլորը գործել են, անցնում ենք հաջորդ փուլ');
        const currentRound = hand.current_round;
        const nextRoundMap = {
          [Round.Preflop]: Round.Flop,
          [Round.Flop]: Round.Turn,
          [Round.Turn]: Round.River,
          [Round.River]: Round.Showdown,
          [Round.Showdown]: Round.Showdown,
        };

        const nextRound = nextRoundMap[currentRound];

        if (nextRound && nextRound !== currentRound) {
          await this.repository.updateHand(handId, { current_round: nextRound, current_max_bet: 0, last_raise_amount: 0, is_changed_current_round: true });
          console.log(`Moved to next round: ${nextRound}`);

          let nextPlayerForNewRound = null;
          if (nextRound !== Round.Preflop) {
            // Բոլոր հաջորդ փուլերում առաջինը գործում է դիլերից հետո նստած ակտիվ խաղացողը
            const dealerPlayerIndex = activePlayers.findIndex(p => p.id === hand.dealer);
            let nextPlayerIndex = (dealerPlayerIndex + 1) % activePlayers.length;
            let attempts = 0;
            while (!nextPlayerForNewRound && attempts < activePlayers.length) {
              if (activePlayers[nextPlayerIndex].is_active && activePlayers[nextPlayerIndex].action !== PlayerAction.Fold) {
                nextPlayerForNewRound = activePlayers[nextPlayerIndex];
                break;
              }
              nextPlayerIndex = (nextPlayerIndex + 1) % activePlayers.length;
              attempts++;
            }
          } else {
            // Պրեֆլոպում առաջինը գործում է մեծ բլայնդից հետո նստած խաղացողը (UTG)
            const bigBlindPlayerIndex = activePlayers.findIndex(p => p.id === hand.big_blind);
            let nextPlayerIndex = (bigBlindPlayerIndex + 1) % activePlayers.length;
            let attempts = 0;
            while (!nextPlayerForNewRound && attempts < activePlayers.length) {
              if (activePlayers[nextPlayerIndex].is_active && activePlayers[nextPlayerIndex].action !== PlayerAction.Fold) {
                nextPlayerForNewRound = activePlayers[nextPlayerIndex];
                break;
              }
              nextPlayerIndex = (nextPlayerIndex + 1) % activePlayers.length;
              attempts++;
            }
          }

          if (nextPlayerForNewRound) {
            await this.repository.updateHand(handId, { current_player_turn_id: nextPlayerForNewRound.id });
          }
        } else {
          console.log('Already at the last round: Showdown');
          // Showdown logic here
        }
        return; // Եթե անցել ենք հաջորդ փուլ, դուրս ենք գալիս ֆունկցիայից
      }

      // Եթե դեռ խաղադրույքների փուլում ենք, գտնում ենք հաջորդ ակտիվ խաղացողին
      const currentPlayerIndex = activePlayers.findIndex(p => p.id === hand.current_player_turn_id);
      let nextIndex = (currentPlayerIndex + 1) % activePlayers.length;
      let attempts = 0;
      let nextActivePlayer = null;

      while (!nextActivePlayer && attempts < activePlayers.length) {
        const player = activePlayers[nextIndex];
        if (player.is_active && player.action !== PlayerAction.Fold && player.id !== hand.current_player_turn_id) {
          nextActivePlayer = player;
          break;
        }
        nextIndex = (nextIndex + 1) % activePlayers.length;
        attempts++;
      }

      if (nextActivePlayer) {
        await this.repository.updateHand(handId, { current_player_turn_id: nextActivePlayer.id, is_changed_current_round: false });
      } else {
        // Եթե այլ ակտիվ խաղացող չկա (ինչը տարօրինակ է այս պայմանում), հնարավոր է ձեռքի ավարտ
        console.log('Ակտիվ խաղացող չի գտնվել');
        // Հնարավոր է ձեռքի ավարտի տրամաբանություն
      }
    }
  }

  async createNewHand() {
    

    // return {
    //   players,
    //   hand,
    // }
  }
}
