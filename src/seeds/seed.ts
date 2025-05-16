import pool from "../config/db";
import { randomUUID, UUID } from "crypto";
import { DateTime } from "luxon";
import dotenv from "dotenv";
import Repository from "../repositories/repository";
import container from "../di/inversify.config";
import { TYPES } from "../di/types";
import IGameService from "../services/interfaces/IGameService";
import GameBlind from "src/models/game-blinds";


dotenv.config();

const gameService = container.get<IGameService>(TYPES.GameService);
const repository = new Repository(pool);




const seedGamesBlinds = async () => {
  const blinds: Array<GameBlind> = [
    {
      id: randomUUID(),
      game_level: 1,
      small_blind_amount: 50,
      big_blind_amount: 100,
      ante: 100,
    },
    {
      id: randomUUID(),
      game_level: 2,
      small_blind_amount: 100,
      big_blind_amount: 300,
      ante: 300,
    },
    {
      id: randomUUID(),
      game_level: 3,
      small_blind_amount: 200,
      big_blind_amount: 500,
      ante: 500,
    },
  ];

  for (const blind of blinds) {
    await pool.query(
      `INSERT INTO game_blinds (id, game_level, small_blind_amount, big_blind_amount, ante)
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (id) DO NOTHING;`,
      [
        blind.id,
        blind.game_level,
        blind.small_blind_amount,
        blind.big_blind_amount,
        blind.ante,
      ]
    );
    console.log("✅ Boost block seeded:", blind.id);
  }
}


// Main Seeding Function
const seedDatabase = async () => {
  try {
    console.log("🌱 Starting database seeding...");
    
    await seedGamesBlinds();

    console.log("🎉 Seeding completed successfully!");
  } catch (error:any) {
    console.error("❌ Error seeding database:", error, error?.message);
  } finally {
    await pool.end();
    console.log("🔌 Database connection closed.");
  }
};


// Run the seeding script
seedDatabase();

