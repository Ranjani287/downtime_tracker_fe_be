import { DataTypes } from 'sequelize';
import { sequelize } from '../db.js';

export const ProductionLine = sequelize.define('ProductionLine', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  tenant_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.TEXT, allowNull: false },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: 'production_lines' });
