import { z, type ZodType } from 'zod';
import type { ModuleId } from '../shared/modules';
import type { Permission } from '../shared/permissions';
import type { Ctx } from './ctx';
import { AppError } from './errors';

/**
 * Every business operation is a registered method. The dispatcher — not the UI — enforces
 * authentication, module entitlements, role permissions and input validation.
 */
export interface MethodDef<I = any, O = any> {
  module: ModuleId;
  /** Permission(s) required (all of them). Omit only for public methods. */
  perm?: Permission | Permission[];
  public?: boolean;
  input?: ZodType<I>;
  handler: (ctx: Ctx, input: I) => O;
}

const registry = new Map<string, MethodDef>();

export function define<I, O>(name: string, def: MethodDef<I, O>): void {
  if (registry.has(name)) throw new Error(`Duplicate API method ${name}`);
  if (!def.public && !def.perm) throw new Error(`API method ${name} must declare a permission`);
  registry.set(name, def);
}

export function listMethods(): string[] {
  return [...registry.keys()];
}

export function methodInfo(name: string): MethodDef | undefined {
  return registry.get(name);
}

export function dispatch(ctx: Ctx, name: string, rawInput: unknown): unknown {
  const def = registry.get(name);
  if (!def) throw new AppError('NOT_FOUND', `Unknown method ${name}`);
  if (!def.public) {
    if (!ctx.user) throw new AppError('UNAUTHENTICATED', 'Sign in required.');
    ctx.requireModule(def.module);
    for (const p of Array.isArray(def.perm) ? def.perm : [def.perm!]) ctx.require(p);
  } else {
    ctx.requireModule(def.module);
  }
  let input: unknown = rawInput;
  if (def.input) {
    const parsed = def.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
        parsed.error.issues,
      );
    }
    input = parsed.data;
  }
  return def.handler(ctx, input);
}

export { z };
