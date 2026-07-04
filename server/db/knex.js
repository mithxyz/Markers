import knexLib from 'knex';
import knexConfig from '../../knexfile.js';

export const knex = knexLib(knexConfig);
export default knex;
