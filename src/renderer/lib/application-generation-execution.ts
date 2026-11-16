type Stage = 'upload' | 'submit';
type Check = (stage: Stage, providerBinding?: string) => unknown | Promise<unknown>;
type ApprovedParameters = {kind:string;model:string;resolution?:string;duration?:number;aspectRatio?:string;mode?:string;generateAudio?:boolean;watermark?:boolean};
const failure = (code: string) => Object.assign(new Error(code), { code });

/** Volatile, root-created execution fence, never a public request/node field.
 * Does not issue permission: validate consumes the existing reservation's scope.
 * Claim submission before awaiting validation so concurrent/retry paths cannot
 * spend one approval twice. Polling and result reads do not use this fence.
 */
export function createApplicationGenerationExecution(validate: Check, assertCurrent: () => unknown, parameters?: ApprovedParameters) {
  // Only scalar reviewed arguments, never source media, configuration or keys.
  const tianji = parameters?.kind === 'tianji' ? Object.freeze({model:parameters.model,resolution:parameters.resolution,duration:parameters.duration,aspectRatio:parameters.aspectRatio,mode:parameters.mode,generateAudio:parameters.generateAudio,watermark:parameters.watermark}) : null;
  let phase: 'ready' | 'checking' | 'submitted' | 'failed' = 'ready';
  let settled = false;
  let settle!: (value: { ok: boolean; error?: unknown }) => void;
  const attempted = new Promise<{ ok: boolean; error?: unknown }>(resolve => { settle = resolve; });
  const finish = (value: { ok: boolean; error?: unknown }) => {
    if (!settled) { settled = true; settle(value); }
  };
  const refuse = (error: unknown) => {
    phase = 'failed'; finish({ ok: false, error }); return error;
  };
  const execution={
    tianjiParameters() {
      if (!tianji || !tianji.model || !tianji.resolution || !Number.isFinite(tianji.duration) || !tianji.aspectRatio || !['text-to-video','first-frame','first-last','reference-media'].includes(tianji.mode!) || typeof tianji.generateAudio !== 'boolean' || typeof tianji.watermark !== 'boolean') throw failure('OPERATION_INVALID_AUTHORITY');
      return tianji;
    },
    async upload<T>(send: () => T | Promise<T>, providerBinding?: string): Promise<T> {
      if (phase !== 'ready') throw failure('OPERATION_ALREADY_CONSUMED');
      try {
        await validate('upload', providerBinding);
        if (phase !== 'ready') throw failure('OPERATION_ALREADY_CONSUMED');
        assertCurrent();
      } catch (error) { throw refuse(error); }
      // An upload failure may use an existing approved upload fallback. Every
      // fallback validates again; a failed authority check can never fall back.
      return send();
    },
    async submit<T>(send: () => T | Promise<T>, providerBinding?: string): Promise<T> {
      if (phase !== 'ready') throw failure('OPERATION_ALREADY_CONSUMED');
      phase = 'checking';
      try {
        await validate('submit', providerBinding);
        if (phase !== 'checking') throw failure('OPERATION_ALREADY_CONSUMED');
        assertCurrent();
      } catch (error) { throw refuse(error); }
      let pending: T | Promise<T>;
      try { pending = send(); } catch (error) { throw refuse(error); }
      phase = 'submitted'; finish({ ok: true });
      // Consumed even if the transport rejects or its outcome is unknown.
      return pending;
    },
    async waitForSubmission(run: Promise<unknown>) {
      // Observe the existing run, never invoke/replay it. Existing hooks may
      // catch their own errors or return before submitting; neither is success.
      void Promise.resolve(run).then(() => {
        if (!settled) refuse(failure('OPERATION_NOT_SUBMITTED'));
      }, error => { if (!settled) refuse(error); });
      const value = await attempted;
      if (!value.ok) throw value.error;
    },
  };
  // Copy this metadata string explicitly; accidental serialization of the
  // private execution object must remain empty, as before.
  return Object.freeze(Object.defineProperty(execution,'submissionId',{value:crypto.randomUUID(),enumerable:false}) as typeof execution & {readonly submissionId:string});
}

export type ApplicationGenerationExecution = ReturnType<typeof createApplicationGenerationExecution>;
