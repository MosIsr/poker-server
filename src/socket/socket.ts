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



    socket.on('start-game', async ({ blindTime, smallBlind }: { blindTime:number, smallBlind: number }) => {
      try {
        console.log('blindTime, smallBlind', blindTime, smallBlind);
        
        const response = await gameService.startGame(blindTime, smallBlind);
        socket.emit("game-data", response);
      } catch (error) {
        console.error('Error starting game:', error);
        socket.emit('game-error', { message: error instanceof DomainError ? error.message : 'Failed to start game' });
      }
    });

    socket.on('player-action', async (data) => {
      console.log('player-action:', data);
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
        // After a player action, we need to send updated game state to all connected clients
        const updatedPlayers = await gameService.getPlayersInGame(gameId); // Assuming you have this method
        const updatedHand = await gameService.getHandById(handId); // Assuming you have this method
        io.emit('game-update', { players: updatedPlayers, hand: updatedHand }); // Broadcast to all clients
      } catch (error) {
        console.error('Error performing action:', error);
        socket.emit('action-error', { message: error instanceof DomainError ? error.message : 'Failed to perform action' });
      }
    });

  });
}
