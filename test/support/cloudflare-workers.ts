/** Minimal unit-test stand-in for the runtime-provided WorkerEntrypoint base class. */
export class WorkerEntrypoint<Env> {
  protected readonly ctx: ExecutionContext;
  protected readonly env: Env;

  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
