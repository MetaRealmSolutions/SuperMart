import { define, z } from '../api';
import { resetDemo } from '../seed';

define('system.resetDemo', {
  module: 'core',
  perm: 'demo.reset',
  input: z.object({ edition: z.enum(['basic', 'inventory', 'full']).default('full'), confirm: z.literal('RESET') }),
  handler: (ctx, i) => {
    resetDemo(ctx.app, { edition: i.edition });
    return { ok: true, edition: i.edition };
  },
});
