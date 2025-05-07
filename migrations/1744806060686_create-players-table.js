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
  pgm.createTable('players', {
    id: { 
      type: 'uuid', 
      primaryKey: true
    },
    game_id: {
      type: 'uuid',
      notNull: true,
      references: 'games (id)',
      onDelete: 'CASCADE',
    },
    name: {
      type: 'text',
      notNull: true,
    },
    amount: {
      type: 'numeric',
      notNull: true, 
      default: 0,
    },
    is_online: {
      type: 'boolean',
      notNull: true, 
      default: false,
    },
    is_active: {
      type: 'boolean',
      notNull: true, 
      default: true,
    },
    action: {
      type: 'text',
      notNull: true,
      default: '',
      check: "action IN ('', 'fold', 'call', 'check', 'raise', 'all-in')"
    },
    action_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTable('players');
};
