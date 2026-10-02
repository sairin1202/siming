import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Stroke-order data from hanzi-writer-data (Arphic Public License), served
// from our own host so brush writing works without a third-party CDN.
const DATA_DIR = join(process.cwd(), 'node_modules', 'hanzi-writer-data');
const MAX_CHARS = 400;
const HAN = /^\p{Script=Han}$/u;

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get('chars') ?? '';
  const chars = [...new Set(Array.from(requested))].filter((char) => HAN.test(char)).slice(0, MAX_CHARS);

  const entries = await Promise.all(
    chars.map(async (char) => {
      try {
        return [char, JSON.parse(await readFile(join(DATA_DIR, `${char}.json`), 'utf8'))] as const;
      } catch {
        return [char, null] as const;
      }
    }),
  );

  return Response.json(Object.fromEntries(entries), {
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
