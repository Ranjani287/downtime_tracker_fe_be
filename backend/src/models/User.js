import { DataTypes } from 'sequelize';
import { sequelize } from '../db.js';

export const ROLES = ['super_admin', 'admin', 'operator'];

export const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  tenant_id: { type: DataTypes.INTEGER, allowNull: true }, // NULL only for the platform super admin
  email: { type: DataTypes.TEXT, allowNull: false },
  name: { type: DataTypes.TEXT, allowNull: false },
  password_hash: { type: DataTypes.TEXT, allowNull: false },
  role: { type: DataTypes.TEXT, allowNull: false },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'users',
  // The password hash never leaves the database unless a query explicitly opts in with User.unscoped().
  defaultScope: { attributes: { exclude: ['password_hash'] } },
});
