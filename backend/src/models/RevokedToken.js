import { DataTypes } from 'sequelize';
import { sequelize } from '../db.js';

// Access tokens revoked by logout, kept until they would have expired anyway.
export const RevokedToken = sequelize.define('RevokedToken', {
  jti: { type: DataTypes.UUID, primaryKey: true },
  expires_at: { type: DataTypes.DATE, allowNull: false },
}, { tableName: 'revoked_tokens' });
