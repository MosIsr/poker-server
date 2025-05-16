/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void>}
 */
exports.up = async (pgm) => { 
  await pgm.createTable('hands', {
    id: {
      type: 'uuid',
      primaryKey: true,
    },
    game_id: {
      type: 'uuid',
      notNull: true,
      references: 'games (id)',
      onDelete: 'CASCADE',
    },
    level: {
      type: 'numeric',
      notNull: true,
      default: 1,
    },
    dealer: {
      type: 'uuid',
      references: 'players (id)',
      notNull: true,
    },
    small_blind: {
      type: 'uuid',
      references: 'players (id)',
      notNull: false,
    },
    big_blind: {
      type: 'uuid',
      references: 'players (id)',
      notNull: true,
    },
    pot_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    ante: {
      type: 'numeric',
      notNull: true,
      default: 0,
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
    last_call_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    current_max_bet: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    last_raise_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    current_round: {
      type: 'text',
    },
    is_changed_current_round: {
      type: 'boolean',
      default: false
    },
    current_player_turn_id: {
      type: 'uuid',
      references: 'players (id)',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  await pgm.addConstraint('hands', 'unique_roles_per_hand', {
    check: `dealer <> small_blind AND dealer <> big_blind AND small_blind <> big_blind`,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void>}
 */
exports.down = (pgm) => {
  pgm.dropTable('hands');
};
