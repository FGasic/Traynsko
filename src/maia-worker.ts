/// <reference lib="webworker" />
/**
 * Runs Maia-3 off the main thread with ONNX Runtime (WebAssembly, one thread: no special headers needed).
 * Messages: {type:'load', model} → {type:'ready'} | {type:'error', message};
 *           {type:'run', id, tokens, elo, oppo} → {type:'result', id, logits, value} | {type:'error', id, message}.
 */
import * as ort from 'onnxruntime-web/wasm';

declare const __ORT_WASM__: string;
ort.env.wasm.numThreads = 1;
// only the .wasm is fetched: the loader that goes with it is already in this bundle
ort.env.wasm.wasmPaths = { wasm: new URL(__ORT_WASM__, self.location.href).href };
ort.env.logLevel = 'error';

let session: ort.InferenceSession | null = null;
const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (ev: MessageEvent) => {
  const d = ev.data;
  if (d?.type === 'load') {
    try {
      const res = await fetch(d.model);
      if (!res.ok) throw new Error(`model ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      // one warm-up run, so the first real move isn't the slow one
      await run(new Float32Array(64 * 96), 1500, 1500);
      post({ type: 'ready' });
    } catch (e: any) {
      post({ type: 'error', message: String(e?.message ?? e) });
    }
    return;
  }
  if (d?.type === 'run') {
    try {
      if (!session) throw new Error('not loaded');
      const { logits, value } = await run(d.tokens, d.elo, d.oppo);
      post({ type: 'result', id: d.id, logits, value }, [logits.buffer, value.buffer]);
    } catch (e: any) {
      post({ type: 'error', id: d.id, message: String(e?.message ?? e) });
    }
  }
};

async function run(tokens: Float32Array, elo: number, oppo: number) {
  const out = await session!.run({
    tokens: new ort.Tensor('float32', tokens, [1, 64, 96]),
    self_elo: new ort.Tensor('int64', BigInt64Array.from([BigInt(elo)]), [1]),
    oppo_elo: new ort.Tensor('int64', BigInt64Array.from([BigInt(oppo)]), [1]),
  });
  return { logits: new Float32Array(out.logits_move.data as Float32Array), value: new Float32Array(out.logits_value.data as Float32Array) };
}
