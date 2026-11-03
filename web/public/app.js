// Demo page: gallery, uploads (resized in the browser), voice notes as WAV, job polling, result view.

const $ = (selector, root = document) => root.querySelector(selector);

// --- Before/after with the tape-measure divider -------------------------------------------------------------
function setupCompare(el) {
  const tape = $(".tape", el);
  const set = (pct) => {
    const p = Math.max(0, Math.min(100, pct));
    el.style.setProperty("--pos", `${p}%`);
    tape.setAttribute("aria-valuenow", String(Math.round(p)));
  };
  const fromEvent = (e) => {
    const r = el.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * 100);
  };
  let dragging = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Without this a mouse drag starts a text selection that runs over the photos and paints them blue.
    e.preventDefault();
    dragging = true;
    el.setPointerCapture(e.pointerId);
    fromEvent(e);
  });
  el.addEventListener("pointermove", (e) => { if (dragging) fromEvent(e); });
  const stop = () => { dragging = false; };
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("lostpointercapture", stop);
  el.addEventListener("dragstart", (e) => e.preventDefault());
  tape.addEventListener("keydown", (e) => {
    const now = Number(tape.getAttribute("aria-valuenow"));
    const to = { ArrowLeft: now - 5, ArrowRight: now + 5, Home: 0, End: 100 }[e.key];
    if (to !== undefined) { set(to); e.preventDefault(); }
  });
  return {
    show(before, after) {
      const img = $(".compare-after", el);
      // The result keeps the photo's own shape, but never taller than most of the screen.
      if (el.dataset.fit === "natural") {
        img.onload = () => {
          const ratio = img.naturalWidth / img.naturalHeight;
          el.style.aspectRatio = String(ratio);
          el.style.width = `min(100%, calc(80svh * ${ratio.toFixed(4)}))`;
        };
      }
      $(".compare-before", el).src = before;
      img.src = after;
      if (el.dataset.fit !== "natural") el.style.setProperty("--backdrop", `url("${after}")`);
      set(50);
    },
  };
}

const hero = setupCompare($("#hero-compare"));
const resultCompare = setupCompare($("#result-compare"));

// --- Gallery -------------------------------------------------------------------------------------------------
async function loadGallery() {
  const items = await fetch("/api/gallery").then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const box = $("#gallery");
  if (!items.length) return;
  $("#gallery-note").hidden = items.length < 2;
  const pick = (item, button) => {
    hero.show(item.before, item.after);
    $("#hero-caption").textContent = item.caption ?? "";
    box.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  };
  items.forEach((item, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.setAttribute("aria-label", item.caption ?? `Example ${i + 1}`);
    button.innerHTML = `<img src="${item.fabric}" alt="">`;
    button.addEventListener("click", () => pick(item, button));
    box.append(button);
    if (i === 0) pick(item, button);
  });
  const stats = items.find((i) => i.stats)?.stats;
  if (stats) renderNumbers(stats);
}

function renderNumbers(stats) {
  $("#numbers").innerHTML = stats
    .map((s) => `<div><b>${s.value}</b>${s.label}</div>`)
    .join("");
}

// --- Uploads: shrink in the browser so phones don't send 8 MB photos ----------------------------------------
async function shrink(file, longSide = 1600) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

const photos = {};
document.querySelectorAll(".drop").forEach((drop) => {
  const input = $("input", drop);
  const key = drop.dataset.for;
  const take = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    photos[key] = await shrink(file);
    $("img", drop).src = photos[key];
    drop.classList.add("filled");
    $(".drop-action", drop).textContent = "Change";
  };
  input.addEventListener("change", () => take(input.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); take(e.dataTransfer.files[0]); });
});

// --- Voice: record, convert to 16 kHz mono WAV, send to Muse Voice Transcribe ------------------------------
const mic = $("#mic");
const micNote = $("#mic-note");
let recorder;
let chunks = [];

function note(text) {
  micNote.textContent = text;
  micNote.hidden = !text;
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      note("Writing it down…");
      try {
        const wav = await toWav(new Blob(chunks, { type: recorder.mimeType }));
        const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        $("#wish").value = body.text;
        note(body.text ? "Muse Voice Transcribe wrote down what you said. Edit it if needed." : "Nothing was heard. Try again a little closer to the microphone.");
      } catch {
        note("That didn't work. Type your wish instead.");
      }
    };
    recorder.start();
    mic.setAttribute("aria-pressed", "true");
    mic.textContent = "Listening… release to stop";
  } catch {
    note("The browser didn't give access to the microphone. Type your wish instead.");
  }
}

function stopRecording() {
  if (recorder?.state === "recording") recorder.stop();
  mic.setAttribute("aria-pressed", "false");
  mic.textContent = "Hold to speak";
}

mic.addEventListener("pointerdown", (e) => { e.preventDefault(); startRecording(); });
mic.addEventListener("pointerup", stopRecording);
mic.addEventListener("pointerleave", stopRecording);
mic.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); startRecording(); } });
mic.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") stopRecording(); });

async function toWav(blob) {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buffer], { type: "audio/wav" });
}

// --- Run a try-on ---------------------------------------------------------------------------------------------
const ORDER = ["read", "segment", "generate", "align", "check"];

function showStep(step) {
  const reached = step === "done" ? ORDER.length : Math.max(0, ORDER.indexOf(step));
  document.querySelectorAll("#steps li").forEach((li, i) => {
    // Reading the photos and finding the window run at the same time.
    const active = step !== "done" && (i === reached || (step === "read" && i === 1));
    li.classList.toggle("active", active);
    li.classList.toggle("done", i < reached && !active);
  });
}

function formError(text) {
  const el = $("#form-error");
  el.textContent = text ?? "";
  el.hidden = !text;
}

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  formError();
  if (!photos.room || !photos.fabric) return formError("Add a photo of your room and a photo of your fabric.");
  const go = $("#go");
  go.disabled = true;
  go.textContent = "Working on it…";
  $("#result").hidden = true;
  showStep("read");
  try {
    const res = await fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: photos.room, fabric: photos.fabric, style: photos.style, wish: $("#wish").value.trim() || undefined }),
    });
    const started = await res.json();
    if (!res.ok) throw new Error(started.error);
    const result = await poll(started.id);
    showResult(result);
  } catch (error) {
    formError(error.message || "Something went wrong. Try again.");
    document.querySelectorAll("#steps li").forEach((li) => li.classList.remove("active"));
  } finally {
    go.disabled = false;
    go.textContent = "Hang the curtains";
  }
});

async function poll(id) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const job = await fetch(`/api/jobs/${id}`).then((r) => r.json());
    if (job.status === "error") throw new Error(job.error);
    if (job.status === "done") { showStep("done"); return job.result; }
    if (job.status === "queued") $("#go").textContent = `In line: ${job.position}`;
    else if (job.step) showStep(job.step);
  }
}
function showResult(r) {
  const box = $("#result");
  box.hidden = false;
  const verdict = $("#verdict");
  if (r.status === "accepted") {
    verdict.className = "verdict ok";
    verdict.textContent = `Done in ${(r.ms / 1000).toFixed(0)} s. The window stayed in place and the curtains match your fabric.`;
  } else if (r.status === "rejected_input") {
    verdict.className = "verdict no";
    verdict.textContent = r.clientMessage || "These photos won't work for a try-on. Send a room with the window in the frame and a close-up of the fabric.";
  } else {
    verdict.className = "verdict no";
    verdict.textContent = `No try-on passed the checks this time: ${r.reason}. We show nothing rather than a bad picture. Try another photo of the room.`;
  }
  if (r.image && r.status === "accepted") {
    resultCompare.show(r.before, r.image);
    $("#result-compare").hidden = false;
    $("#save-link").href = r.image;
    $("#save").hidden = false;
  } else {
    $("#result-compare").hidden = true;
    $("#save").hidden = true;
  }
  const design = $("#design");
  design.hidden = !r.design;
  if (r.design) {
    design.innerHTML = r.design.fromClientPhoto
      ? `<b>Your style photo.</b> Closest in our catalogue: ${escapeHtml(r.design.name.toLowerCase())}.`
      : `<b>${escapeHtml(r.design.name)}.</b> ${escapeHtml(r.design.reason)}`;
  }
  const estimate = $("#estimate");
  const e = r.estimate;
  estimate.hidden = !e;
  if (e) {
    estimate.innerHTML =
      `<b>Fabric: about ${e.metres} m.</b> ` +
      `${e.openings > 1 ? `${e.openings} openings, ` : ""}a ${(e.rodCm / 100).toFixed(1)} m rod with ×${e.fullness} gathers, ` +
      `curtains ${(e.dropCm / 100).toFixed(2)} m long. Measured from the photo; a salon checks it with a tape before cutting.`;
  }
  const last = r.attempts?.at(-1);
  $("#seg").src = r.debug?.segmentation ?? "";
  // An attempt that failed before pasting has no paste picture; show the last one there is.
  const pastes = Object.keys(r.debug ?? {}).filter((k) => k.startsWith("paste-")).sort();
  const paste = pastes.length ? r.debug[pastes.at(-1)] : "";
  $("#paste").src = paste;
  $("#paste").closest("figure").hidden = !paste;
  $("#light").src = r.debug?.light ?? "";
  $("#light").closest("figure").hidden = !r.debug?.light;
  const facts = [];
  if (r.scene) {
    facts.push(["Fabric", `${r.scene.fabric_description} ${r.scene.fabric_colour_hex}, ${r.scene.fabric_opacity ?? "opaque"}`]);
    facts.push(["Windows seen", String(r.scene.window_count)]);
    const cover = { sheer: "tulle, kept as it is", curtains: "drawn curtains, kept closed", blinds: "blinds, kept as they are", mixed: "tulle or blinds, kept" }[r.scene.window_cover];
    if (cover) facts.push(["On the window now", cover]);
  }
  if (last?.geometry) {
    facts.push(["Window unchanged", `difference ${last.geometry.windowDiff} of 255 after alignment`]);
    facts.push(["Curtains inside their area", `${Math.round(last.geometry.curtainsInsideRegion * 100)}%`]);
  }
  if (last?.colour) facts.push(["Colour drift fixed", `ΔE ${last.colour.deltaE.toFixed(1)} before the fix`]);
  if (last?.light) facts.push(["Relit to the room's light", `brightness ×${last.light.minGain.toFixed(2)} to ×${last.light.maxGain.toFixed(2)} across the curtains`]);
  if (last?.verdict) facts.push(["Muse Spark Open says", `${last.verdict.notes} (score ${last.verdict.score})`]);
  facts.push(["Attempts", String(r.attempts?.length ?? 0)]);
  const retry = r.attempts?.find((a) => a.fixes?.length);
  if (retry) facts.push(["Second try told Muse Image", retry.fixes.join(" ")]);
  $("#facts").innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("");
  $("#costs tbody").innerHTML = (r.costs ?? [])
    .map((c) => `<tr><td>${escapeHtml(c.what)}</td><td>${(c.ms / 1000).toFixed(1)} s</td><td>$${c.usd.toFixed(4)}</td></tr>`)
    .join("");
  $("#costs tfoot").innerHTML = `<tr><td>Total</td><td>${(r.ms / 1000).toFixed(0)} s</td><td>$${r.totalUsd.toFixed(3)}</td></tr>`;
  box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

loadGallery();
