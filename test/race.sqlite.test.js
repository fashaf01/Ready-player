import { raceSuite } from './suite.js';

raceSuite('sqlite', { setup: async () => ({ sqliteFile: ':memory:' }) });
