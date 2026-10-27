"use strict";
(() => {
const $ = id => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";

// ===================================================================
// Simulation clock
// ===================================================================
const SIM = { t: 0, playing: false, speed: 1, demo: true, transitions: 0 };
const DT = 0.005;                 // fixed simulation step in seconds

// ===================================================================
// Plant: the physical machine. It knows nothing about state machines.
// It reads the outputs (belt, valve1, valve2) and produces the sensor signals.
// ===================================================================
const BELT_SPEED = 110;           // drawing units per second
const STROKE_TIME = 0.6;          // seconds for a full cylinder stroke
const CYL_X = [500, 700];         // centre line of ejector 1 and 2
const BIN_MAX = 12;               // parts drawn per bin

let P, SNS, prevSNS, slat;

function newPlant() {
  return {
    belt: false, valve: [false, false],   // outputs, written by the state machines
    s: [0, 0],                            // cylinder stroke 0 = in, 1 = out
    parts: [], bins: [[], [], []], nextId: 1,
  };
}

function plantStep(dt) {
  if (P.belt) slat = (slat + BELT_SPEED * dt) % 30;
  for (let k = 0; k < 2; k++) {
    const dir = P.valve[k] ? 1 : -1;      // spring return when the valve is off
    P.s[k] = Math.min(1, Math.max(0, P.s[k] + dir * dt / STROKE_TIME));
  }
  for (const p of P.parts) {
    if (p.where === "belt") {
      if (P.belt && p.y < 285) p.x += BELT_SPEED * dt;
      for (let k = 0; k < 2 && p.where === "belt"; k++) {
        const plateBottom = 220 + P.s[k] * 88;
        if (Math.abs(p.x - CYL_X[k]) < 40 && plateBottom > p.y - 22) p.y = plateBottom + 22;
        if (p.y >= 326) toBin(p, k);
      }
      if (p.where === "belt" && p.x > 872) toBin(p, 2);
    } else if (p.where === "falling") {
      const f = Math.min(1, dt * 12);
      p.x += (p.tx - p.x) * f; p.y += (p.ty - p.y) * f; p.r += (9 - p.r) * f;
      if (Math.hypot(p.tx - p.x, p.ty - p.y) < 0.5) p.where = "bin";
    }
  }
}

function toBin(p, k) {
  const bin = P.bins[k];
  bin.push(p);
  if (bin.length > BIN_MAX) {                     // keep the drawing tidy: drop the oldest part
    const old = bin.splice(0, bin.length - BIN_MAX);
    P.parts = P.parts.filter(q => !old.includes(q));
  }
  const slot = (bin.count = (bin.count || 0) + 1) - 1;
  p.where = "falling";
  if (k < 2) { p.tx = CYL_X[k] + ((slot % 3) - 1) * 19; p.ty = 400 - Math.floor((slot % BIN_MAX) / 3) * 19; }
  else       { p.tx = 902 + (slot % 3) * 20;            p.ty = 296 - Math.floor((slot % BIN_MAX) / 3) * 20; }
}

function readSensors() {
  const onBelt = P.parts.filter(p => p.where === "belt" && p.y < 292);
  const near = (x, w) => onBelt.find(p => Math.abs(p.x - x) < w);
  const c = near(300, 6);
  return {
    B1: !!near(150, 22),             // light barrier at the entry
    photoSensor: c ? c.color : null, // colour of the part underneath, or nothing
    B3: !!near(CYL_X[0], 6),         // part centred in front of ejector 1 / 2
    B4: !!near(CYL_X[1], 6),
    S1: P.s[0] < 0.02, S2: P.s[0] > 0.98,
    S3: P.s[1] < 0.02, S4: P.s[1] > 0.98,
  };
}

// ===================================================================
// State machine engine
// A machine definition is a set of states. Each state may have
//   entry – function run when the state is entered
//   on    – list of transitions: { ev | when | after, guard, action, target, id }
//           ev:    event name, e.g. "B1↑", "push"
//           when:  condition, fires as soon as it is true
//           after: seconds since the state was entered
//           id:    the arrow in the diagram that lights up
// ===================================================================
const queue = [];
const send = (to, ev, data) => queue.push({ to, ev, data });
const broadcast = (ev, data) => queue.push({ to: null, ev, data });
const trace = [];                 // internal record of all transitions (not shown on the page)

class Machine {
  constructor(prefix, label, def) {
    Object.assign(this, { prefix, label, def });
    this.state = null; this.t0 = 0; this.ctx = {};
  }
  start() {
    flash(this.prefix, "init");
    record(this.label, `start → ${this.def.initial}`);
    this.enter(this.def.initial);
  }
  enter(state) {
    this.state = state; this.t0 = SIM.t;
    this.def.states[state].entry?.(this);
    markDiagram(this);
  }
  transitions() { return this.def.states[this.state].on || []; }

  handle(ev, data) {                      // react to an event, at most one transition
    for (const t of this.transitions())
      if (t.ev === ev && (!t.guard || t.guard(this, data))) { this.fire(t, data, ev); return true; }
    return false;
  }
  poll() {                                // check when(...) and after(...) transitions
    for (const t of this.transitions()) {
      if (t.ev) continue;
      const ok = t.when ? t.when(this) : SIM.t - this.t0 >= t.after - 1e-9;
      if (ok) { this.fire(t, null, t.when ? "when" : `after(${t.after} s)`); return true; }
    }
    return false;
  }
  fire(t, data, cause) {
    const from = this.state;
    t.action?.(this, data);
    flash(this.prefix, t.id);
    let target = t.target, branch;
    if (typeof target === "function") [target, branch] = target(this, data);   // choice pseudostate
    if (branch) flash(this.prefix, branch);
    SIM.transitions++;
    record(this.label, `${from} → ${target}`, cause + (data != null ? ` ${data}` : ""));
    this.enter(target);
  }
}

// ===================================================================
// The state machines (same as the diagrams)
// ===================================================================
const binFor = c => (c === "red" ? 1 : c === "blue" ? 2 : null);
const M = {};

function ejectorDef(k) {
  const n = k + 1, sIn = "S" + (2 * k + 1), sOut = "S" + (2 * k + 2);
  return { initial: "Retracted", states: {
    Retracted:  { entry: () => { P.valve[k] = false; },
                  on: [{ ev: "push", target: "Extending", id: "push" }] },
    Extending:  { entry: () => { P.valve[k] = true; },
                  on: [{ when: () => SNS[sOut], target: "Retracting", id: "out" }] },
    Retracting: { entry: () => { P.valve[k] = false; },
                  on: [{ when: () => SNS[sIn], target: "Retracted", id: "in", action: () => send("sorter", "done", n) }] },
  } };
}

const conveyorDef = { initial: "Stopped", states: {
  Stopped: { entry: () => { P.belt = false; }, on: [{ ev: "run", target: "Running", id: "run" }] },
  Running: { entry: () => { P.belt = true; },  on: [{ ev: "stop", target: "Stopped", id: "stop" }] },
} };

const sorterDef = { initial: "WaitPart", states: {
  WaitPart:  { entry: () => send("conveyor", "stop"),
               on: [{ ev: "B1↑", target: "ToSensor", id: "b1" }] },
  ToSensor:  { entry: () => send("conveyor", "run"),
               on: [{ ev: "photoSensor", id: "b2", action: (m, c) => { m.ctx.target = binFor(c); },
                      target: m => (m.ctx.target ? ["ToEjector", "toEj"] : ["ToEnd", "toEnd"]) }] },
  ToEjector: { on: [{ ev: "B3↑", guard: m => m.ctx.target === 1, target: "Ejecting", id: "atEj1" },
                    { ev: "B4↑", guard: m => m.ctx.target === 2, target: "Ejecting", id: "atEj2" }] },
  Ejecting:  { entry: m => { send("conveyor", "stop"); send("e" + m.ctx.target, "push"); },
               on: [{ ev: "done", guard: (m, n) => n === m.ctx.target, target: "WaitPart", id: "done" }] },
  ToEnd:     { on: [{ after: 6, target: "WaitPart", id: "end" }] },
} };

// deliver queued events and evaluate when/after transitions until nothing changes
function settle() {
  for (let i = 0; i < 50; i++) {
    let changed = false;
    while (queue.length) {
      const m = queue.shift(); changed = true;
      if (m.to) M[m.to].handle(m.ev, m.data);
      else for (const k in M) M[k].handle(m.ev, m.data);
    }
    for (const k in M) if (M[k].poll()) changed = true;
    if (!changed) break;
  }
}

function sensorEvents() {
  SNS = readSensors();
  for (const k of ["B1", "B3", "B4"]) if (SNS[k] && !prevSNS[k]) broadcast(k + "↑");
  if (SNS.photoSensor && !prevSNS.photoSensor) broadcast("photoSensor", SNS.photoSensor);
  prevSNS = SNS;
}

function tick(dt) {
  SIM.t += dt;
  plantStep(dt);
  sensorEvents();
  settle();
  demoStep(dt);
}

// ===================================================================
// Placing parts (one part at a time, while the sorter waits)
// ===================================================================
const canPlace = () => M.sorter.state === "WaitPart" && !P.parts.some(p => p.where === "belt");
function insertPart(color) {
  if (!canPlace()) return;
  P.parts.push({ id: P.nextId++, color, x: 140, y: 270, r: 22, where: "belt" });
  record("Operator", `places a ${color} part`);
  SNS = prevSNS; sensorEvents(); settle();
}

// The demo operator places a new part whenever the station is free.
const demo = { wait: 0.5, n: 0 };
const DEMO_COLORS = ["red", "blue", "white", "blue", "red", "red", "white", "blue"];
function demoStep(dt) {
  if (!SIM.demo || (demo.wait -= dt) > 0) return;
  demo.wait = 0.8;
  if (canPlace()) { insertPart(DEMO_COLORS[demo.n++ % DEMO_COLORS.length]); demo.wait = 1.2; }
}

// ===================================================================
// Drawing
// ===================================================================
function markDiagram(m) {
  document.querySelectorAll(`[id^="s-${m.prefix}-"]`).forEach(el => el.classList.remove("active"));
  $(`s-${m.prefix}-${m.state}`)?.classList.add("active");
}
function flash(prefix, id) {
  const el = id && $(`t-${prefix}-${id}`);
  if (!el) return;
  el.classList.add("flash");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("flash"), 900);
}
function record(who, text, cause) {
  trace.push(`${SIM.t.toFixed(2)} s  ${who}  ${text}${cause ? "  " + cause : ""}`);
  if (trace.length > 500) trace.shift();
}

const partEls = new Map();
const partsG = $("parts");
const setAttrs = (el, a) => { for (const k in a) el.setAttribute(k, a[k]); };
const cls = (id, on) => $(id)?.classList.toggle("on", !!on);
const COLOR_CLASS = { red: "pr", blue: "pb", white: "pw" };

function render() {
  $("slats").setAttribute("transform", `translate(${slat.toFixed(2)} 0)`);
  for (let k = 0; k < 2; k++) {
    const y = 212 + P.s[k] * 88;
    $(`plate${k + 1}`).setAttribute("y", y.toFixed(1));
    $(`rod${k + 1}`).setAttribute("y2", y.toFixed(1));
    cls(`y${k + 1}`, P.valve[k]);
  }
  cls("m1", P.belt);
  for (const k of ["b1", "b3", "b4"]) cls(k, SNS[k.toUpperCase()]);
  cls("b2", SNS.photoSensor);
  $("b2lens").style.fill = SNS.photoSensor ? `var(--${SNS.photoSensor})` : "";
  for (const k of ["s1", "s2", "s3", "s4"]) cls(k, SNS[k.toUpperCase()]);
  for (let k = 0; k < 3; k++) $(`bin${k + 1}n`).textContent = P.bins[k].count ? `${P.bins[k].count} ×` : "";

  // parts
  const alive = new Set();
  for (const p of P.parts) {
    alive.add(p.id);
    let el = partEls.get(p.id);
    if (!el) { el = document.createElementNS(SVGNS, "circle"); el.setAttribute("class", COLOR_CLASS[p.color]); partsG.append(el); partEls.set(p.id, el); }
    setAttrs(el, { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: p.r.toFixed(1) });
  }
  for (const [id, el] of partEls) if (!alive.has(id)) { el.remove(); partEls.delete(id); }

  // controls and state chips
  $("clock").textContent = `t = ${SIM.t.toFixed(2)} s`;
  $("play").textContent = SIM.playing ? "❚❚ Pause" : "▶ Start";
  const free = canPlace();
  document.querySelectorAll("[data-part]").forEach(b => { b.disabled = !free; });
  $("chips").replaceChildren(...["sorter", "conveyor", "e1", "e2"].map(k => {
    const c = document.createElement("span"), b = document.createElement("b");
    c.className = "chip"; b.textContent = M[k].label;
    c.append(b, M[k].state);
    return c;
  }));
}

// ===================================================================
// Setup, main loop and controls
// ===================================================================
function powerOn() {
  P = newPlant(); slat = 0; SIM.t = 0; queue.length = 0; trace.length = 0;
  demo.wait = 0.5; demo.n = 0;
  SNS = prevSNS = readSensors();
  M.sorter = new Machine("so", "Sorter", sorterDef);
  M.conveyor = new Machine("cv", "Conveyor", conveyorDef);
  M.e1 = new Machine("e1", "Ejector 1", ejectorDef(0));
  M.e2 = new Machine("e2", "Ejector 2", ejectorDef(1));
  M.conveyor.start(); M.e1.start(); M.e2.start(); M.sorter.start();
  settle();
  render();
}

let last = null, acc = 0;
function frame(ts) {
  const real = last == null ? 0 : Math.min(0.1, (ts - last) / 1000);
  last = ts;
  if (SIM.playing) {
    acc += real * SIM.speed;
    while (acc >= DT) { tick(DT); acc -= DT; }
  }
  render();
  requestAnimationFrame(frame);
}

$("play").onclick = () => { SIM.playing = !SIM.playing; render(); };
$("next").onclick = () => {
  SIM.playing = false;
  const n = SIM.transitions;
  for (let i = 0; i < 20 / DT && SIM.transitions === n; i++) tick(DT);
  render();
};
$("reset").onclick = () => { SIM.playing = false; powerOn(); };
$("speed").onchange = e => { SIM.speed = +e.target.value; };
$("demo").onchange = e => { SIM.demo = e.target.checked; };
document.addEventListener("click", e => {
  const p = e.target.closest("[data-part]");
  if (p) { insertPart(p.dataset.part); render(); }
});
document.addEventListener("keydown", e => {
  if (e.code === "Space" && !e.target.closest("button, select, input")) { e.preventDefault(); $("play").click(); }
});

powerOn();
requestAnimationFrame(frame);
})();
