/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable('game_blinds', {
    id: {
      type: 'uuid',
      primaryKey: true,
    },
    game_level: {
      type: 'numeric',
      notNull: true,
      default: 1,
    },
    small_blind_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    big_blind_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    ante: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    }
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTable('game_blinds');
};
