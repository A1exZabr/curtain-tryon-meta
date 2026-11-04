// Demo server: a single page, a small job queue around the engine, voice notes, and the guards a public
// demo needs (per-visitor limits, a daily spend cap, and no service in territories Meta's policy excludes).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import geoip from "geoip-lite";
import { BudgetExceeded, CostLog, spentToday } from "../src/budget.ts";
import { SPEND_CAP_USD_PER_DAY } from "../src/config.ts";
import { transcribe } from "../src/meta/transcribe.ts";
import { isPhoto } from "../src/pipeline/images.ts";
import { tryOn, type Step, type TryOnReport } from "../src/pipeline/tryon.ts";
import { STYLES, styleById } from "../src/pipeline/styles.ts";

const PORT = Number(process.env.PORT ?? "8080");
const PUBLIC = join(import.meta.dirname, "public");
const GALLERY = process.env.GALLERY_DIR ?? join(import.meta.dirname, "..", "gallery");
const TRIES_PER_HOUR = Number(process.env.TRIES_PER_HOUR ?? "6");
const MAX_RUNNING = Number(process.env.MAX_RUNNING ?? "2");
// Each waiting try-on holds its photos in memory; past this many the demo says it is busy instead.
const MAX_QUEUED = Number(process.env.MAX_QUEUED ?? "20");
const VOICE_NOTES_PER_HOUR = Number(process.env.VOICE_NOTES_PER_HOUR ?? "20");
// The page sends photos shrunk to 1600 px JPEGs, a couple of megabytes for all three as data URLs.
const TRYON_BODY_LIMIT = 12_000_000;
// Two minutes of 16 kHz mono 16-bit audio and the header.
const VOICE_BODY_LIMIT = 4_000_000;
// Meta Model API geographic use policy: integrated products must not be offered in restricted territories.
const BLOCKED = new Set((process.env.BLOCKED_COUNTRIES ?? "RU,BY,KP,IR,SY,CU").split(","));

interface Job {
  id: string;
  status: "queued" | "running" | "done" | "error";
  step?: Step;
  attempt?: number;
  error?: string;
  result?: unknown;
  created: number;
  input: { room: Buffer; fabric: Buffer; style?: Buffer; styleId?: string; wish?: string };
}

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running = 0;
const triesByVisitor = new Map<string, number[]>();
const voiceByVisitor = new Map<string, number[]>();

/**
 * Books one use for this visitor if they have any left this hour. The booking is made before the request body is
 * read, so a burst of requests sent at once can't all pass the check while each waits for its upload.
 */
function book(uses: Map<string, number[]>, ip: string, perHour: number, now: number): boolean {
  const recent = (uses.get(ip) ?? []).filter((t) => t > now - 3600_000);
  if (recent.length >= perHour) return false;
  recent.push(now);
  uses.set(ip, recent);
  return true;
}

/** Gives a booked use back when the request turned out to be one the page would never send. */
function unbook(uses: Map<string, number[]>, ip: string, at: number): void {
  const recent = uses.get(ip) ?? [];
  const i = recent.indexOf(at);
  if (i >= 0) recent.splice(i, 1);
}

class TooLarge extends Error {}

function visitorIp(req: IncomingMessage): string {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function blockedCountry(ip: string): string | undefined {
  const country = geoip.lookup(ip.replace(/^::ffff:/, ""))?.country;
  return country && BLOCKED.has(country) ? country : undefined;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new TooLarge("request too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function fromDataUrl(value: unknown): Buffer | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(value);
  return match ? Buffer.from(match[2]!, "base64") : undefined;
}

const dataUrl = (jpeg: Buffer | undefined) => (jpeg ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : undefined);

/** What the page gets back: pictures as data URLs plus the report without raw buffers. */
function present(report: TryOnReport): unknown {
  const { image, debug, before, ...rest } = report;
  // Only a picture that passed every check leaves the server. The generator's own pictures, rejected attempts
  // included, stay here: sent to the page they would make the demo a free image editor that skips the checks.
  const accepted = report.status === "accepted";
  const shown = (k: string) => k === "segmentation" || k === "light" || (accepted && k.startsWith("paste-"));
  return {
    ...rest,
    before: accepted ? dataUrl(before) : undefined,
    image: accepted ? dataUrl(image) : undefined,
    debug: Object.fromEntries(Object.entries(debug).filter(([k]) => shown(k)).map(([k, v]) => [k, dataUrl(v)])),
  };
}

async function runNext(): Promise<void> {
  if (running >= MAX_RUNNING) return;
  const job = queue.shift();
  if (!job) return;
  running++;
  job.status = "running";
  try {
    const report = await tryOn({
      ...job.input,
      onStep: (step, attempt) => {
        job.step = step;
        job.attempt = attempt;
      },
    });
    job.result = present(report);
    job.status = "done";
    // One line per try-on, numbers only: the photos are never written anywhere.
    console.log(
      JSON.stringify({
        job: job.id.slice(0, 8),
        status: report.status,
        reason: report.reason,
        windows: report.scene?.window_count,
        cover: report.scene?.window_cover,
        style: report.style?.id,
        attempts: report.attempts.map((a) => ({
          mode: a.mode,
          roomDiff: a.geometry.roomDiff,
          edgesKept: a.geometry.edgesKept,
          windowDiff: a.geometry.windowDiff,
          inside: +a.geometry.curtainsInsideRegion.toFixed(2),
          coverage: +a.geometry.curtainCoverage.toFixed(2),
          deltaE: a.colour ? +a.colour.deltaE.toFixed(1) : undefined,
          light: a.light ? [+a.light.minGain.toFixed(2), +a.light.maxGain.toFixed(2)] : undefined,
          score: a.verdict?.score,
          defects: a.verdict?.defects,
          why: a.why,
        })),
        usd: +report.totalUsd.toFixed(4),
        s: Math.round(report.ms / 1000),
      }),
    );
  } catch (error) {
    job.status = "error";
    job.error =
      error instanceof BudgetExceeded
        ? "The demo has used today's budget. Please look at the gallery, or come back tomorrow."
        : "Something went wrong on our side. Please try again.";
    console.error(`job ${job.id}:`, error);
  } finally {
    running--;
    job.input = { room: Buffer.alloc(0), fabric: Buffer.alloc(0) };
    void runNext();
  }
}

// On a restart the container gets SIGTERM: take no new try-ons and let the running ones finish (the page keeps
// polling this container until then), then exit. compose.yaml gives it the time.
let closing = false;
process.on("SIGTERM", () => {
  closing = true;
  const since = Date.now();
  const timer = setInterval(() => {
    if ((running === 0 && queue.length === 0) || Date.now() - since > 170_000) {
      clearInterval(timer);
      // A last poll can still collect a result that has just finished.
      setTimeout(() => process.exit(0), 5000);
    }
  }, 1000);
});

// Drop finished jobs after an hour so photos don't pile up in memory, and visitors with no use left in the hour.
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [id, job] of jobs) if (job.created < cutoff) jobs.delete(id);
  for (const uses of [triesByVisitor, voiceByVisitor]) {
    for (const [ip, times] of uses) if (!times.some((t) => t > cutoff)) uses.delete(ip);
  }
}, 600_000).unref();

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function serveFile(res: ServerResponse, root: string, path: string): void {
  const file = normalize(join(root, path));
  // A folder (/gallery/, /fonts) is not a file to send.
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  const data = readFileSync(file);
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "public, max-age=300" });
  res.end(data);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const ip = visitorIp(req);
  try {
    const country = blockedCountry(ip);
    if (country) {
      if (url.pathname.startsWith("/api/")) return send(res, 451, { error: "This demo is not available in your region." });
      return serveFile(res, PUBLIC, "unavailable.html");
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, { ok: true, running, queued: queue.length, spentToday: +spentToday().toFixed(4), cap: SPEND_CAP_USD_PER_DAY });
    }

    if (req.method === "GET" && url.pathname === "/api/styles") {
      return send(res, 200, STYLES.map(({ id, name, hint }) => ({ id, name, hint })));
    }

    if (req.method === "GET" && url.pathname === "/api/gallery") {
      const items = existsSync(GALLERY)
        ? readdirSync(GALLERY)
            .filter((f) => f.endsWith(".json"))
            .sort()
            .map((f) => JSON.parse(readFileSync(join(GALLERY, f), "utf8")))
        : [];
      return send(res, 200, items);
    }
    if (req.method === "GET" && url.pathname.startsWith("/gallery/")) {
      return serveFile(res, GALLERY, url.pathname.slice("/gallery/".length));
    }

    if (req.method === "POST" && url.pathname === "/api/tryon") {
      if (closing) return send(res, 503, { error: "The demo is restarting. Please try again in a minute." });
      if (spentToday() >= SPEND_CAP_USD_PER_DAY) return send(res, 503, { error: "The demo has used today's budget. Please look at the gallery." });
      if (queue.length >= MAX_QUEUED) return send(res, 503, { error: "The demo is busy right now. Please try again in a few minutes, or look at the gallery." });
      const now = Date.now();
      if (!book(triesByVisitor, ip, TRIES_PER_HOUR, now)) return send(res, 429, { error: "That's enough tries for this hour. Please look at the gallery meanwhile." });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, TRYON_BODY_LIMIT)).toString("utf8")) as Record<string, unknown>;
      } catch (error) {
        unbook(triesByVisitor, ip, now);
        if (error instanceof TooLarge) return send(res, 413, { error: "The photos are too large." });
        return send(res, 400, { error: "Please add a room photo and a fabric photo." });
      }
      const room = fromDataUrl(body.room);
      const fabric = fromDataUrl(body.fabric);
      const style = fromDataUrl(body.style);
      const photos = [room, fabric, style].filter((p): p is Buffer => p !== undefined);
      if (!room || !fabric || !(await Promise.all(photos.map(isPhoto))).every(Boolean)) {
        unbook(triesByVisitor, ip, now);
        return send(res, 400, { error: "Please add a room photo and a fabric photo, as JPEG, PNG or WebP." });
      }
      const wish = typeof body.wish === "string" ? body.wish.slice(0, 300) : undefined;
      const styleId = typeof body.styleId === "string" && styleById(body.styleId) ? body.styleId : undefined;
      const job: Job = { id: randomUUID(), status: "queued", created: now, input: { room, fabric, style, styleId, wish } };
      jobs.set(job.id, job);
      queue.push(job);
      void runNext();
      return send(res, 202, { id: job.id });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const job = jobs.get(url.pathname.slice("/api/jobs/".length));
      if (!job) return send(res, 404, { error: "unknown job" });
      const position = job.status === "queued" ? queue.indexOf(job) + 1 : 0;
      return send(res, 200, { status: job.status, step: job.step, attempt: job.attempt, position, error: job.error, result: job.result });
    }

    if (req.method === "POST" && url.pathname === "/api/transcribe") {
      if (closing) return send(res, 503, { error: "The demo is restarting. Please try again in a minute." });
      if (!book(voiceByVisitor, ip, VOICE_NOTES_PER_HOUR, Date.now())) return send(res, 429, { error: "That's enough voice notes for this hour. Please type your wish instead." });
      const wav = await readBody(req, VOICE_BODY_LIMIT);
      const text = await transcribe(wav, new CostLog());
      return send(res, 200, { text });
    }

    // HEAD as well: link previews and uptime checks ask for the headers only.
    if (req.method === "GET" || req.method === "HEAD") return serveFile(res, PUBLIC, url.pathname === "/" ? "index.html" : url.pathname);
    res.writeHead(405).end();
  } catch (error) {
    console.error(`${req.method} ${url.pathname}:`, error);
    // Once the headers are out, an error answer can't be written any more; writing one would crash the server.
    if (res.headersSent) return void res.destroy();
    if (error instanceof TooLarge) return send(res, 413, { error: "That file is too large." });
    send(res, error instanceof BudgetExceeded ? 503 : 500, { error: "Something went wrong. Please try again." });
  }
});

server.listen(PORT, () => console.log(`demo on http://localhost:${PORT}`));
