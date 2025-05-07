// db.ts-ի ձեր կոդը
import { Pool } from 'pg';
require('dotenv').config(); // Սա տեղական միջավայրի համար է

const isSSL = process.env.DATABASE_URL?.includes('heroku') || process.env.DATABASE_URL?.includes('amazonaws');

const poolConfig: any = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
};

if (isSSL) {
  poolConfig.ssl = {
    rejectUnauthorized: false, // Արտադրական միջավայրում ավելի լավ է օգտագործել Heroku-ի SSL վկայականը
  };
}

const pool = new Pool(poolConfig);
export default pool;