import { DataTypes } from 'sequelize';
import { sequelize } from '../db.js';

// Only the SHA-256 hash of the token is stored. family_id ties together every token issued from one login.
export const RefreshToken = sequelize.define('RefreshToken', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  family_id: { type: DataTypes.UUID, allowNull: false },
  token_hash: { type: DataTypes.TEXT, allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  revoked_at: { type: DataTypes.DATE, allowNull: true },
  replaced_by: { type: DataTypes.UUID, allowNull: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: 'refresh_tokens' });
