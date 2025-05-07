require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL || `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
console.log('DATABASE_URL', DATABASE_URL);

module.exports = {
  databaseUrl: DATABASE_URL,
  migrationsTable: 'migrations',
};
