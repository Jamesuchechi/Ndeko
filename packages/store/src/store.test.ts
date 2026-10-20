import { MemoryEventStore } from './memory';
import { runEventStoreContract } from './contract';

runEventStoreContract('memory', () => new MemoryEventStore());
