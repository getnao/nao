"""Builds the mockup screens of the multi-model testing proposal as HTML, then screenshots them to PNG.

Run: python3 -I build.py   (needs Google Chrome)
"""

import pathlib
import subprocess

HERE = pathlib.Path(__file__).parent
OUT = HERE / "screens"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WIDTH = 1180

MODELS = {
    "sonnet-5-5": {"color": "#2a78d6", "provider": "Anthropic"},
    "gpt-5.1": {"color": "#eb6834", "provider": "OpenAI"},
    "haiku-5-5": {"color": "#6250d6", "provider": "Anthropic"},
    "gemini-3-pro": {"color": "#eda100", "provider": "Google"},
}

CSS = """
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono&display=swap');
:root{--background:oklch(1 0 0);--foreground:oklch(0 0 0 / .85);--muted:oklch(.94 0 0);--mf:oklch(0 0 0 / .5);
--accent:oklch(.94 0 0);--border:oklch(0 0 0 / .1);--primary:oklch(.5077 .281 277.89);--pf:oklch(.984 .003 247.858);
--ring:oklch(.5077 .281 277.89 / .45);--ok:#16a34a;--ko:oklch(.577 .245 27.325);--fl:#d97706;--radius:10px;
--sans:'Geist',-apple-system,Inter,sans-serif;--mono:'Geist Mono',Menlo,monospace}
*{box-sizing:border-box}
html{background:#f6f6f7;padding:22px}
body{margin:0;font-family:var(--sans);font-size:12px;color:var(--foreground);line-height:1.4;width:%dpx}
.cap{font-size:15px;font-weight:600;margin:0 2px 4px}.sub{font-size:12.5px;color:var(--mf);margin:0 2px 12px}
.drawer{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--background);position:relative;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.editor{border-bottom:1px solid var(--border);padding:10px 16px;font-family:var(--mono);font-size:12px;color:var(--mf);line-height:19px}
.editor b{color:#7c3aed;font-weight:400}
.bar{height:34px;display:flex;align-items:center;background:color-mix(in srgb,var(--muted) 35%%,transparent);border-bottom:1px solid var(--border)}
.tab{height:100%%;display:flex;align-items:center;gap:7px;padding:0 13px;border-right:1px solid var(--border);color:var(--mf);white-space:nowrap}
.tab.on{background:var(--background);color:var(--foreground)}
.tab .x{color:var(--mf);margin-left:2px}
.acts{display:flex;align-items:center;gap:6px;padding:0 8px}
.status{display:flex;align-items:center;gap:6px;color:var(--mf);padding:0 6px}
.sp{flex:1}
.btn{height:24px;display:inline-flex;align-items:center;gap:6px;padding:0 9px;border-radius:6px;font-size:12px;font-weight:500;border:1px solid transparent;white-space:nowrap}
.pri{background:var(--primary);color:var(--pf)}
.out{border-color:var(--border);background:var(--background)}
.out.open{border-color:var(--primary);box-shadow:0 0 0 3px var(--ring)}
.split{display:inline-flex}.split .btn:first-child{border-radius:6px 0 0 6px}.split .btn:last-child{border-radius:0 6px 6px 0;border-left:1px solid oklch(1 0 0 / .25);padding:0 6px}
.notice{display:flex;align-items:center;gap:12px;padding:6px 12px;border-bottom:1px solid var(--border);color:var(--mf);background:color-mix(in srgb,var(--primary) 4%%,transparent)}
.body{display:flex}
.nav{width:210px;border-right:1px solid var(--border);flex-shrink:0}
.navh{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--mf);padding:9px 12px 5px;font-weight:500}
.ni{display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);align-items:flex-start}
.ni.on{background:var(--accent)}
.ni .t{font-weight:500}.ni .s{color:var(--mf);font-size:11.5px}
.main{flex:1;min-width:0}
.mut{color:var(--mf)}.mono{font-family:var(--mono)}.strong{font-weight:500;color:var(--foreground)}
svg.i{width:14px;height:14px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-2px}
svg.s{width:12px;height:12px}
.ok{color:var(--ok)}.ko{color:var(--ko)}.fl{color:var(--fl)}
.row{display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid var(--border)}
.row .n{font-weight:500}.row .p{font-family:var(--mono);font-size:11px;color:var(--mf)}
.grow{flex:1;min-width:0}
.hdr{display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid var(--border);color:var(--mf);min-height:37px}
.d{width:8px;height:8px;border-radius:50%%;display:inline-block;margin-right:3px;background:var(--ok)}
.d.x{background:var(--ko)}
.md{width:9px;height:9px;border-radius:50%%;display:inline-block;flex-shrink:0}
.pill{display:inline-flex;gap:4px;align-items:center;padding:2px 9px;border-radius:999px;border:1px solid var(--border);color:var(--mf);font-size:11.5px;white-space:nowrap}
.pill.on{background:var(--accent);color:var(--foreground);border-color:transparent}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:7px;padding:2px}
.seg span{padding:2px 9px;border-radius:5px;color:var(--mf)}.seg span.on{background:var(--accent);color:var(--foreground);font-weight:500}
.badge{font-size:10.5px;padding:1px 7px;border-radius:999px;font-weight:500;white-space:nowrap}
.bw{background:color-mix(in srgb,var(--ok) 13%%,transparent);color:#15803d}
.bv{background:color-mix(in srgb,var(--primary) 11%%,transparent);color:var(--primary)}
.bk{background:color-mix(in srgb,var(--ko) 11%%,transparent);color:var(--ko)}
table{width:100%%;border-collapse:collapse;font-size:12px}
th{font-weight:500;text-align:left;color:var(--mf);font-size:11px;padding:6px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:6px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
tr:last-child td{border-bottom:0}
.num{text-align:right;font-variant-numeric:tabular-nums}
.best{color:#15803d;font-weight:600}
.up{color:#15803d;font-weight:500}.down{color:var(--ko);font-weight:500}
.meter{display:inline-block;width:52px;height:5px;border-radius:3px;background:var(--muted);vertical-align:middle;margin-right:8px;overflow:hidden}
.meter i{display:block;height:100%%;background:var(--foreground);opacity:.55}
.sec{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--mf);font-weight:500;padding:12px 12px 4px;display:flex;justify-content:space-between;align-items:center}
.sec .r{text-transform:none;letter-spacing:0;font-size:11px;font-weight:400}
.pop{position:absolute;width:380px;background:var(--background);border:1px solid var(--border);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.14);font-size:12.5px;z-index:3}
.pop .h{display:flex;justify-content:space-between;padding:11px 14px 6px;font-weight:600}
.opt{display:flex;align-items:center;gap:9px;padding:6px 14px}
.opt.dim{color:var(--mf)}
.cb{width:15px;height:15px;border-radius:4px;border:1px solid oklch(0 0 0 / .25);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--background)}
.cb.on{background:var(--primary);border-color:var(--primary);color:var(--pf)}
.cb svg{width:11px;height:11px;stroke-width:3}
.hr{height:1px;background:var(--border);margin:6px 0}
.step{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:6px;height:26px}
.step span{width:26px;text-align:center;color:var(--mf)}.step b{width:26px;text-align:center;border-left:1px solid var(--border);border-right:1px solid var(--border);line-height:24px}
.est{background:var(--accent);border-radius:8px;margin:6px 14px 12px;padding:8px 10px}
.k{font-size:10.5px;color:var(--mf);border:1px solid var(--border);border-radius:4px;padding:0 5px}
.dis td{background:color-mix(in srgb,var(--fl) 6%%,transparent)}
.atabs{display:flex;align-items:center;gap:2px;padding:0 12px;border-bottom:1px solid var(--border)}
.at{padding:8px 9px;font-weight:500;color:var(--mf);border-bottom:2px solid transparent;margin-bottom:-1px}
.at.on{color:var(--foreground);border-color:var(--primary)}
.chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);border-radius:6px;padding:2px 7px;color:var(--mf);white-space:nowrap}
.chip.on{border-color:color-mix(in srgb,var(--primary) 45%%,transparent);background:color-mix(in srgb,var(--primary) 6%%,transparent);color:var(--foreground)}
.cdiff{background:color-mix(in srgb,var(--ko) 10%%,transparent);color:var(--ko)}
.stats{display:flex;border-bottom:1px solid var(--border)}
.st{flex:1;padding:9px 12px;border-right:1px solid var(--border)}
.st:last-child{border-right:0}
.st .l{font-size:11px;color:var(--mf)}
.st .v{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
.st .dl{font-size:11px;font-weight:500;margin-left:6px}
.mx{display:flex;gap:18px;color:var(--mf);font-variant-numeric:tabular-nums}
.mx span{min-width:46px;text-align:right}
.tag{font-size:11px;border:1px solid var(--border);border-radius:999px;padding:0 7px;color:var(--mf);font-weight:400;margin-left:4px}
.mm{display:inline-flex;align-items:center;gap:10px}
.mm span{display:inline-flex;align-items:center;gap:3px}
.tip{position:absolute;background:var(--background);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:8px 10px;font-size:11.5px;line-height:1.5;z-index:2}
.legend{display:flex;gap:14px;align-items:center;color:var(--mf);font-size:11.5px;flex-wrap:wrap}
.legend span{display:inline-flex;align-items:center;gap:5px}
""" % WIDTH

ICONS = """<svg width="0" height="0" style="position:absolute"><defs>
<symbol id="ok" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></symbol>
<symbol id="ko" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></symbol>
<symbol id="fl" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="4 3"/></symbol>
<symbol id="nv" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="2 3"/></symbol>
<symbol id="play" viewBox="0 0 24 24"><path d="M6 3l14 9-14 9z" fill="currentColor"/></symbol>
<symbol id="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
<symbol id="chevu" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></symbol>
<symbol id="check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
<symbol id="close" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></symbol>
<symbol id="max" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></symbol>
<symbol id="cpu" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/></symbol>
<symbol id="cmp" viewBox="0 0 24 24"><circle cx="5" cy="6" r="3"/><path d="M12 6h5a2 2 0 0 1 2 2v7"/><path d="m15 9-3-3 3-3"/><circle cx="19" cy="18" r="3"/><path d="M12 18H7a2 2 0 0 1-2-2V9"/><path d="m9 15 3 3-3 3"/></symbol>
<symbol id="file" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></symbol>
<symbol id="msg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></symbol>
<symbol id="spin" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></symbol>
</defs></svg>"""


def icon(name, cls=""):
    return f'<svg class="i {cls}"><use href="#{name}"/></svg>'


def status_icon(passed, total):
    if total == 0:
        return icon("nv", "mut")
    if passed == total:
        return icon("ok", "ok")
    if passed == 0:
        return icon("ko", "ko")
    return icon("fl", "fl")


def small_status_icon(passed, total):
    return status_icon(passed, total).replace('class="i ', 'class="i s ')


def dots(outcomes):
    return "".join('<i class="d"></i>' if passed else '<i class="d x"></i>' for passed in outcomes)


def model_name(model, bold=False):
    color = MODELS[model]["color"]
    name = f"<b>{model}</b>" if bold else model
    return f'<span style="display:inline-flex;align-items:center;gap:7px"><i class="md" style="background:{color}"></i>{name}</span>'


def tab(label, active=False, file=False, closable=False, toggle=None):
    lead = icon(toggle) if toggle else (icon("file", "mut") if file else "")
    close = icon("close", "s x") if closable else ""
    return f'<span class="tab{" on" if active else ""}">{lead}{label}{close}</span>'


def bar(tabs, actions="", status=""):
    status_html = f'<span class="status">{status}</span>' if status else ""
    return f'<div class="bar">{"".join(tabs)}<span class="sp"></span>{status_html}<span class="acts">{actions}</span></div>'


def models_chip(label, is_open=False):
    return f'<span class="btn out{" open" if is_open else ""}">{icon("cpu")}{label}{icon("chev", "mut")}</span>'


def run_button(label):
    return f'<span class="btn pri">{icon("play")}{label}</span>'


def compare_button(label):
    return f'<span class="split"><span class="btn pri">{icon("cmp")}{label}</span><span class="btn pri">{icon("chev")}</span></span>'


def nav(items, header="Recent runs", footer=None):
    html = f'<div class="navh">{header}</div>' if header else ""
    for item in items:
        icon_html, title, subtitle = item[:3]
        active = len(item) > 3 and item[3]
        html += f'<div class="ni{" on" if active else ""}">{icon_html}<div><div class="t">{title}</div><div class="s">{subtitle}</div></div></div>'
    if footer:
        html += f'<div class="ni" style="border:0"><span class="mut" style="padding-left:22px">{footer}</span></div>'
    return f'<div class="nav">{html}</div>'


def page(title, subtitle, content):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>{ICONS}
<div class="cap">{title}</div><div class="sub">{subtitle}</div>{content}</body></html>"""


# ── chart ──────────────────────────────────────────────────────────────────────


def tradeoff_chart(series, *, width, height, x_max, x_ticks, x_format, x_label, y_min, y_ticks, y_format, label_offsets, hover=None):
    """Accuracy (y) against a cost-like metric (x, reversed so that up and right is better), one arrow per model."""
    left, right, top, bottom = 44, 16, 14, 34
    plot_w, plot_h = width - left - right, height - top - bottom

    def x_pos(value):
        return left + (x_max - value) / x_max * plot_w

    def y_pos(value):
        return top + (100 - value) / (100 - y_min) * plot_h

    parts = [f'<svg width="{width}" height="{height}" style="display:block;font-family:var(--sans)">']
    parts.append('<defs>' + "".join(
        f'<marker id="a-{i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{MODELS[s["model"]]["color"]}"/></marker>'
        for i, s in enumerate(series)) + '</defs>')
    for tick in y_ticks:
        y = y_pos(tick)
        parts.append(f'<line x1="{left}" x2="{width - right}" y1="{y}" y2="{y}" stroke="oklch(0 0 0 / .07)"/>')
        parts.append(f'<text x="{left - 8}" y="{y + 4}" text-anchor="end" font-size="11" fill="oklch(0 0 0 / .5)">{y_format(tick)}</text>')
    for tick in x_ticks:
        x = x_pos(tick)
        parts.append(f'<line x1="{x}" x2="{x}" y1="{top}" y2="{top + plot_h}" stroke="oklch(0 0 0 / .05)"/>')
        parts.append(f'<text x="{x}" y="{top + plot_h + 16}" text-anchor="middle" font-size="11" fill="oklch(0 0 0 / .5)">{x_format(tick)}</text>')
    parts.append(f'<text x="{left + plot_w / 2}" y="{height - 2}" text-anchor="middle" font-size="11" fill="oklch(0 0 0 / .5)">{x_label}</text>')
    parts.append(f'<text x="{width - right - 2}" y="{top + 12}" text-anchor="end" font-size="11" fill="oklch(0 0 0 / .4)">better ↗</text>')

    for i, s in enumerate(series):
        color = MODELS[s["model"]]["color"]
        (x0, y0), (x1, y1) = (x_pos(s["before"][0]), y_pos(s["before"][1])), (x_pos(s["after"][0]), y_pos(s["after"][1]))
        length = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
        if length > 14:
            shrink = 9 / length
            x1a, y1a = x1 - (x1 - x0) * shrink, y1 - (y1 - y0) * shrink
            x0a, y0a = x0 + (x1 - x0) * 6 / length, y0 + (y1 - y0) * 6 / length
            parts.append(f'<line x1="{x0a}" y1="{y0a}" x2="{x1a}" y2="{y1a}" stroke="{color}" stroke-width="2" marker-end="url(#a-{i})"/>')
        parts.append(f'<circle cx="{x0}" cy="{y0}" r="4.5" fill="#fff" stroke="{color}" stroke-width="2"/>')
        parts.append(f'<circle cx="{x1}" cy="{y1}" r="5.5" fill="{color}" stroke="#fff" stroke-width="2"/>')
        dx, dy, anchor = label_offsets[s["model"]]
        parts.append(f'<text x="{x1 + dx}" y="{y1 + dy}" text-anchor="{anchor}" font-size="11.5" font-weight="500" fill="oklch(0 0 0 / .85)">{s["model"]}'
                     f'<tspan font-weight="400" fill="oklch(0 0 0 / .5)"> {s["delta"]}</tspan></text>')
    if hover:
        s = next(item for item in series if item["model"] == hover)
        x1, y1 = x_pos(s["after"][0]), y_pos(s["after"][1])
        parts.append(f'<circle cx="{x1}" cy="{y1}" r="11" fill="none" stroke="{MODELS[hover]["color"]}" stroke-opacity=".35" stroke-width="5"/>')
    parts.append("</svg>")
    return "".join(parts)


def chart_legend():
    return ('<div class="legend"><span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="#fff" stroke="#555" stroke-width="2"/></svg>Production</span>'
            '<span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#555"/></svg>Your changes</span>'
            + "".join(f'<span><i class="md" style="background:{m["color"]}"></i>{name}</span>' for name, m in MODELS.items())
            + "</div>")


# ── screens ────────────────────────────────────────────────────────────────────

TESTS = [
    ("Total revenue", "total_revenue.yml", ["revenue"]),
    ("Monthly revenue by payment method", "monthly_revenue_by_payment_method.yml", ["revenue"]),
    ("Net revenue growth by month", "net_revenue_growth_by_month.yml", ["revenue", "growth"]),
    ("New vs returning revenue", "new_vs_returning_revenue.yml", ["revenue", "customers"]),
    ("Repeat customer rate", "repeat_customer_rate.yml", ["customers"]),
    ("Top customers by lifetime value", "top_customers_by_lifetime_value.yml", ["customers"]),
]

SUITE_RUNS = [
    (icon("fl", "fl"), "83% passed", "6 tests · Léa · 1h ago"),
    (icon("ok", "ok"), "Prod 67% → 83%", "Compared 6 tests · 3h ago"),
    (icon("ok", "ok"), "100% passed", "repeat_customer_rate · 1d ago"),
    (icon("ko", "ko"), "50% passed", "6 tests · 2d ago"),
]


def screen_pick_models():
    tests = "".join(
        f'<div class="row"><span class="cb"></span>{status_icon(*outcome)}<div class="grow"><div class="n">{name}</div><div class="p">tests/{path}</div></div><span class="mut">{when}</span></div>'
        for (name, path, _), outcome, when in zip(TESTS, [(1, 1), (1, 1), (0, 1), (2, 3), (1, 1), (1, 1)], ["1h ago"] * 6))
    popover = f"""<div class="pop" style="right:8px;top:152px">
  <div class="h"><span>Models to test</span><span class="mut" style="font-weight:400;font-size:11.5px">default: nao_config.yaml</span></div>
  <div class="opt"><span class="cb on">{icon("check")}</span>{model_name("sonnet-5-5")}<span class="k">default</span><span class="grow"></span><span class="mut">$0.041/q · 14s</span></div>
  <div class="opt"><span class="cb on">{icon("check")}</span>{model_name("gpt-5.1")}<span class="grow"></span><span class="mut">no history yet</span></div>
  <div class="opt"><span class="cb on">{icon("check")}</span>{model_name("haiku-5-5")}<span class="grow"></span><span class="mut">$0.009/q · 9s</span></div>
  <div class="opt dim"><span class="cb"></span>{model_name("gemini-3-pro")}<span class="grow"></span><span>$0.028/q · 12s</span></div>
  <div class="hr"></div>
  <div class="opt"><span class="grow">Attempts per test</span><span class="step"><span>−</span><b>3</b><span>+</span></span></div>
  <div class="opt mut" style="padding-top:0;font-size:11.5px">Several attempts reveal flaky answers.</div>
  <div class="est"><b>54 attempts</b> <span class="mut">= 6 tests × 3 models × 3</span><br>≈ <b>$1.40</b> · about 6 min <span class="mut">· from past runs</span></div>
  <div class="opt" style="padding-bottom:12px"><span class="grow mut" style="font-size:11.5px">Remembered in this browser</span><span class="btn out">Save as project default</span></div>
</div>"""
    content = f"""<div class="drawer" style="height:520px">
  <div class="editor"><b>name:</b> Repeat customer rate<br><b>prompt:</b> What share of customers ordered more than once?<br><b>sql:</b> |<br>&nbsp;&nbsp;select count_if(orders &gt; 1) / count(*) as repeat_rate from customers</div>
  {bar([tab("All tests (6)", True, toggle="chev"), tab("repeat_customer_rate.yml", file=True, closable=True)],
       models_chip("3 models · ×3", True) + run_button("Benchmark 6 tests"))}
  <div class="body">{nav(SUITE_RUNS)}
    <div class="main">
      <div class="hdr"><span class="cb"></span><span>6 tests</span><span class="pill">Tags: all {icon("chev", "s")}</span><span class="grow"></span><span>Last run</span></div>
      {tests}
    </div>
  </div>
  {popover}
</div>"""
    return page("① Pick the models next to Run",
                "The actions live in the drawer's tab row, so there is no toolbar line. One model runs the tests as today; several turn the button into “Benchmark”.",
                content)


def screen_benchmark():
    leaderboard = [
        ("sonnet-5-5", '<span class="badge bw">Most accurate</span>', 94, "5/6", "$0.041", "$0.043", "6.2", "14.1s", "21.3k", {"acc", "rel"}),
        ("gpt-5.1", "", 83, "4/6", "$0.033", "$0.040", "4.8", "10.9s", "16.8k", {"tools", "tok"}),
        ("haiku-5-5", '<span class="badge bv">Best value</span>', 72, "3/6", "$0.009", "$0.012", "7.9", "8.7s", "19.0k", {"q", "c", "time"}),
    ]
    keys = ["acc", "rel", "q", "c", "tools", "time", "tok"]
    rows = ""
    for model, badge, acc, rel, q, c, tools, time, tok, best in leaderboard:
        values = [f'<span class="meter"><i style="width:{acc}%"></i></span>{acc}%', rel, q, c, tools, time, tok]
        cells = "".join(f'<td class="{"num " if i else ""}{"best" if k in best else ""}">{v}</td>' for i, (k, v) in enumerate(zip(keys, values)))
        rows += f"<tr><td>{model_name(model, True)} {badge}</td>{cells}</tr>"
    matrix = [
        ([1, 1, 1], [1, 1, 1], [1, 1, 1]),
        ([1, 1, 1], [1, 1, 1], [1, 1, 0]),
        ([1, 1, 1], [1, 1, 0], [0, 0, 0]),
        ([1, 1, 1], [1, 0, 0], [1, 1, 0]),
        ([1, 1, 0], [1, 1, 1], [1, 1, 1]),
        ([1, 1, 1], [1, 1, 1], [1, 1, 1]),
    ]

    def cell(outcomes):
        passed = sum(outcomes)
        tail = "" if passed == 3 else f' <span class="{"ko" if passed == 0 else "mut"}">{passed}/3</span>'
        return f"<td>{dots(outcomes)}{tail}</td>"

    matrix_rows = "".join(
        f'<tr class="{"dis" if len({sum(c) for c in cells}) > 1 else ""}"><td>{name}</td>{"".join(cell(c) for c in cells)}</tr>'
        for (name, _, _), cells in zip(TESTS, matrix))
    content = f"""<div class="drawer">
  {bar([tab("All tests (6)", True, toggle="chev"), tab("repeat_customer_rate.yml", file=True, closable=True)],
       models_chip("3 models · ×3") + run_button("Benchmark 6 tests") + f'<span class="mut" style="padding:0 4px">{icon("max")}</span>')}
  <div class="body">{nav([(icon("fl", "fl"), "3 models · best 94%", "6 tests · you · 2m ago", True)] + SUITE_RUNS[:3])}
    <div class="main">
      <div class="hdr"><span class="pill on">All 6</span><span class="pill">Models disagree 4</span><span class="pill">Failed 4</span><span class="grow"></span><span>Production · ×3 · 54 attempts · $1.49 · 5m 12s</span><span class="seg"><span class="on">Table</span><span>Chart</span></span></div>
      <table>
        <thead><tr><th>Model</th><th>Accuracy</th><th class="num">Reliable</th><th class="num">$ / question</th><th class="num">$ / correct</th><th class="num">Tool calls</th><th class="num">Time</th><th class="num">Tokens</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
      <div class="sec" style="border-top:1px solid var(--border)"><span>Tests × models</span><span class="r"><i class="d"></i>passed &nbsp;<i class="d x"></i>failed · one dot per attempt · click a cell to open that test on that model</span></div>
      <table><thead><tr><th>Test</th><th>{model_name("sonnet-5-5")}</th><th>{model_name("gpt-5.1")}</th><th>{model_name("haiku-5-5")}</th></tr></thead><tbody>{matrix_rows}</tbody></table>
    </div>
  </div>
</div>"""
    return page("② A benchmark on production: leaderboard, then test × model matrix",
                "Best value of each metric in green. “Reliable” counts the tests where every attempt passed. “$ / correct” = cost ÷ passed attempts, so cheap but wrong answers rank poorly. Rows where the models disagree are tinted.",
                content)


SUITE_SERIES = [
    {"model": "sonnet-5-5", "before": (0.046, 83), "after": (0.041, 94), "delta": "+11 pts · −11% $"},
    {"model": "gpt-5.1", "before": (0.036, 72), "after": (0.033, 83), "delta": "+11 pts · −8% $"},
    {"model": "haiku-5-5", "before": (0.012, 50), "after": (0.009, 72), "delta": "+22 pts · −25% $"},
    {"model": "gemini-3-pro", "before": (0.029, 78), "after": (0.031, 72), "delta": "−6 pts · +7% $"},
]


def screen_comparison_chart():
    chart = tradeoff_chart(
        SUITE_SERIES, width=550, height=330, x_max=0.05, x_ticks=[0.05, 0.04, 0.03, 0.02, 0.01, 0],
        x_format=lambda v: f"${v:.2f}", x_label="Average cost per question", y_min=40, y_ticks=[40, 50, 60, 70, 80, 90, 100],
        y_format=lambda v: f"{v}%",
        label_offsets={"sonnet-5-5": (10, 4, "start"), "gpt-5.1": (10, 4, "start"), "haiku-5-5": (-12, -12, "end"), "gemini-3-pro": (0, 20, "middle")},
        hover="haiku-5-5")
    delta_rows = [
        ("sonnet-5-5", "83% → 94%", "up", "$0.046 → $0.041", "up", "7.4 → 6.2", "up"),
        ("gpt-5.1", "72% → 83%", "up", "$0.036 → $0.033", "up", "5.6 → 4.8", "up"),
        ("haiku-5-5", "50% → 72%", "up", "$0.012 → $0.009", "up", "9.8 → 7.9", "up"),
        ("gemini-3-pro", "78% → 72%", "down", "$0.029 → $0.031", "down", "6.1 → 6.6", "down"),
    ]
    arrow = {"up": "▲", "down": "▼"}
    table_rows = "".join(
        f'<tr><td>{model_name(m)}</td><td class="num">{a} <span class="{ad}">{arrow[ad]}</span></td><td class="num">{c} <span class="{cd}">{arrow[cd]}</span></td></tr>'
        for m, a, ad, c, cd, t, td in delta_rows)
    tooltip = """<div class="tip" style="left:418px;top:330px;width:200px">
  <div style="display:flex;align-items:center;gap:6px;font-weight:600"><i class="md" style="background:#6250d6"></i>haiku-5-5</div>
  <div><span class="mut">Production</span> 50% · $0.012/q</div>
  <div><span class="mut">Your changes</span> <b>72%</b> · <b>$0.009</b>/q</div>
  <div class="mut">18 attempts each · click to filter</div></div>"""
    content = f"""<div class="drawer">
  {bar([tab("All tests (6)", True, toggle="chev"), tab("net_revenue_growth_by_month.yml", file=True, closable=True)],
       models_chip("4 models · ×3") + compare_button("Compare 6 tests with production") + f'<span class="mut" style="padding:0 4px">{icon("max")}</span>')}
  <div class="notice">{icon("file")}<span>You changed <span class="strong">3 context files</span> on <span class="mono strong">christophe/revenue-definitions</span>: <span class="mono">semantics/revenue.md</span> · <span class="mono">databases/…/orders/columns.md</span> · <span class="mono">rules.md</span></span></div>
  <div class="body">{nav([(icon("ok", "ok"), "4 models · 3 improve", "Compared 6 tests · 2m ago", True)] + SUITE_RUNS[:3])}
    <div class="main">
      <div class="hdr"><span class="pill on">All 6</span><span class="pill">Fixed 3</span><span class="pill">Broken 1</span><span class="grow"></span><span>Production → your changes · ×3 · 144 attempts · $3.10</span><span class="seg"><span>Table</span><span class="on">Chart</span></span></div>
      <div style="display:flex">
        <div style="padding:10px 4px 4px 4px;border-right:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0 8px 4px 12px"><span class="strong">Accuracy vs. cost</span><span class="seg"><span class="on">Cost</span><span>Tokens</span><span>Tool calls</span><span>Time</span></span></div>
          {chart}
          <div style="padding:6px 12px 10px">{chart_legend()}</div>
        </div>
        <div class="grow" style="min-width:0">
          <div class="sec"><span>Production → your changes</span></div>
          <table><thead><tr><th>Model</th><th class="num">Accuracy</th><th class="num">$ / question</th></tr></thead><tbody>{table_rows}</tbody></table>
          <div style="padding:12px;color:var(--mf);line-height:1.55;border-top:1px solid var(--border)">Your changes make <span class="strong">3 of 4 models</span> more accurate and cheaper: fewer tool calls, because the agent finds the revenue definition directly.<br><span class="ko">gemini-3-pro</span> regresses on <span class="strong">Net revenue growth by month</span>.</div>
        </div>
      </div>
    </div>
  </div>
  {tooltip}
</div>"""
    return page("③ Your changes vs production, on every model: one arrow per model",
                "Hollow dot = production, filled dot = your changes. The x axis is reversed like a cost frontier, so an arrow pointing up and right means your changes made that model both more accurate and cheaper. The toggle swaps cost for tokens, tool calls or time; the table view gives the same numbers as text.",
                content)


TEST_SERIES = [
    {"model": "sonnet-5-5", "before": (0.058, 66.7), "after": (0.052, 100), "delta": "fixed"},
    {"model": "gpt-5.1", "before": (0.041, 33.3), "after": (0.038, 66.7), "delta": "improved"},
    {"model": "haiku-5-5", "before": (0.014, 0), "after": (0.011, 0), "delta": "still fails"},
    {"model": "gemini-3-pro", "before": (0.024, 66.7), "after": (0.026, 33.3), "delta": "worse"},
]


def screen_test_tab():
    chart = tradeoff_chart(
        TEST_SERIES, width=420, height=236, x_max=0.07, x_ticks=[0.06, 0.04, 0.02, 0],
        x_format=lambda v: f"${v:.2f}", x_label="Cost per question", y_min=0, y_ticks=[0, 33.3, 66.7, 100],
        y_format=lambda v: f"{round(v / 33.3)}/3",
        label_offsets={"sonnet-5-5": (10, 4, "start"), "gpt-5.1": (0, -11, "middle"), "haiku-5-5": (-12, -10, "end"), "gemini-3-pro": (0, 20, "middle")})
    models = [
        ("sonnet-5-5", [1, 1, 0], [1, 1, 1], '<span class="badge bw">Fixed</span>', "$0.052", "7.0", "15.8s"),
        ("gpt-5.1", [1, 0, 0], [1, 1, 0], '<span class="badge bw">Improved</span>', "$0.038", "5.3", "12.2s"),
        ("haiku-5-5", [0, 0, 0], [0, 0, 0], '<span class="badge" style="background:var(--accent);color:var(--mf)">Fails on both</span>', "$0.011", "9.7", "10.4s"),
        ("gemini-3-pro", [1, 1, 0], [1, 0, 0], '<span class="badge bk">Worse</span>', "$0.026", "6.6", "13.0s"),
    ]
    rows = "".join(
        f'<tr class="{"" if m != "gemini-3-pro" else "sel"}" style="{"background:var(--accent)" if m == "gemini-3-pro" else ""}"><td>{model_name(m, m == "gemini-3-pro")}</td><td>{dots(p)}</td><td>{dots(y)}</td><td>{b}</td><td class="num">{c}</td><td class="num">{t}</td><td class="num">{s}</td></tr>'
        for m, p, y, b, c, t, s in models)
    content = f"""<div class="drawer">
  {bar([tab("All tests (6)", toggle="chev"), tab("net_revenue_growth_by_month.yml", True, file=True, closable=True)],
       models_chip("4 models · ×3") + compare_button("Compare with production"))}
  <div class="body">{nav([(icon("fl", "fl"), "Fixed on 2 of 4 models", "4 models · 2m ago", True), (icon("ok", "ok"), "Passed", "Run on production · 1h ago"), (icon("ko", "ko"), "Failed", "Run on production · 1d ago")], header="Runs of this test")}
    <div class="main">
      <div class="hdr" style="color:var(--foreground)">{icon("fl", "fl")}<span><b style="font-weight:500">Fixed on 2 of 4 models</b> <span class="mut">— worse on gemini-3-pro, still failing on haiku-5-5 (<span class="mono">growth_pct</span> is a ratio, not a percentage).</span></span></div>
      <div style="display:flex;border-bottom:1px solid var(--border)">
        <div class="grow" style="border-right:1px solid var(--border)">
          <table><thead><tr><th>Model</th><th>Production</th><th>Your changes</th><th></th><th class="num">$ / question</th><th class="num">Tools</th><th class="num">Time</th></tr></thead><tbody>{rows}</tbody></table>
        </div>
        <div style="padding:8px 4px 2px">{chart}</div>
      </div>
      <div class="atabs"><span class="at on">Data</span><span class="at">Answer</span><span class="at">SQL</span><span class="at">Tool calls</span><span style="width:14px"></span>
        <span class="seg"><span>Production</span><span class="on">Your changes</span></span><span style="width:8px"></span>
        <span class="chip">{icon("ok", "ok s")}#1</span><span class="chip on">{icon("ko", "ko s")}#2</span><span class="chip">{icon("ko", "ko s")}#3</span>
        <span class="sp"></span><span class="mut">gemini-3-pro · attempt 2 · 13.4s · 7 tools · 21.0k tokens · $0.027</span><span style="padding-left:8px" class="mut">{icon("msg")}</span></div>
      <table><thead><tr><th>month</th><th class="num">expected growth_pct</th><th class="num">agent growth_pct</th><th class="num">net_revenue</th></tr></thead><tbody>
        <tr><td class="mono">2024-02</td><td class="num">12.40</td><td class="num cdiff">11.90</td><td class="num">48,210</td></tr>
        <tr><td class="mono">2024-03</td><td class="num">-3.10</td><td class="num">-3.10</td><td class="num">46,716</td></tr>
        <tr><td class="mono">2024-04</td><td class="num">8.75</td><td class="num cdiff">9.02</td><td class="num">50,804</td></tr></tbody></table>
    </div>
  </div>
</div>"""
    return page("④ One test, before / after, on every model",
                "Same chart for a single test: the y axis is the attempts that pass (0/3 … 3/3). The model table doubles as a picker, and the attempt header shows that attempt's metrics.",
                content)


def screen_single_model():
    rows = [
        (TESTS[0], (1, 1), "$0.021", "3", "7.9s", ""),
        (TESTS[1], (1, 1), "$0.038", "5", "12.6s", ""),
        (TESTS[3], (0, 1), "$0.071", "11", "24.0s", "Column new_customers missing from the answer"),
        (TESTS[4], (1, 1), "$0.033", "5", "11.1s", ""),
        (TESTS[5], (1, 1), "$0.046", "6", "13.4s", ""),
    ]
    html_rows = "".join(
        f'<div class="row">{status_icon(*o)}<div class="grow"><div class="n">{name}</div><div class="p" style="{"color:var(--ko);font-family:var(--sans)" if why else ""}">{why or "tests/" + path}</div></div>'
        f'<span class="mx"><span class="{"fl" if why else ""}">{c}</span><span class="{"fl" if why else ""}">{t}</span><span class="{"fl" if why else ""}">{s}</span></span></div>'
        for (name, path, _), o, c, t, s, why in rows)
    content = f"""<div class="drawer">
  {bar([tab("All tests (6)", True, toggle="chev")], models_chip("sonnet-5-5") + run_button("Run 6 tests"))}
  <div class="body">{nav([(icon("fl", "fl"), "83% passed", "6 tests · you · 1h ago", True)] + SUITE_RUNS[1:])}
    <div class="main">
      <div class="hdr"><span class="pill on">All 6</span><span class="pill">Failed 1</span><span class="grow"></span><span>sonnet-5-5 · production · 6 attempts</span></div>
      <div class="stats">
        <div class="st"><div class="l">Passed</div><div class="v">5/6<span class="dl up">▲ 2</span></div></div>
        <div class="st"><div class="l">$ / question</div><div class="v">$0.040<span class="dl down">▲ 12%</span></div></div>
        <div class="st"><div class="l">Tool calls / question</div><div class="v">5.8<span class="dl up">▼ 0.6</span></div></div>
        <div class="st"><div class="l">Time / question</div><div class="v">13.2s<span class="dl mut">=</span></div></div>
        <div class="st"><div class="l">Total cost</div><div class="v">$0.24</div></div>
      </div>
      <div class="row mut" style="padding-top:5px;padding-bottom:5px;font-size:11px"><span class="grow">Compared with the previous run of sonnet-5-5 (2d ago)</span><span class="mx"><span>cost</span><span>tools</span><span>time</span></span></div>
      {html_rows}
    </div>
  </div>
</div>"""
    return page("⑤ A normal single-model run shows performance too",
                "A stat strip with the change since the previous run of the same model, and cost, tool calls and time on every test. Outliers are highlighted.",
                content)


def screen_no_tests_page():
    outcomes = [
        [("sonnet-5-5", (1, 1)), ("gpt-5.1", (1, 1)), ("haiku-5-5", (2, 3))],
        [("sonnet-5-5", (1, 1)), ("gpt-5.1", (2, 3)), ("haiku-5-5", (0, 1))],
        [("sonnet-5-5", (1, 1))],
        [("sonnet-5-5", (2, 3))],
    ]
    picked = [TESTS[1], TESTS[2], TESTS[0], TESTS[3]]
    rows = ""
    for index, ((name, path, tags), per_model) in enumerate(zip(picked, outcomes)):
        checked = index < 2
        worst = min(per_model, key=lambda item: item[1][0] / item[1][1])[1]
        badges = "".join(f'<span><i class="md" style="background:{MODELS[m]["color"]}"></i>{small_status_icon(*o)}</span>' for m, o in per_model)
        rows += (f'<div class="row"><span class="cb{" on" if checked else ""}">{icon("check") if checked else ""}</span>{status_icon(*worst)}'
                 f'<div class="grow"><div class="n">{name}{"".join(f"<span class=tag>{t}</span>" for t in tags)}</div><div class="p">tests/{path}</div></div>'
                 f'<span class="mm">{badges}</span><span class="mut" style="width:70px;text-align:right">{"2m ago" if len(per_model) > 1 else "1h ago"}</span></div>')
    content = f"""<div class="drawer">
  {bar([tab("All tests (6)", True, toggle="chev")], models_chip("sonnet-5-5") + run_button("Run 2 selected") + f'<span class="mut" style="padding:0 4px">{icon("max")}</span>')}
  <div class="body">{nav([(icon("fl", "fl"), "3 models · best 94%", "Christophe · 2m ago"), (icon("fl", "fl"), "83% passed", "Léa · 1h ago"), (icon("ok", "ok"), "Prod 67% → 83%", "Christophe · 3h ago")], footer="Show all runs…")}
    <div class="main">
      <div class="hdr"><span class="cb on" style="background:var(--primary)"><svg class="i" style="width:11px;height:11px;stroke-width:3;color:#fff"><path d="M5 12h14"/></svg></span><span class="strong">2 selected</span><span class="pill on">Tags: revenue <span class="mut">×</span></span><span class="grow"></span><span>Last result per model</span><span style="width:70px;text-align:right">Ran</span></div>
      {rows}
    </div>
  </div>
</div>"""
    return page("⑥ Without the Tests page",
                "The drawer's default view takes over what the page did: tag filter, run a selection, the last result per model, and who ran what. /settings/tests?run=… redirects to the File Explorer with that run open.",
                content)


def screen_collapsed():
    content = f"""<div class="drawer">
  <div class="editor" style="border-bottom:1px solid var(--border)"><b>name:</b> Net revenue growth by month<br><b>prompt:</b> How did net revenue grow month over month in 2024?<br><b>tags:</b> [revenue, growth]<br><b>sql:</b> |<br>&nbsp;&nbsp;select month, net_revenue, 100 * (net_revenue / lag(net_revenue) over (order by month) - 1) as growth_pct<br>&nbsp;&nbsp;from monthly_revenue where year = 2024</div>
  {bar([tab("All tests (6)", toggle="chevu"), tab("net_revenue_growth_by_month.yml", file=True, closable=True)],
       models_chip("4 models · ×3") + compare_button("Compare with production"))}
</div>"""
    return page("⑦ Collapsed: run from the bar while editing",
                "The actions follow the shown tab and stay usable while the drawer is collapsed. Starting a run opens the drawer on it; while a run is active the bar shows its progress and the button becomes Cancel.",
                content)


SCREENS = {
    "1-pick-models": (screen_pick_models, 640),
    "2-benchmark": (screen_benchmark, 590),
    "3-comparison-chart": (screen_comparison_chart, 625),
    "4-test-tab": (screen_test_tab, 610),
    "5-single-model": (screen_single_model, 500),
    "6-no-tests-page": (screen_no_tests_page, 400),
    "7-collapsed": (screen_collapsed, 250),
}


def main():
    OUT.mkdir(exist_ok=True)
    for name, (build, height) in SCREENS.items():
        html_path = OUT / f"{name}.html"
        html_path.write_text(build())
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                        f"--window-size={WIDTH + 44},{height}", "--virtual-time-budget=4000",
                        f"--screenshot={OUT / f'{name}.png'}", f"file://{html_path}"], capture_output=True, check=False)
        print(OUT / f"{name}.png")


if __name__ == "__main__":
    main()
