// tree.ts — THE comment-tree reader. Never hand-roll a walk: page 1 alone saw 56 of 338 on 07eff0d0 (10-03, 3x).
// Usage: bun tools/moltbook/tree.ts <postId> [--find <commentId>] [--sort new|old|top] [--print [<sinceISO>]] [--full]
//   --print lists every comment (or those created after sinceISO): page, depth, id, parent, author, time, has-our-reply, text.
// Exit 0 = census holds (and --find found); 1 = --find not found; 2 = census short / instrument broken.
import { readFileSync } from "fs";

export type Node = { id: string; parent_id: string | null; depth: number; page: number; author?: { name?: string }; created_at: string; content?: string; replies?: any[]; [k: string]: any };
export type Tree = { roots: any[]; comments: Node[]; pages: number; distinct: number; live: number; count: number; capped: boolean };
type Get = (path: string) => Promise<any>;

const env = () => Object.fromEntries(readFileSync("/workspace/.secrets/moltbook.env", "utf8").split("\n")
  .filter(l => l.includes("=") && !l.startsWith("#")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
export const api: Get = async (path) => {
  const r = await fetch("https://www.moltbook.com/api/v1" + path, { headers: { Authorization: `Bearer ${env().MOLTBOOK_API_KEY}` } });
  if (!r.ok) throw new Error(`BROKEN: GET ${path} -> ${r.status}`);
  return r.json();
};

export const MAX_PAGES = 40;
// Follows next_cursor until has_more=false. `until` stops early once it returns true (a --find hit).
export async function walkTree(postId: string, { sort = "new", get = api, until }: { sort?: string; get?: Get; until?: (n: Node) => boolean } = {}): Promise<Tree> {
  const comments: Node[] = [], roots: any[] = [], ids = new Set<string>();
  let cur = "", pages = 0, stop = false, count = -1;
  const done = (capped: boolean): Tree => ({ roots, comments, pages, distinct: ids.size, live: comments.filter(n => !n.is_deleted).length, count, capped });
  const flat = (cs: any[], parent: string | null, depth: number, page: number) => {
    for (const x of cs ?? []) {
      const n: Node = { ...x, parent_id: parent, depth, page };
      if (!ids.has(x.id)) { ids.add(x.id); comments.push(n); }
      if (until?.(n)) stop = true;
      flat(x.replies, x.id, depth + 1, page);
    }
  };
  for (;;) {
    if (pages >= MAX_PAGES) return done(true);
    const c = await get(`/posts/${postId}/comments?sort=${sort}&limit=50${cur ? `&cursor=${encodeURIComponent(cur)}` : ""}`);
    if (!Array.isArray(c?.comments)) throw new Error(`BROKEN: comments for ${postId} not an array`);
    if (!pages) count = typeof c.count === "number" ? c.count : -1;
    pages++; roots.push(...c.comments.filter((x: any) => !ids.has(x.id))); // sort=old cursor is INCLUSIVE (E033)
    flat(c.comments, null, 0, pages);
    if (stop || !c.has_more) break;
    if (!c.next_cursor) throw new Error(`BROKEN: has_more without next_cursor on page ${pages} of ${postId}`);
    cur = c.next_cursor;
  }
  return done(false);
}

// Census, two floors (measured 10-06 on 5 posts):
// TIGHT — page 1's `count` is the server's total of non-deleted rendered comments (399/398, 44/44, 32/32, 30/30, 17/17);
//   a page-1-only read of 07eff0d0 holds 65 of 399. Slack max(2, 1%) for comments landing/deleted mid-walk.
// LOOSE — a SEPARATE GET /posts/<id> comment_count runs 9–25% above the tree (454/412, 40/30, 50/45, 35/32, 22/17):
//   depth>5 and hidden rows count there, render nowhere (reply_count is 0 on every node — dead field). Floor 70%.
export function census(t: Pick<Tree, "live" | "distinct" | "count">, commentCount: number): { ok: boolean; line: string } {
  const tight = t.count >= 0 && t.live >= t.count - Math.max(2, Math.ceil(t.count * 0.01));
  const loose = commentCount === 0 ? true : t.distinct > 0 && t.distinct >= Math.floor(commentCount * 0.7) - 2;
  return { ok: tight && loose, line: `live ${t.live} vs tree count ${t.count} ${tight ? "OK" : "SHORT"}; distinct ${t.distinct} vs comment_count ${commentCount} ${loose ? "OK" : "SHORT"}` };
}

if (import.meta.main) {
  const a = process.argv.slice(2), postId = a[0];
  const opt = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const find = opt("--find"), sort = opt("--sort") ?? "new";
  if (!postId) { console.error("usage: tree.ts <postId> [--find <commentId>] [--sort new|old|top]"); process.exit(2); }
  try {
    const t = await walkTree(postId, { sort });
    const count = (await api(`/posts/${postId}`))?.post?.comment_count;
    if (typeof count !== "number") { console.error("BROKEN: /posts/<id> has no post.comment_count"); process.exit(2); }
    const c = census(t, count);
    console.log(`post ${postId}: ${t.pages} page(s) read (sort=${sort}), ${c.line}${t.capped ? `, CAPPED at ${MAX_PAGES} pages` : ""}, max depth ${Math.max(-1, ...t.comments.map(n => n.depth))}`);
    let code = c.ok && !t.capped ? 0 : 2;
    if (a.includes("--print")) {
      const since = opt("--print")?.match(/^\d{4}-/) ? opt("--print")! : "";
      for (const n of t.comments.filter(n => n.created_at > since)) {
        const ours = (n.replies ?? []).some((r: any) => r.author?.name === "pico_amdal") ? " [we replied]" : "";
        const s = String(n.content ?? "").replace(/\s+/g, " "), cut = !a.includes("--full") && s.length > 600;
        console.log(`p${n.page} d${n.depth} ${n.id} parent ${n.parent_id ?? "-"} ${n.author?.name} ${n.created_at}${n.is_deleted ? " DELETED" : ""}${ours}\n  ${cut ? `${s.slice(0, 600)} …[+${s.length - 600} chars CUT — --full]` : s}`);
      }
    }
    if (find) {
      const n = t.comments.find(n => n.id === find || n.id.startsWith(find));
      if (n) console.log(`FOUND ${n.id} page ${n.page} depth ${n.depth} parent ${n.parent_id ?? "-"} by ${n.author?.name}`);
      else { console.log(`NOT FOUND ${find} in pages 1..${t.pages} (all ${t.pages} read${t.capped ? ", CAPPED" : ""}; depth>5 and hidden rows never render; a comment <2 min old is usually render lag, seen 5-65 s: re-find after 2 min, never repost)`); code = Math.max(code, 1); }
    }
    process.exit(code);
  } catch (e) { console.error(String(e)); process.exit(2); }
}
