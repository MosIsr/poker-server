import { Server } from 'socket.io';
import container from "../di/inversify.config";
import { TYPES } from "../di/types";
import IGameService from "../services/interfaces/IGameService";
import DomainError from '../errors/domain.error';

export function setupSocketIO(io: Server) {
  const gameService = container.get<IGameService>(TYPES.GameService);
  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id);
    });

    socket.on('ping-server', (data) => {
      console.log('Received ping:', data);
      socket.emit('pong-client', { message: 'pong from server' });
    });



    socket.on('start-game', async ({ blindTime, playersChips }: { blindTime:number, playersChips: number }) => {
      try {
        const response = await gameService.startGame(blindTime, playersChips);
        socket.emit("game-data", response);
      } catch (error) {
        console.error('Error starting game:', error);
        socket.emit('game-error', { message: error instanceof DomainError ? error.message : 'Failed to start game' });
      }
    });

    socket.on('player-action', async (data) => {
      const {
        gameId,
        handId,
        playerId,
        actionType,
        betAmount,
      } = data;
      if (!handId || !playerId || !actionType) {
        socket.emit('action-error', { message: 'handId, playerId, and actionType are required' });
        return;
      }
      try {
        await gameService.performAction(
          gameId,
          handId,
          playerId,
          actionType,
          betAmount,
        );
        const updatedPlayers = await gameService.getPlayersInGame(gameId);
        const updatedHand = await gameService.getGameLastHandByGameId(gameId);
        const playerActions = await gameService.getPlayerActionsOpportunities(gameId, handId);
        
        socket.emit('game-update', { 
          players: updatedPlayers, 
          hand: updatedHand,
          playerActions,
        });
      } catch (error) {
        console.error('Error performing action:', error);
        socket.emit('action-error', { message: error instanceof DomainError ? error.message : 'Failed to perform action' });
      }
    });

    socket.on('next-hand', async (data) => {
      const response = await gameService.handleNextHand(
        data.gameId,
        data.handId,
        data.winners,
      );
      socket.emit('game-data', response);
    })
  });
}
