import system from 'system';

import {Application} from './application.js';

const status = await new Application().runAsync([system.programInvocationName, ...system.programArgs]);
system.exit(status);
