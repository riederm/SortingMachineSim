"""Generate all sorting-station drawings: schematic, state diagrams, static pages and the animation page.

usage: python3 gen2.py <output dir>
"""
import html as H, math, os, re, sys

OUT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
read = lambda f: open(os.path.join(HERE, f)).read()

STYLE = """
  .st { fill: var(--sheet, #ffffff); stroke: var(--ink, #1f2b33); stroke-width: 1.6; }
  .comp { fill: none; stroke: var(--ink, #1f2b33); stroke-width: 1.4; }
  .flt { fill: var(--act-tint, #fbefdc); stroke: var(--act, #b86a00); stroke-width: 1.6; }
  .note { fill: var(--bg, #f3f5f6); stroke: var(--muted, #5c6b75); stroke-width: 1.2; stroke-dasharray: 4 3; }
  .div { stroke: var(--ink, #1f2b33); stroke-opacity: .35; stroke-width: 1; }
  .tr { fill: none; stroke: var(--ink, #1f2b33); stroke-width: 1.5; }
  .trc { fill: none; stroke: var(--sensor, #0f7f8c); stroke-width: 1.5; }
  .dot { fill: var(--ink, #1f2b33); }
  .ah { fill: var(--ink, #1f2b33); }
  .ahc { fill: var(--sensor, #0f7f8c); }
  text { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; fill: var(--ink, #1f2b33); white-space: pre; }
  .nm { font-family: "IBM Plex Sans", system-ui, sans-serif; font-weight: 600; font-size: 14px; }
  .ttl { font-family: "IBM Plex Sans", system-ui, sans-serif; font-weight: 600; font-size: 13px; fill: var(--muted, #5c6b75); }
  .ac { font-size: 11.5px; fill: var(--muted, #5c6b75); }
  .lb { font-size: 12px; fill: var(--sensor, #0f7f8c); }
  .lbk { font-size: 12px; fill: var(--ink, #1f2b33); }
"""

class D:
    def __init__(self, w, h, label, prefix):
        self.w, self.h, self.label, self.prefix, self.p = w, h, label, prefix, []
    def add(self, s): self.p.append(s)
    def state(self, x, y, w, h, name, lines=(), cls="st", composite=False):
        self.add(f'<g id="s-{self.prefix}-{name}" class="state">')
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" class="{cls}"/>')
        self.add(f'<text x="{x+w/2}" y="{y+21}" text-anchor="middle" class="nm">{H.escape(name)}</text>')
        if lines:
            self.add(f'<line x1="{x}" y1="{y+30}" x2="{x+w}" y2="{y+30}" class="div"/>')
            for i, l in enumerate(lines):
                self.add(f'<text x="{x+12}" y="{y+48+i*16}" class="ac">{H.escape(l)}</text>')
        if composite:  # UML composite-state glyph
            gx, gy = x+w-40, y+h-18
            self.add(f'<rect x="{gx}" y="{gy}" width="10" height="8" rx="3" class="comp"/>'
                     f'<rect x="{gx+20}" y="{gy}" width="10" height="8" rx="3" class="comp"/>'
                     f'<line x1="{gx+10}" y1="{gy+4}" x2="{gx+20}" y2="{gy+4}" class="comp"/>')
        self.add('</g>')
    def superstate(self, x, y, w, h, name, note=None):
        self.add(f'<g id="s-{self.prefix}-{name}" class="state super">')
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" class="st"/>')
        self.add(f'<text x="{x+18}" y="{y+24}" class="ttl">{H.escape(name)}</text>')
        if note:
            self.add(f'<text x="{x+w-14}" y="{y+24}" text-anchor="end" class="ac">{H.escape(note)}</text>')
        self.add('</g>')
    def box(self, x, y, w, h, title, sub):
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" class="st"/>')
        self.add(f'<text x="{x+w/2}" y="{y+24}" text-anchor="middle" class="nm">{H.escape(title)}</text>')
        self.add(f'<text x="{x+w/2}" y="{y+43}" text-anchor="middle" class="ac">{H.escape(sub)}</text>')
    def init(self, x, y): self.add(f'<circle cx="{x}" cy="{y}" r="7" class="dot"/>')
    def choice(self, x, y, r=16):
        self.add(f'<path d="M{x} {y-r} L{x+r} {y} L{x} {y+r} L{x-r} {y} z" class="st"/>')
    def edge(self, pts, label=None, lx=0, ly=0, anchor="start", cls="tr", dashed=False, head=True, key=None):
        self.add(f'<g id="t-{self.prefix}-{key}" class="trans">' if key else '<g class="trans">')
        d = "M" + " L".join(f"{a} {b}" for a, b in pts)
        dash = ' stroke-dasharray="5 4"' if dashed else ""
        self.add(f'<path d="{d}" class="{cls}"{dash}/>')
        (x1, y1), (x2, y2) = pts[-2], pts[-1]
        a = math.degrees(math.atan2(y2-y1, x2-x1))
        if head:
            ah = "ahc" if cls == "trc" else "ah"
            self.add(f'<path d="M0 0 L-10 -4.5 L-10 4.5 z" class="{ah}" transform="translate({x2} {y2}) rotate({a:.1f})"/>')
        if label:
            self.add(f'<text x="{lx}" y="{ly}" text-anchor="{anchor}" class="{"lb" if cls == "tr" else "lbk"}">{H.escape(label)}</text>')
        self.add('</g>')
    def text(self, x, y, s, anchor="start", cls="ac"):
        self.add(f'<text x="{x}" y="{y}" text-anchor="{anchor}" class="{cls}">{H.escape(s)}</text>')
    def note(self, x, y, w, lines, key=None):
        h = 16 + 16*len(lines)
        self.add(f'<g id="t-{self.prefix}-{key}" class="trans">' if key else '<g>')
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" class="note"/>')
        for i, l in enumerate(lines):
            self.add(f'<text x="{x+12}" y="{y+22+i*16}" class="ac">{H.escape(l)}</text>')
        self.add('</g>')
    def svg(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" role="img" aria-label="{H.escape(self.label)}">'
                f'<style>{STYLE}</style>\n' + "\n".join(self.p) + "\n</svg>")

# 0 — overview / communication
d0 = D(940, 240, "Communication between the state machines", "ov")
d0.box(350, 20, 240, 56, "Sorter", "B1 photoSensor B3 B4")
d0.box(60, 160, 220, 56, "Conveyor", "belt")
d0.box(360, 160, 220, 56, "Ejector 1", "valve1 · S1 S2")
d0.box(660, 160, 220, 56, "Ejector 2", "valve2 · S3 S4")
d0.edge([(370, 76), (170, 160)], "run, stop", 250, 108, "end", cls="trc")
d0.edge([(450, 76), (450, 160)], "push", 440, 124, "end", cls="trc")
d0.edge([(490, 160), (490, 76)], "done", 500, 124, cls="trc")
d0.edge([(570, 76), (750, 160)], "push", 655, 142, "end", cls="trc")
d0.edge([(790, 160), (610, 76)], "done", 720, 102, cls="trc")

# 1 — ejector (generic, or one instance with concrete signal names)
def ejector(prefix="ej", valve="valve", Sin="S_in", Sout="S_out"):
    d = D(720, 350, f"Ejector state machine ({valve})", prefix)
    d.init(25, 115)
    d.edge([(32, 115), (60, 115)], key="init")
    d.state(60, 80, 210, 70, "Retracted", [f"entry / {valve} := 0"])
    d.state(480, 80, 210, 70, "Extending", [f"entry / {valve} := 1"])
    d.state(270, 260, 210, 70, "Retracting", [f"entry / {valve} := 0"])
    d.edge([(270, 115), (480, 115)], "push", 375, 107, "middle", key="push")
    d.edge([(585, 150), (585, 295), (480, 295)], f"when({Sout})", 595, 225, key="out")
    d.edge([(270, 295), (165, 295), (165, 150)], f"when({Sin}) / send done", 175, 225, key="in")
    return d

# 2 — conveyor
d2 = D(560, 200, "Conveyor state machine", "cv")
d2.state(60, 40, 170, 70, "Stopped", ["entry / belt := 0"])
d2.state(330, 40, 170, 70, "Running", ["entry / belt := 1"])
d2.edge([(230, 64), (330, 64)], "run", 280, 56, "middle", key="run")
d2.edge([(330, 94), (230, 94)], "stop", 280, 110, "middle", key="stop")
d2.init(145, 175)
d2.edge([(145, 168), (145, 110)], key="init")

# 3 — sorter
d3 = D(980, 380, "Sorter state machine", "so")
d3.init(35, 91)
d3.edge([(42, 91), (70, 91)], key="init")
d3.state(70, 55, 230, 72, "WaitPart", ["entry / conveyor.stop"])
d3.state(480, 55, 200, 72, "ToSensor", ["entry / conveyor.run"])
d3.edge([(300, 91), (480, 91)], "B1 ↑", 390, 83, "middle", key="b1")
d3.choice(580, 205)
d3.edge([(580, 127), (580, 189)], "photoSensor colour c / target := binFor(c)", 590, 160, key="b2")
d3.state(740, 170, 200, 70, "ToEnd", ["do / let part run off"])
d3.edge([(596, 205), (740, 205)], "[target = none]", 668, 197, "middle", key="toEnd")
d3.state(480, 290, 200, 72, "ToEjector", ["(belt keeps running)"])
d3.edge([(580, 221), (580, 290)], "[target = 1 or 2]", 590, 262, key="toEj")
d3.state(70, 290, 230, 72, "Ejecting", ["entry / conveyor.stop", "entry / ejector[target].push"])
d3.edge([(480, 312), (300, 312)], "B3 ↑ [target = 1]", 390, 304, "middle", key="atEj1")
d3.edge([(480, 344), (300, 344)], "B4 ↑ [target = 2]", 390, 362, "middle", key="atEj2")
d3.edge([(185, 290), (185, 127)], "ejector[target].done", 195, 212, key="done")
d3.edge([(925, 170), (925, 30), (185, 30), (185, 55)], "after(6 s)", 550, 22, "middle", key="end")

d1 = ejector()

def resolve_vars(s):
    return re.sub(r'var\(--[\w-]+,\s*([^)]+?)\)', r'\1', s)

def standalone(svg, w, h):
    s = resolve_vars(svg)
    s = s.replace('<svg ', f'<svg width="{w}" height="{h}" ', 1)
    s = s.replace('</style>', f'</style>\n<rect width="{w}" height="{h}" fill="#ffffff"/>', 1)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + s + "\n"

# --- static diagrams
os.makedirs(f"{OUT}/svg", exist_ok=True)
static = {"0_overview": d0, "1_ejector": d1, "2_conveyor": d2, "3_sorter": d3}
for k, d in static.items():
    open(f"{OUT}/svg/sm_{k}.svg", "w").write(standalone(d.svg(), d.w, d.h))
page = read("state_machines.tmpl.html")
for k, d in static.items():
    page = page.replace(f"{{{{{k}}}}}", d.svg())
open(f"{OUT}/state_machines.html", "w").write(page)

# --- schematic: static (with sample parts) and live (empty)
sch = read("schematic.svg.tmpl")
sample = ('<circle cx="210" cy="270" r="22" class="pw"/><circle cx="300" cy="270" r="22" class="pr"/>'
          '<circle cx="610" cy="270" r="22" class="pb"/><circle cx="500" cy="380" r="9" class="pr"/>'
          '<circle cx="700" cy="380" r="9" class="pb"/><circle cx="922" cy="270" r="9" class="pw"/>')
sch_static = sch.replace("{{static_parts}}", sample)
open(f"{OUT}/sorting_station.svg", "w").write(standalone(sch_static, 1000, 545))
open(f"{OUT}/sorting_station.html", "w").write(read("station.tmpl.html").replace("{{schematic}}", sch_static))

# --- animation page
anim = read("animation.tmpl.html")
parts = {
    "schematic": sch.replace("{{static_parts}}", ""),
    "sorter": d3.svg(), "conveyor": d2.svg(),
    "ej1": ejector("e1", "valve1", "S1", "S2").svg().replace('viewBox="0 0 720 350"', 'viewBox="10 66 700 276"'),
    "ej2": ejector("e2", "valve2", "S3", "S4").svg().replace('viewBox="0 0 720 350"', 'viewBox="10 66 700 276"'),
    "script": read("animation.js"),
}
for k, v in parts.items():
    anim = anim.replace(f"{{{{{k}}}}}", v)
open(f"{OUT}/animation.html", "w").write(anim)
print("ok")
