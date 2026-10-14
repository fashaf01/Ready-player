import { raceSuite } from './suite.js';
import { localHost } from './hosts.js';

raceSuite('sqlite', localHost(async () => ({ sqliteFile: ':memory:' })));
