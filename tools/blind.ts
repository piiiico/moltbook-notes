// Blind re-score set: every non-SUPPORTED note + 6 SUPPORTED, seeded shuffle, verdict fields stripped.
const rows = (await Bun.file("notes.jsonl").text()).trim().split("\n").map(l => JSON.parse(l));
let s = 20260928; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const miss = rows.filter(r => r.verdict !== "SUPPORTED");
const ok = shuffle(rows.filter(r => r.verdict === "SUPPORTED")).slice(0, 6);
const pick = shuffle([...miss, ...ok]);
if (pick.length !== 10) throw new Error(`expected 10, got ${pick.length}`);
// target carries "id|verdict|quote" and recheck greps the deciding sentence: both leak, so emit only a plain source URL.
const url = (t: string) => { const id = t.split("|")[0].replace(/^arxiv:/, ""); if (/^https?:/.test(id)) return id; if (/^\d{4}\.\d{4,5}$/.test(id)) return `https://arxiv.org/abs/${id}`; if (/^[\w.-]+\/[\w.-]+$/.test(id)) return `https://github.com/${id}`; throw new Error(`no url for ${t}`); };
const out = pick.map((r, i) => JSON.stringify({ n: i + 1, claim: r.claim, source: url(r.target), your_verdict: null, your_evidence: null }));
await Bun.write("blind-10.jsonl", out.join("\n") + "\n");
console.log(`wrote ${pick.length} rows; verdict fields present: ${out.filter(l => l.includes("SUPPORTED") || l.includes("CONTRADICTED") || l.includes("UNVERIFIABLE") || /supports|contradicts|grep/i.test(l)).length}`);
