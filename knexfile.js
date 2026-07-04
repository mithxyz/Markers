import { config } from './server/config.js';

/** @type {import('knex').Knex.Config} */
const knexConfig = {
  client: 'pg',
  connection: {
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
  },
  pool: { min: 2, max: 10 },
  migrations: {
    directory: './server/db/migrations',
    extension: 'js',
  },
};

export default knexConfig;
