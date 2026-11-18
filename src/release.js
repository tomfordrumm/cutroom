// Which Cutroom this is, and whether a newer one is published.
//
// The version comes from package.json; the revision and image are stamped at
// build time (CUTROOM_REVISION) and written by install.sh (CUTROOM_IMAGE).
// A published install asks its registry for the image's tags (the standard
// Docker Registry v2 API, anonymous pull token) and compares semver tags.
// Nothing about the install is sent: the request is the same one `docker pull`
// makes. CUTROOM_UPDATE_CHECK=off turns it off.
//
// The app cannot update itself: it has no access to Docker. The owner runs
// update.sh next to compose.yml; it pauses the queue, waits for running edits
// and restarts on the new image. While paused, the worker starts nothing new.
import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { db, getSetting, setSetting } from "./db.js";

export const VERSION = JSON.parse(readFileSync(path.join(config.root, "package.json"), "utf8")).version;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** -1, 0 or 1; versions that are not x.y.z sort below every real one. */
export function compareVersions(a, b) {
  const pa = SEMVER.exec(String(a ?? "")), pb = SEMVER.exec(String(b ?? ""));
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) > Number(pb[i]) ? 1 : -1;
  return 0;
}

/** The highest x.y.z among registry tags; `latest`, branches and pre-releases are ignored. */
export function newestTag(tags) {
  return (tags ?? []).filter((t) => SEMVER.test(t)).sort(compareVersions).pop()?.replace(/^v/, "") ?? null;
}

/** registry, repository and tag of an image reference; null for a local build. */
export function parseImage(ref) {
  const text = String(ref ?? "").trim();
  if (!text || !text.includes("/")) return null; // cutroom:local and other bare names are built here
  const [name, tag = "latest"] = text.split("@")[0].split(/:(?=[^/]+$)/);
  const parts = name.split("/");
  const hasRegistry = parts.length > 1 && /[.:]|^localhost$/.test(parts[0]);
  const registry = hasRegistry ? parts.shift() : "registry-1.docker.io";
  return { registry, repository: parts.join("/"), tag };
}

/** Tags of an image from a v2 registry, with the anonymous token its challenge asks for. */
export async function registryTags(image, { fetch: get = fetch } = {}) {
  const url = `https://${image.registry}/v2/${image.repository}/tags/list?n=1000`;
  let response = await get(url);
  if (response.status === 401) {
    const challenge = response.headers.get("www-authenticate") ?? "";
    const field = (key) => new RegExp(`${key}="([^"]*)"`).exec(challenge)?.[1];
    const realm = field("realm");
    if (!realm) throw new Error("реестр не дал адрес для токена");
    const params = new URLSearchParams({ service: field("service") ?? image.registry, scope: field("scope") ?? `repository:${image.repository}:pull` });
    const tokenResponse = await get(`${realm}?${params}`);
    // ghcr.io answers 403 for an image that is private or not published yet.
    if (tokenResponse.status === 401 || tokenResponse.status === 403) throw new Error("образ закрыт или ещё не опубликован");
    if (!tokenResponse.ok) throw new Error(`токен реестра: ${tokenResponse.status}`);
    const { token, access_token: accessToken } = await tokenResponse.json();
    response = await get(url, { headers: { authorization: `Bearer ${token ?? accessToken}` } });
  }
  if (response.status === 404) throw new Error("образ не найден в реестре");
  if (!response.ok) throw new Error(`реестр ответил ${response.status}`);
  return (await response.json()).tags ?? [];
}

let cache = null; // { at, latest, error }

/** Version, where it came from and whether a newer one is published. */
export async function versionInfo({ refresh = false, env = process.env, fetch: get = fetch, now = Date.now() } = {}) {
  const image = parseImage(env.CUTROOM_IMAGE);
  const info = {
    version: VERSION,
    revision: env.CUTROOM_REVISION || null,
    image: env.CUTROOM_IMAGE || null,
    source: image ? "published" : "local",
    installDir: env.CUTROOM_INSTALL_DIR || null,
    paused: queuePause(),
    latest: null,
    updateAvailable: false,
    checkedAt: null,
    checkError: null,
  };
  if (!image || env.CUTROOM_UPDATE_CHECK === "off") return info;
  if (refresh || !cache || now - cache.at > CHECK_EVERY_MS) {
    try {
      cache = { at: now, latest: newestTag(await registryTags(image, { fetch: get })), error: null };
    } catch (error) {
      cache = { at: now, latest: null, error: error.message };
    }
  }
  info.latest = cache.latest;
  info.checkedAt = new Date(cache.at).toISOString();
  info.checkError = cache.error;
  info.updateAvailable = Boolean(cache.latest) && compareVersions(cache.latest, VERSION) > 0;
  return info;
}

export function resetVersionCache() { cache = null; }

// ---------- the queue pause update.sh uses ------------------------------------

/** Why new edits are held, or null. */
export function queuePause() {
  return getSetting("queuePaused", null);
}

export function pauseQueue(reason = "Обновление Cutroom") {
  setSetting("queuePaused", { reason, since: new Date().toISOString() });
}

export function resumeQueue() {
  setSetting("queuePaused", null);
}

/** Jobs running and waiting, for the update script. */
export function queueCounts() {
  const count = (status) => db.prepare("SELECT count(*) AS n FROM jobs WHERE status = ?").get(status).n;
  return { running: count("running"), queued: count("queued") };
}
