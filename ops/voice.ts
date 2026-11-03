// Probe: transcribe one WAV with Muse Voice Transcribe. Usage: ops/with-env.sh npx tsx ops/voice.ts file.wav
import { readFileSync } from "node:fs";
import { CostLog } from "../src/budget.ts";
import { transcribe, wavSeconds } from "../src/meta/transcribe.ts";
const wav = readFileSync(process.argv[2]!);
const costs = new CostLog();
console.log(`${wavSeconds(wav).toFixed(1)} s of audio`);
console.log(JSON.stringify(await transcribe(wav, costs)), costs.items);
