import {z} from 'zod';
import {digest, doc, immutable, readDoc} from './store';
import type {Request, UploadAdapter, VerifiedVideo} from './publishing';

const Entry = z.object({id: z.string(), at: z.iso.datetime()});
export function simulationAdapter(root: string, now: Date): UploadAdapter {
  return {
    environment: 'simulation',
    async channel() { return {id: 'simulation-channel', title: 'ローカルシミュレーション'}; },
    async upload(request) {
      const id = 'sim-' + digest(request.idempotencyKey).slice(0, 16);
      await immutable(doc(root, 'simulation/adapter', id), {id: request.idempotencyKey, at: now.toISOString()});
      return id;
    },
    async verify(id, request): Promise<VerifiedVideo> {
      const local = await readDoc(doc(root, 'simulation/adapter', id), Entry);
      if (local.id !== request.idempotencyKey) throw new Error('シミュレーションIDが一致しません');
      return {externalId: id, privacyStatus: request.privacyStatus, processingStatus: 'succeeded',
        publishedAt: local.at, madeForKids: request.metadata.madeForKids, counters: {}};
    },
  };
}
