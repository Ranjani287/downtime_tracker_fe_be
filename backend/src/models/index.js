import { Tenant } from './Tenant.js';
import { User, ROLES } from './User.js';
import { ProductionLine } from './ProductionLine.js';
import { Machine } from './Machine.js';
import { DowntimeReason } from './DowntimeReason.js';
import { DowntimeEvent } from './DowntimeEvent.js';
import { RefreshToken } from './RefreshToken.js';
import { RevokedToken } from './RevokedToken.js';

// Associations only describe how rows relate so queries can `include` them. The actual foreign keys
// (including the composite (tenant_id, id) ones that stop cross-tenant references) live in the SQL migrations.
Tenant.hasMany(User, { as: 'users', foreignKey: 'tenant_id' });
User.belongsTo(Tenant, { as: 'tenant', foreignKey: 'tenant_id' });

ProductionLine.hasMany(Machine, { as: 'machines', foreignKey: 'line_id' });
Machine.belongsTo(ProductionLine, { as: 'line', foreignKey: 'line_id' });

DowntimeEvent.belongsTo(Machine, { as: 'machine', foreignKey: 'machine_id' });
DowntimeEvent.belongsTo(DowntimeReason, { as: 'reason', foreignKey: 'reason_id' });
DowntimeEvent.belongsTo(User, { as: 'creator', foreignKey: 'created_by' });
// A machine's currently-open events (at most one): the association scope adds `ended_at IS NULL`.
Machine.hasMany(DowntimeEvent, { as: 'openEvents', foreignKey: 'machine_id', scope: { ended_at: null } });

User.hasMany(RefreshToken, { as: 'refreshTokens', foreignKey: 'user_id' });
RefreshToken.belongsTo(User, { as: 'user', foreignKey: 'user_id' });

export { Tenant, User, ROLES, ProductionLine, Machine, DowntimeReason, DowntimeEvent, RefreshToken, RevokedToken };
