/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void>}
 */
exports.up = async (pgm) => {
  await pgm.createTable('actions', {
    id: {
      type: 'uuid',
      primaryKey: true,
    },
    hand_id: {
      type: 'uuid',
      notNull: true,
      references: 'hands (id)',
      onDelete: 'CASCADE',
    },
    player_id: {
      type: 'uuid',
      notNull: true,
      references: 'players (id)',
      onDelete: 'CASCADE',
    },
    round: {
      type: 'text',
      notNull: true,
    },
    betting_round: {
      type: 'numeric',
      notNull: true,
    },
    action_order: {
      type: 'numeric',
      notNull: true,
    },
    action_order_current_loop: {
      type: 'numeric',
      notNull: true,
    },
    action_type: {
      type: 'text',
    },
    bet_amount: {
      type: 'numeric',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void>}
 */
exports.down = (pgm) => {
  pgm.dropTable('actions');
};
