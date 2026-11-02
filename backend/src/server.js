import { app } from './app.js';
import { config, databaseHost } from './config.js';

app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port} (database host: ${databaseHost || 'local socket'})`));
