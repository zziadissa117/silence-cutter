"""The students' Railway guide, in the exact look of his UGC Roadmap sales-call deck (16:9 pages).

Run: python3 docs/ugc-roadmap/railway_guide.py out.pdf  (needs reportlab and the Liberation fonts).
The template for anything else made for UGC Roadmap - see docs/UGC_ROADMAP_STYLE.md."""

import sys

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

OUT = sys.argv[1]
MEDIA = sys.argv[2] if len(sys.argv) > 2 else __import__('os').path.join(__import__('os').path.dirname(__file__), 'assets')
L = '/usr/share/fonts/truetype/liberation/'
pdfmetrics.registerFont(TTFont('Arial', L + 'LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('Arial-Bold', L + 'LiberationSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Mono', L + 'LiberationMono-Regular.ttf'))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold', italic='Arial', boldItalic='Arial-Bold')

# The deck's theme (ppt/theme/theme1.xml).
BG = colors.HexColor('#0A0B0E')
WHITE = colors.HexColor('#F4F3EF')
CARD = colors.HexColor('#16181D')
EDGE = colors.HexColor('#2A2D35')
LINE = colors.HexColor('#3A3E47')
MUTED = colors.HexColor('#B9BCC4')
DIM = colors.HexColor('#8A8D93')
BLUE = colors.HexColor('#86A8FF')

W, H = 960, 540
X0, X1 = 50, 910  # the deck's side margins

img = lambda name: f'{MEDIA}/{name}'
BG_TITLE, BG_CONTENT, BG_PHASE, BG_LOGO, BG_PRICE = (img(f'bg-{n}.jpeg') for n in ('title', 'content', 'phase', 'logo', 'price'))
LOGO = img('logo.png')  # the UGC ROADMAP lockup
BIG_LOGO = img('logo-glow.png')  # the glowing one
HIGHLIGHT = img('highlight-card.png')  # the blue gradient card
ROAD = img('road.png')  # the gradient road band
CHECK = img('check.png')
PHONE = img('phone.png')

REPO = 'zziadissa117/silence-cutter'
BRANCH = 'claude/cutter-lockdown-and-map'


def chip(t: str) -> str:
    """An address, branch or path to type exactly."""
    return f'<font name="Mono" size="11" backColor="#2A2D35" color="#F4F3EF">&nbsp;{t}&nbsp;</font>'


def style(size, color=MUTED, bold=False, leading=None, align=0):
    return ParagraphStyle('s', fontName='Arial-Bold' if bold else 'Arial', fontSize=size, leading=leading or size * 1.3, textColor=color, alignment=align)


def para(c, html, x, top, width, st):
    """Wrapped text from `top` (from the page's top); returns its height."""
    p = Paragraph(html, st)
    _, h = p.wrapOn(c, width, H)
    p.drawOn(c, x, H - top - h)
    return h


def spaced(c, text, x, top, size=13, color=BLUE, space=3, centre=False):
    """The deck's small spaced capitals ("PHASE 01")."""
    c.saveState()
    c.setFont('Arial-Bold', size)
    c.setFillColor(color)
    width = pdfmetrics.stringWidth(text, 'Arial-Bold', size) + space * (len(text) - 1)
    t = c.beginText(x - width / 2 if centre else x, H - top - size)
    t.setCharSpace(space)
    t.textOut(text)
    t.setCharSpace(0)
    c.drawText(t)
    c.restoreState()


def page(c, bg, number=None, logo=True):
    c.drawImage(bg, 0, 0, W, H)
    if logo:
        c.drawImage(LOGO, X0, 20, 72, 72 * 881 / 1890, mask='auto')
    if number:
        c.setFont('Arial', 11)
        c.setFillColor(DIM)
        c.drawRightString(X1 - 8, 36, str(number))


def card(c, x, top, w, h, high=False):
    if high:
        c.drawImage(HIGHLIGHT, x, H - top - h, w, h, mask='auto')
    else:
        c.setFillColor(CARD)
        c.setStrokeColor(EDGE)
        c.setLineWidth(0.75)
        c.rect(x, H - top - h, w, h, stroke=1, fill=1)


def bubble(c, x, top, label, high=False, d=45):
    """The round icon spot at the top of a card - a number in it here."""
    c.setFillColor(colors.Color(1, 1, 1, alpha=0.18) if high else colors.HexColor('#2A2D35'))
    c.circle(x + d / 2, H - top - d / 2, d / 2, stroke=0, fill=1)
    if label == 'check':
        cx, cy = x + d / 2, H - top - d / 2
        c.setStrokeColor(WHITE if high else BLUE)
        c.setLineWidth(2.6)
        c.setLineCap(1)
        c.setLineJoin(1)
        path = c.beginPath()
        path.moveTo(cx - 8, cy)
        path.lineTo(cx - 2.5, cy - 5.5)
        path.lineTo(cx + 8.5, cy + 6)
        c.drawPath(path, stroke=1, fill=0)
        return
    if label.endswith('.png'):
        s = d * 0.5
        c.drawImage(label, x + (d - s) / 2, H - top - d + (d - s) / 2, s, s, mask='auto')
        return
    c.setFont('Arial-Bold', 17)
    c.setFillColor(WHITE if high else BLUE)
    c.drawCentredString(x + d / 2, H - top - d / 2 - 6, label)


def cards(c, items, top=216, bottom=459, body_size=None):
    """A row of cards, the last one blue when it is marked high: (kicker, title, body, high)."""
    n = len(items)
    gap = 21
    w = (X1 - X0 - gap * (n - 1)) / n
    for i, (kicker, title, body, high) in enumerate(items):
        x = X0 + i * (w + gap)
        card(c, x, top, w, bottom - top, high)
        bubble(c, x + 25, top + 25, 'check' if kicker.startswith('CHECK') else '!' if kicker == 'IMPORTANT' else str(i + 1), high)
        spaced(c, kicker, x + 25, top + 87, size=11, color=WHITE if high else BLUE, space=2.5)
        y = top + 108
        y += para(c, title, x + 25, y, w - 50, style(19 if n < 4 else 17, WHITE, True, 23 if n < 4 else 21)) + 9
        size = body_size or (13 if n < 4 else 12)
        para(c, body, x + 25, y, w - 50, style(size, WHITE if high else MUTED, leading=size * 1.38))


def bar(c, html, top=476, icon=PHONE):
    """The long note under the cards (the deck's "2 to 3 modules per phase" bar)."""
    h = 43
    card(c, X0, top, X1 - X0, h)
    c.drawImage(icon, X0 + 22, H - top - h / 2 - 9, 18, 18, mask='auto')
    para(c, html, X0 + 58, top + 12, X1 - X0 - 80, style(13.5, WHITE, leading=18))


def tracker(c, active, n=8):
    """The stops along the top right, the step he is on lit."""
    d, gap = 22, 9
    x = X1 - n * d - (n - 1) * gap
    cy = H - 58
    c.setStrokeColor(LINE)
    c.setLineWidth(1.2)
    c.setDash(4, 3)
    c.line(x + d / 2, cy, X1 - d / 2, cy)
    c.setDash()
    for i in range(n):
        cx = x + d / 2 + i * (d + gap)
        on = i + 1 == active
        c.setFillColor(BLUE if on else BG)
        c.setStrokeColor(BLUE if on else LINE)
        c.circle(cx, cy, d / 2, stroke=1, fill=1)
        c.setFont('Arial-Bold', 10)
        c.setFillColor(BG if on else DIM)
        c.drawCentredString(cx, cy - 3.6, str(i + 1))


def heading(c, kicker, title, sub=None):
    if kicker:
        spaced(c, kicker, X0, 47)
    c.setFont('Arial-Bold', 40)
    c.setFillColor(WHITE)
    c.drawString(X0, H - 114, title)
    if sub:
        para(c, sub, X0, 141, 600, style(16, MUTED, leading=20))


arrow = ' → '
b = lambda t: f'<b>{t}</b>'

c = canvas.Canvas(OUT, pagesize=(W, H))
c.setTitle('Your Cutter server on Railway')
c.setAuthor('UGC Roadmap')
c.setSubject('Setting up your own Cutter server on Railway')
n = 0


def next_page():
    global n
    if n:
        c.showPage()
    n += 1
    return n


# 1. Cover
next_page()
page(c, BG_TITLE, logo=False)
c.drawImage(img('logo-cover.png'), 58, H - 100, 105, 105 * 881 / 1890, mask='auto')
c.setFont('Arial-Bold', 40)
c.setFillColor(WHITE)
for i, line in enumerate(['Your own Cutter server,', 'making videos', 'day and night']):
    c.drawString(65, H - 225 - i * 52, line)
para(c, 'Set it up on Railway in about 20 minutes, once.', 65, 378, 460, style(17, MUTED))

# 2. The eight steps
p = next_page()
page(c, BG_CONTENT, p)
c.setFont('Arial-Bold', 40)
c.setFillColor(WHITE)
c.drawString(X0, H - 81, 'Eight steps, and your server is live')
road_top, road_h = 170, 43
c.drawImage(ROAD, X0, H - road_top - road_h, 840, road_h, mask='auto')
c.setFillColor(BLUE)
c.circle(X0 + 857, H - road_top - road_h / 2, 15, stroke=0, fill=1)
steps = [
    ('Fork the code', 'Your own copy on GitHub, every branch.'),
    ('Create the project', 'Railway builds from your copy.'),
    ('Pick the branch', 'The server branch, Root empty.'),
    ('Web address', 'Generate Domain, port 8080.'),
    ('Add a volume', 'Its hard drive, at /data.'),
    ('Keep it running', 'Health check and restarts.'),
    ('First deploy', 'About 5 minutes, then check it.'),
    ('Connect', 'Paste it in the Cutter.'),
]
col = 840 / 8
c.setDash(9, 7)
c.setStrokeColor(BG)
c.setLineWidth(3)
c.line(X0 + 25, H - road_top - road_h / 2, X0 + 830, H - road_top - road_h / 2)
c.setDash()
for i, (name, line) in enumerate(steps):
    cx = X0 + 26 + i * col
    c.setFillColor(BG)
    c.setStrokeColor(colors.white)
    c.setLineWidth(2.2)
    c.circle(cx, H - road_top - road_h / 2, 22, stroke=1, fill=1)
    c.setFont('Arial-Bold', 21)
    c.setFillColor(colors.white)
    c.drawCentredString(cx, H - road_top - road_h / 2 - 7.5, str(i + 1))
    x = X0 + i * col
    spaced(c, f'STEP {i + 1:02d}', x, 250, size=9.5, space=1.8)
    h = para(c, name, x, 268, col - 12, style(14.5, WHITE, True, 18))
    para(c, line, x, 268 + h + 7, col - 12, style(11.5, MUTED, leading=15))
bar(c, 'You need: a computer, a free GitHub account, and Railway on the <b>Hobby</b> plan - the free plan is too small for it.', top=430)

# 3. Before you start
p = next_page()
page(c, BG_PHASE, p)
heading(c, 'BEFORE YOU START', 'What you need', 'Do the GitHub and Railway steps on a computer. It is much easier than on a phone.')
cards(
    c,
    [
        ('YOUR CUTTER', 'A Cutter login', 'Working on your phone (the sign-in link you were sent), with your posting accounts set up in the Cutter.', False),
        ('GITHUB', 'A GitHub account', f'Free, at {chip("github.com")}.', False),
        ('RAILWAY', 'Railway, Hobby plan', f'At {chip("railway.com")}, signed in with GitHub. The free plan is too small for it.', False),
        ('IMPORTANT', 'One server per person', 'A server makes videos only for the login that connected it first. Set up your own, and never share it.', True),
    ],
)

# 4-11. The steps
STEPS = [
    (
        'Copy the Cutter to your GitHub',
        'A fork is your own copy of the code: Railway builds it, and you get every update.',
        [
            ('ON GITHUB', 'Open the code', chip('github.com/' + REPO), False),
            ('THEN', f'Click {b("Fork")}', 'Top right of the page.', False),
            ('IMPORTANT', 'Untick "Copy the main branch only"', f'The server lives on {chip(BRANCH)}. Then click {b("Create fork")}.', True),
        ],
        None,
    ),
    (
        'Create the project on Railway',
        'Railway makes a service - a box on the screen - and starts building it.',
        [
            ('ON RAILWAY', f'{b("New Project")}', f'Then {b("Deploy from GitHub repo")}.', False),
            ('IF ASKED', 'Let Railway see your repos', 'It needs your GitHub copy to build from.', False),
            ('PICK', 'Your copy', f'{chip("your-name/silence-cutter")}. Let it build, and go on to Step 3.', True),
        ],
        None,
    ),
    (
        'Point it at the right branch',
        f'Click the service, then {b("Settings")}.',
        [
            ('SOURCE', 'Branch', f'{chip(BRANCH)} - not {chip("main")}.', False),
            ('ROOT DIRECTORY', 'Leave it empty', 'The whole code, from the top.', False),
            ('BUILD', 'Nothing to set', 'Railway finds the Dockerfile at the top of the code by itself.', True),
        ],
        None,
    ),
    (
        'Give it a web address',
        'This address is what you paste in the Cutter in Step 8.',
        [
            ('NETWORKING', f'{b("Generate Domain")}', f'{b("Settings")}{arrow}{b("Networking")}{arrow}{b("Generate Domain")}.', False),
            ('PORT', '8080', f'Type {chip("8080")} when it asks for the port.', False),
            ('COPY IT', 'Keep the address', f'It looks like {chip("https://something.up.railway.app")}.', True),
        ],
        None,
    ),
    (
        'Add a volume - its hard drive',
        'Where the server keeps your clips, your login and the videos it made.',
        [
            ('ADD', f'{b("Add Volume")}', f'Right-click the service, or {b("Settings")}.', False),
            ('MOUNT PATH', '/data', f'Type exactly {chip("/data")}.', False),
            ('IMPORTANT', 'Never skip it', 'Without the volume, everything is lost on every update.', True),
        ],
        None,
    ),
    (
        'Keep it running',
        f'Recommended. {b("Settings")}{arrow}{b("Deploy")}.',
        [
            ('HEALTHCHECK PATH', '/health', f'Type {chip("/health")}.', False),
            ('RESTART POLICY', 'Always', 'If it ever stops, Railway starts it again.', False),
            ('DONE', 'Set once', 'Nothing else to set: no keys, no variables.', True),
        ],
        None,
    ),
    (
        'Wait for the first deploy',
        'It builds the app and downloads Chrome. The build log says it uses the Dockerfile.',
        [
            ('ABOUT 5 MINUTES', 'Let it build', 'The first one is the longest.', False),
            ('GREEN', 'Done', 'The deploy turns green when it is ready.', False),
            ('CHECK IT WORKED', 'Open /health', f'{chip("https://YOUR-ADDRESS/health")} shows one line: {chip("{&quot;ok&quot;:true, ...}")}', True),
        ],
        "See the Cutter's sign-in page instead? The branch is wrong or Root Directory isn't empty: back to Step 3.",
    ),
    (
        'Connect it from your phone',
        'The server takes your login and posting accounts from the Cutter.',
        [
            ('IN THE CUTTER', f'{b("Settings")}{arrow}{b("Server")}', 'On your phone.', False),
            ('PASTE', f'Tap {b("Connect")}', 'With the address from Step 4.', False),
            ('CHECK IT WORKED', 'Connected', f'{chip("Connected · X GB free")} - your batches are made there from now on.', True),
        ],
        'Keep the Cutter open, with signal, for a while: your clips go up once each, and the server starts making.',
    ),
]
for i, (title, sub, items, note) in enumerate(STEPS):
    p = next_page()
    page(c, BG_PHASE, p)
    tracker(c, i + 1)
    heading(c, f'STEP {i + 1:02d}', title, sub)
    cards(c, items, bottom=459 if not note else 410)
    if note:
        bar(c, note, top=426)

# 12. Good to know
p = next_page()
page(c, BG_CONTENT, p)
heading(c, 'AFTER', 'Good to know', None)
rows = [
    ('Updates', f'On GitHub, open your copy, switch to the branch, {b("Sync fork")}{arrow}{b("Update branch")}. Railway rebuilds by itself; nothing is posted twice.'),
    ('Space', f'Old clips and sent videos are deleted by themselves. {b("Settings")}{arrow}{b("Server")} shows what is free. Low? Make the volume bigger.'),
    ('Back to the phone', f'{b("Settings")}{arrow}{b("Make batches on this phone again")}. The phone carries on from what the server made.'),
    ('Talking videos', 'When 3 or more wait on your phone, the server listens to them and makes them too.'),
    ('Your videos', 'Clips go only to your own server; finished videos go to your posting accounts, as from the phone.'),
]
top = 140
rw = 580
for name, line in rows:
    h = 61
    card(c, X0, top, rw, h)
    c.drawImage(CHECK, X0 + 16, H - top - h / 2 - 8, 16, 16, mask='auto')
    para(c, f'<b>{name}</b>', X0 + 46, top + 9, rw - 60, style(14, WHITE, True))
    para(c, line, X0 + 46, top + 28, rw - 62, style(11.5, MUTED, leading=14))
    top += h + 6
hx, hw = X0 + rw + 21, X1 - X0 - rw - 21
card(c, hx, 140, hw, 331, True)
bubble(c, hx + 25, 165, img('phone-white.png'), True)
spaced(c, 'THE PAYOFF', hx + 25, 300, size=11, color=WHITE, space=2.5)
para(c, 'Batches made while you sleep', hx + 25, 322, hw - 50, style(21, colors.white, True, 25))
para(c, 'Your phone can be closed. The videos still wait in Posts for your approval, as always.', hx + 25, 382, hw - 50, style(13, colors.white, leading=18))

# 13. If something is wrong
p = next_page()
page(c, BG_CONTENT, p)
c.setFont('Arial-Bold', 40)
c.setFillColor(WHITE)
c.drawString(X0, H - 81, 'If something is wrong')
fixes = [
    ('/health shows the Cutter\'s sign-in page', 'The branch is main, or Root Directory isn\'t empty. Fix it in Step 3.'),
    (f'The branch isn\'t in the list', 'The fork copied main only. Delete your fork and do Step 1 again, box unticked.'),
    ('"That isn\'t a web address"', 'Paste the whole address from Step 4, starting with https://'),
    ('Disk full, or memory ran out', 'Move to the Hobby plan; make the volume bigger.'),
    ('Everything gone after an update', 'No volume at /data. Do Step 5, then connect again.'),
    ('Connected, but nothing is made', 'Keep the Cutter open with signal; in the Batch tab, tap Start.'),
]
top = 116
for i, (what, fix) in enumerate(fixes):
    h = 50
    card(c, X0, top, X1 - X0, h, high=False)
    c.setFont('Arial-Bold', 17)
    c.setFillColor(BLUE)
    c.drawString(X0 + 18, H - top - h / 2 - 6, str(i + 1))
    para(c, f'<b>{what}</b>', X0 + 48, top + 17, 330, style(14, WHITE, True))
    fp = Paragraph(fix, style(12.5, MUTED, leading=16))
    _, fh = fp.wrapOn(c, X1 - X0 - 410, H)
    fp.drawOn(c, X0 + 395, H - top - (h + fh) / 2)
    top += h + 7

# 14. You're live
p = next_page()
page(c, BG_PRICE, p)
spaced(c, 'THE CHECKLIST', W / 2, 110, size=11, space=3, centre=True)
c.setFont('Arial-Bold', 64)
c.setFillColor(WHITE)
c.drawCentredString(W / 2, H - 205, "You're live")
para(c, 'Your batches are made on your own server from now on.', 0, 228, W, style(16, MUTED, align=1))
chips = ['Forked', 'Branch set', 'Port 8080', 'Volume /data', '/health ok', 'Connected']
cw, gap = 128, 14
x = (W - (len(chips) * cw + (len(chips) - 1) * gap)) / 2
for i, t in enumerate(chips):
    cx = x + i * (cw + gap)
    card(c, cx, 300, cw, 32)
    c.drawImage(CHECK, cx + 12, H - 300 - 23, 14, 14, mask='auto')
    c.setFont('Arial', 9.5)
    c.setFillColor(DIM)
    c.drawString(cx + 32, H - 300 - 20, f'{i + 1:02d}')
    c.setFont('Arial-Bold', 10.5)
    c.setFillColor(WHITE)
    c.drawString(cx + 50, H - 300 - 20, t)

c.save()
print('ok', OUT, n, 'pages')
