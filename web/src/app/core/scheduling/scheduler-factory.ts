import type { DeckOptions } from '../models';
import { FsrsScheduler } from './fsrs';
import { Sm2Scheduler } from './sm2';
import type { Scheduler } from './types';

const sm2 = new Sm2Scheduler();
const fsrs = new FsrsScheduler();

/** Returns the scheduler strategy selected by the deck options. */
export class SchedulerFactory {
  static for(opts: DeckOptions): Scheduler {
    switch (opts.scheduler) {
      case 'fsrs':
        return fsrs;
      case 'sm2':
      default:
        return sm2;
    }
  }
}
