// Runs the suite against an already-running server, e.g. the Cloudflare
// version: HUNT_URL=http://127.0.0.1:8787 npm test
import { test } from 'node:test';
import { raceSuite } from './suite.js';
import { remoteHost } from './hosts.js';

const url = process.env.HUNT_URL;
if (url) raceSuite('remote', remoteHost(url.replace(/\/$/, '')));
else test('remote server suite (set HUNT_URL to run)', { skip: true }, () => {});
