import {randomBytes, createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import type {UploadAdapter, Request, VerifiedVideo} from './publishing';
import {hash, readJson, save} from './store';

const api = 'https://www.googleapis.com/youtube/v3/';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const scopes = ['youtube.upload', 'youtube.readonly'].map((scope) => 'https://www.googleapis.com/auth/' + scope);
const tokenSchema = z.object({access_token: z.string().min(1), refresh_token: z.string().optional(), scope: z.string().optional()});
const credentialSchema = z.object({clientId: z.string().min(1), clientSecret: z.string().min(1), refreshToken: z.string().min(1)});
const videoSchema = z.object({
  id: z.string().regex(/^[\w-]+$/), snippet: z.object({channelId: z.string(), tags: z.array(z.string()).optional(), publishedAt: z.iso.datetime()}),
  status: z.object({privacyStatus: z.enum(['private', 'unlisted', 'public']), uploadStatus: z.string().optional(),
    madeForKids: z.boolean().optional(), selfDeclaredMadeForKids: z.boolean().optional()}),
  processingDetails: z.object({processingStatus: z.string()}).optional(),
  statistics: z.record(z.string(), z.string()).optional(),
});

async function checked(url: string | URL, options: RequestInit = {}, timeout = 30_000) {
  const response = await fetch(url, {...options, redirect: 'error', signal: AbortSignal.timeout(timeout)});
  if (!response.ok) throw new Error('Google API HTTP ' + response.status + ' (' + new URL(url).pathname + ')');
  return response;
}
const token = async (params: Record<string, string>) => tokenSchema.parse(await (await checked(tokenEndpoint, {
  method: 'POST', body: new URLSearchParams(params),
})).json());

export async function connect(clientFile: string, destination: string, showLink: (url: string) => void) {
  const {installed} = z.object({installed: z.object({client_id: z.string(), client_secret: z.string()})}).parse(await readJson(clientFile));
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const controller = new AbortController();
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OAuthコールバックを開始できません');
    const redirectUri = 'http://127.0.0.1:' + address.port + '/oauth';
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: installed.client_id, redirect_uri: redirectUri, response_type: 'code', scope: scopes.join(' '),
      state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
    }).toString();
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => controller.abort(), 300_000);
      controller.signal.addEventListener('abort', () => reject(new Error('OAuthの待機時間を超えました')), {once: true});
      server.on('request', (request, response) => {
        const callback = new URL(request.url ?? '/', redirectUri);
        if (callback.pathname !== '/oauth' || callback.searchParams.get('state') !== state) {
          response.writeHead(400).end('Invalid OAuth callback');
          return;
        }
        clearTimeout(timer);
        const authorizationCode = callback.searchParams.get('code');
        response.writeHead(authorizationCode ? 200 : 400, {'content-type': 'text/plain; charset=utf-8'}).end('ターミナルへ戻ってください。');
        if (authorizationCode) resolve(authorizationCode);
        else reject(new Error('Googleによる認証が完了しませんでした'));
      });
      showLink(url.toString());
    });
    const result = await token({code, client_id: installed.client_id, client_secret: installed.client_secret, redirect_uri: redirectUri,
      grant_type: 'authorization_code', code_verifier: verifier});
    if (!scopes.every((scope) => result.scope?.split(' ').includes(scope))) throw new Error('YouTubeのアップロード権限と読み取り権限が必要です');
    const credentials = credentialSchema.parse({clientId: installed.client_id, clientSecret: installed.client_secret, refreshToken: result.refresh_token});
    const youtube = new YouTube(result.access_token);
    const channel = await youtube.channel();
    await save(destination, credentials);
    return channel;
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

export async function youtubeFromEnvironment() {
  const file = process.env.SHORTS_YOUTUBE_CREDENTIALS;
  const credentials = credentialSchema.parse(file ? await readJson(file) : {
    clientId: process.env.YOUTUBE_CLIENT_ID, clientSecret: process.env.YOUTUBE_CLIENT_SECRET, refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
  });
  const result = await token({client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token'});
  return new YouTube(result.access_token);
}

export const uploadTag = (request: Request) => 'appshorts-' + request.idempotencyKey;
export class YouTube implements UploadAdapter {
  readonly environment = 'youtube' as const;
  constructor(private readonly accessToken: string) {}
  private headers() { return {authorization: 'Bearer ' + this.accessToken}; }
  private async get(resource: string, params: Record<string, string>) {
    return (await checked(api + resource + '?' + new URLSearchParams(params), {headers: this.headers()})).json();
  }
  async channel() {
    const {items} = z.object({items: z.array(z.object({id: z.string(), snippet: z.object({title: z.string()})})).default([])})
      .parse(await this.get('channels', {part: 'snippet', mine: 'true'}));
    if (items.length !== 1) throw new Error('OAuthで単一のYouTubeチャンネルを選択してください');
    return {id: items[0]!.id, title: items[0]!.snippet.title};
  }
  async upload(request: Request, filename: string): Promise<string> {
    const bytes = await readFile(filename);
    if (hash(bytes) !== request.mediaHash) throw new Error('送信するファイルが承認済みのMP4と一致しません');
    const start = await checked('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {...this.headers(), 'content-type': 'application/json', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(bytes.length)},
      body: JSON.stringify({
        snippet: {title: request.metadata.title, description: request.metadata.description, categoryId: '22', tags: [uploadTag(request)]},
        status: {privacyStatus: request.privacyStatus, selfDeclaredMadeForKids: request.metadata.madeForKids},
      }),
    });
    const location = start.headers.get('location');
    if (!location) throw new Error('YouTubeがアップロードセッションを返しませんでした');
    const session = new URL(location);
    if (session.origin !== 'https://www.googleapis.com' || session.pathname !== '/upload/youtube/v3/videos') throw new Error('予期しないアップロード先です');
    const result = await checked(session, {method: 'PUT', headers: {...this.headers(), 'content-type': 'video/mp4'}, body: new Uint8Array(bytes)}, 300_000);
    return z.object({id: z.string()}).parse(await result.json()).id;
  }
  async verify(externalId: string, request: Request): Promise<VerifiedVideo> {
    const {items} = z.object({items: z.array(videoSchema).default([])}).parse(await this.get('videos', {
      part: 'snippet,status,processingDetails,statistics', id: externalId,
    }));
    const video = items[0];
    if (!video || video.id !== externalId || video.snippet.channelId !== request.accountId || !video.snippet.tags?.includes(uploadTag(request))) {
      throw new Error('動画ID、投稿先、または投稿台帳マーカーが一致しません');
    }
    const processing = video.processingDetails?.processingStatus;
    const status = video.status.uploadStatus;
    const processingStatus = ['failed', 'terminated'].includes(processing ?? '') || ['failed', 'rejected', 'deleted'].includes(status ?? '')
      ? 'failed' : (processing === 'succeeded' || status === 'processed') ? 'succeeded' : 'processing';
    const counters: Record<string, number> = {};
    for (const [source, target] of [['viewCount', 'views'], ['likeCount', 'likes'], ['commentCount', 'comments']] as const) {
      const value = video.statistics?.[source];
      if (value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) counters[target] = Number(value);
    }
    return {externalId, privacyStatus: video.status.privacyStatus, processingStatus,
      publishedAt: video.snippet.publishedAt, madeForKids: video.status.selfDeclaredMadeForKids ?? video.status.madeForKids, counters};
  }
}
