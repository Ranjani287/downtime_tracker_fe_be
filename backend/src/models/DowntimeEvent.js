import { DataTypes } from 'sequelize';
import { sequelize } from '../db.js';

export const DowntimeEvent = sequelize.define('DowntimeEvent', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  tenant_id: { type: DataTypes.INTEGER, allowNull: false },
  machine_id: { type: DataTypes.INTEGER, allowNull: false },
  reason_id: { type: DataTypes.INTEGER, allowNull: false },
  started_at: { type: DataTypes.DATE, allowNull: false },
  ended_at: { type: DataTypes.DATE, allowNull: true }, // NULL while the event is open
  note: { type: DataTypes.TEXT, allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: false },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },

  // Derived, not stored: open events count up to now.
  duration_minutes: {
    type: DataTypes.VIRTUAL,
    get() {
      const end = this.getDataValue('ended_at') ?? new Date();
      return Math.round(((end - this.getDataValue('started_at')) / 60000) * 10) / 10;
    },
  },
}, { tableName: 'downtime_events' });
