import "reflect-metadata";
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { InversifyExpressServer } from 'inversify-express-utils';
import errorHandlerMiddleware from './middlewares/error-handler.middleware';
import container from './di/inversify.config';
import { setupSocketIO } from './socket/socket';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

const server = new InversifyExpressServer(container);
server
  .setConfig((app) => {
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cors({
      origin: [
        "https://poker-admin-1.onrender.com",
        "http://localhost:3000" // For local development
      ],
      credentials: true
    }));
    app.disable('etag');
    app.use((req: Request, res: Response, next: NextFunction) => {
      // @ts-expect-error Fix later
      req.container = container;
      next();
    });
  })
  .setErrorConfig((app) => {
    app.use(errorHandlerMiddleware);
  });

const app = server.build();
const port = process.env.PORT || 3001; // Default port fallback

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      "https://poker-admin-1.onrender.com",
      "http://localhost:3000"
    ],
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'] // Explicit transports for Render
});

setupSocketIO(io);

// Start the server
httpServer.listen(port, () => {
  console.log(`App is running on port ${port}`);
});
