import assert from "node:assert/strict";
import test from "node:test";
import { masterGainDb, normalizeSound, SOUND_DEFAULTS, trackGains } from "../src/sound.js";

test("sound settings fill defaults and reject values out of range", () => {
  assert.deepEqual(normalizeSound({}), SOUND_DEFAULTS);
  assert.equal(normalizeSound({ sfxDb: -6 }).sfxDb, -6);
  assert.throws(() => normalizeSound({ targetLufs: -3 }), /targetLufs/);
  assert.throws(() => normalizeSound({ musicDb: -10, musicPauseDb: -20 }), /паузах/);
});

test("effects land at the same level relative to the voice whatever their file loudness", () => {
  const settings = normalizeSound({ sfxDb: -10 });
  const loud = trackGains({ type: "sfx", fileLufs: -8.6, voiceLufs: -27.8, settings });
  const quiet = trackGains({ type: "sfx", fileLufs: -24.2, voiceLufs: -27.8, settings });
  // file + gain = voice − 10 dB for both.
  assert.ok(Math.abs(-8.6 + 20 * Math.log10(loud.volume) - -37.8) < 0.05);
  assert.ok(Math.abs(-24.2 + 20 * Math.log10(quiet.volume) - -37.8) < 0.05);
  // The agent can only lower an effect.
  assert.ok(trackGains({ type: "sfx", fileLufs: -8.6, voiceLufs: -27.8, settings, volume: 0.5 }).volume < loud.volume);
});

test("music has a level under speech and a higher one in pauses", () => {
  const gains = trackGains({ type: "music", fileLufs: -14.5, voiceLufs: -27.8, settings: normalizeSound({}) });
  assert.ok(gains.pauseVolume > gains.volume);
  assert.equal(trackGains({ type: "music", fileLufs: null, voiceLufs: -27.8, settings: normalizeSound({}) }), null);
});

test("the master gain brings the voice to the target", () => {
  assert.equal(masterGainDb(-27.8, normalizeSound({})), 13.8);
});
