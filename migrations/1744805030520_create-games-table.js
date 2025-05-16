/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void>}
 */
exports.up = async (pgm) => {
  await pgm.createTable('games', {
    id: { 
      type: 'uuid', 
      primaryKey: true
    },
    blind_time: {
      type: 'numeric',
      notNull: false,
    },
    level: {
      type: 'numeric',
      notNull: false,
      default: 1,
    },
    chips: {
      type: 'numeric',
      notNull: false,
      default: 0,
    },
    start_time: {
      type: 'TIMESTAMP',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    end_time: {
      type: 'TIMESTAMP',
    },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void>}
 */
exports.down = async (pgm) => {
  await pgm.dropTable('games');
};
