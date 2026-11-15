#!/usr/bin/env python3
"""Makes the demo mode's made-up footage (src/demo/media/): a drawn creator
talking (a robot voice from espeak-ng, with pauses and an "um" to cut),
silent reactions, app-screen product clips, two short songs and three logos.
No real person, brand or voice anywhere.

Needs: python3 + Pillow, ffmpeg, espeak-ng.
    python3 docs/guide/tools/make_demo_media.py [out_dir]
"""
import math, os, struct, subprocess, sys, tempfile, wave
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', '..', 'src', 'demo', 'media')
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)
W, H, FPS = 540, 960, 30
FONT = '/usr/share/fonts/opentype/inter/Inter-Bold.otf'
if not os.path.exists(FONT):
    FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def seconds_of(wav_path):
    with wave.open(wav_path) as w:
        return w.getnframes() / w.getframerate()

def speech(lines, tmp, name):
    """Lines of speech with pauses between them, 48 kHz mono WAV - and each
    word's rough time (spread over its line by length), kept beside the clip
    as <name>.words.json for the demo's made-up listening."""
    parts = []
    words, at = [], 0.6
    for i, (text, pause) in enumerate(lines):
        wav = os.path.join(tmp, f'{name}-{i}.wav')
        run('espeak-ng', '-v', 'en-us', '-s', '150', '-w', wav, text)
        parts.append(wav)
        length = seconds_of(wav)
        tokens = text.split()
        weights = [len(t) + 2 for t in tokens]
        start, end = at + 0.08, at + length - 0.12
        t = start
        for token, wgt in zip(tokens, weights):
            dur = (end - start) * wgt / sum(weights)
            words.append({'text': token, 'start': round(t, 3), 'end': round(t + dur * 0.92, 3)})
            t += dur
        at += length + pause
        sil = os.path.join(tmp, f'{name}-s{i}.wav')
        run('ffmpeg', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', str(pause), sil)
        parts.append(sil)
    lead = os.path.join(tmp, f'{name}-lead.wav')
    run('ffmpeg', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '0.6', lead)
    parts.insert(0, lead)
    out = os.path.join(tmp, f'{name}.wav')
    inputs = []
    for p in parts:
        inputs += ['-i', p]
    run('ffmpeg', '-y', *inputs, '-filter_complex', f'concat=n={len(parts)}:v=0:a=1,aresample=48000', out)
    import json
    with open(os.path.join(OUT, f'{name}.words.json'), 'w') as f:
        json.dump({'duration': round(seconds_of(out), 3), 'words': words}, f, indent=0)
    return out

def levels(wav_path, fps=FPS):
    with wave.open(wav_path) as w:
        rate, n = w.getframerate(), w.getnframes()
        data = struct.unpack(f'<{n}h', w.readframes(n))
    per = rate // fps
    out = []
    for i in range(0, n, per):
        chunk = data[i:i + per]
        out.append(math.sqrt(sum(x * x for x in chunk) / max(1, len(chunk))) / 32768)
    return out

def background(draw, top, bottom):
    for y in range(H):
        t = y / H
        c = tuple(int(top[k] * (1 - t) + bottom[k] * t) for k in range(3))
        draw.line([(0, y), (W, y)], fill=c)

def creator(draw, mouth, brows=0.0, look=0.0, shirt=(76, 110, 245)):
    cx, cy = W // 2 + int(look * 12), 420
    draw.ellipse([cx - 230, 700, cx + 230, 1180], fill=shirt)                      # shoulders
    draw.rectangle([cx - 45, 600, cx + 45, 720], fill=(236, 188, 150))             # neck
    draw.ellipse([cx - 150, cy - 190, cx + 150, cy + 190], fill=(241, 196, 160))   # face
    draw.chord([cx - 165, cy - 215, cx + 165, cy + 60], 180, 360, fill=(60, 40, 32))  # hair
    for side in (-1, 1):
        ex = cx + side * 58
        draw.ellipse([ex - 18, cy - 30, ex + 18, cy + 6], fill='white')
        draw.ellipse([ex - 9 + int(look * 6), cy - 21, ex + 9 + int(look * 6), cy - 3], fill=(40, 30, 30))
        by = cy - 62 - int(brows * 22)
        draw.line([(ex - 26, by + 6), (ex + 26, by)], fill=(60, 40, 32), width=8)
    open_ = max(4, int(mouth * 70))
    draw.rounded_rectangle([cx - 46, cy + 78, cx + 46, cy + 78 + open_], radius=min(20, open_ // 2), fill=(150, 50, 60))

def encode(frames_dir, audio, out, seconds=None):
    args = ['ffmpeg', '-y', '-framerate', str(FPS), '-i', os.path.join(frames_dir, '%05d.png')]
    if audio:
        args += ['-i', audio, '-c:a', 'aac', '-b:a', '96k', '-shortest']
    args += ['-c:v', 'libx264', '-preset', 'veryslow', '-crf', '30', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-movflags', '+faststart', out]
    run(*args)

def talking(name, lines, tmp, shirt, top, bottom):
    wav = speech(lines, tmp, name)
    lv = levels(wav)
    frames = os.path.join(tmp, name)
    os.makedirs(frames, exist_ok=True)
    for i, level in enumerate(lv):
        img = Image.new('RGB', (W, H))
        d = ImageDraw.Draw(img)
        background(d, top, bottom)
        creator(d, min(1.0, level * 9), brows=min(1.0, level * 4), look=math.sin(i / 40), shirt=shirt)
        img.save(os.path.join(frames, f'{i:05d}.png'))
    encode(frames, wav, os.path.join(OUT, f'{name}.mp4'))

def reaction(name, tmp, shirt, top, bottom, seconds=4):
    frames = os.path.join(tmp, name)
    os.makedirs(frames, exist_ok=True)
    for i in range(seconds * FPS):
        t = i / (seconds * FPS)
        img = Image.new('RGB', (W, H))
        d = ImageDraw.Draw(img)
        background(d, top, bottom)
        wow = min(1.0, max(0.0, (t - 0.25) * 4))
        creator(d, 0.15 + wow * 0.55, brows=wow, look=math.sin(i / 9) * (1 - wow), shirt=shirt)
        img.save(os.path.join(frames, f'{i:05d}.png'))
    encode(frames, None, os.path.join(OUT, f'{name}.mp4'))

def product(name, tmp, accent, title, seconds=5):
    frames = os.path.join(tmp, name)
    os.makedirs(frames, exist_ok=True)
    big = ImageFont.truetype(FONT, 40)
    small = ImageFont.truetype(FONT, 24)
    for i in range(seconds * FPS):
        t = i / (seconds * FPS)
        img = Image.new('RGB', (W, H), (18, 18, 24))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([40, 40, W - 40, H - 40], radius=48, fill=(250, 250, 252))
        d.rounded_rectangle([70, 80, W - 70, 190], radius=24, fill=accent)
        d.text((100, 110), title, font=big, fill='white')
        scroll = int(t * 260)
        for row in range(8):
            y = 230 + row * 110 - scroll
            if y < 210 or y > H - 120:
                continue
            d.rounded_rectangle([70, y, W - 70, y + 90], radius=20, fill=(236, 238, 245))
            d.ellipse([90, y + 18, 144, y + 72], fill=accent)
            d.rounded_rectangle([164, y + 24, 164 + 180 + (row * 37) % 120, y + 42], radius=8, fill=(190, 194, 210))
            d.rounded_rectangle([164, y + 54, 164 + 120 + (row * 53) % 90, y + 68], radius=6, fill=(215, 218, 228))
        if t > 0.6:  # the moment something happens: a big tick pops in
            r = int(min(1.0, (t - 0.6) * 6) * 90)
            d.ellipse([W // 2 - r, H // 2 - r, W // 2 + r, H // 2 + r], fill=accent)
            d.text((W // 2 - 22, H // 2 - 30), '✓', font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 56), fill='white')
        d.text((W // 2 - 60, H - 100), 'demo app', font=small, fill=(150, 150, 160))
        img.save(os.path.join(frames, f'{i:05d}.png'))
    encode(frames, None, os.path.join(OUT, f'{name}.mp4'))

def song(name, notes, seconds=20):
    """A short made-up loop: chords from sine waves with a soft beat."""
    expr = '+'.join(f'0.12*sin(2*PI*{f}*t)*(0.6+0.4*sin(2*PI*2*t))' for f in notes)
    run('ffmpeg', '-y', '-f', 'lavfi', '-i', f'aevalsrc={expr}:s=48000:d={seconds}', '-af', 'afade=t=in:d=0.5,afade=t=out:st=%d:d=1' % (seconds - 1), '-c:a', 'aac', '-b:a', '96k', os.path.join(OUT, f'{name}.m4a'))

def logo(name, text, colour):
    img = Image.new('RGBA', (400, 400), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([10, 10, 390, 390], radius=90, fill=colour)
    font = ImageFont.truetype(FONT, 170)
    box = d.textbbox((0, 0), text, font=font)
    d.text(((400 - (box[2] - box[0])) / 2 - box[0], (400 - (box[3] - box[1])) / 2 - box[1]), text, font=font, fill='white')
    img.save(os.path.join(OUT, f'{name}.png'))

with tempfile.TemporaryDirectory() as tmp:
    talking('talk-moonbrew', [
        ('Okay so I found this coffee app called Moonbrew and it changed my mornings.', 1.4),
        ('Um, it tells you the best time to drink your coffee.', 1.6),
        ('And honestly it saved me so much money this month. Go try it.', 0.6),
    ], tmp, (76, 110, 245), (255, 236, 214), (247, 205, 170))
    talking('talk-fitpocket', [
        ('Three reasons I open this workout app every single day.', 1.2),
        ('One. The workouts are ten minutes.', 1.0),
        ('Two. It, uh, plans the whole week for me.', 1.3),
        ('Three. My streak is at forty days.', 0.6),
    ], tmp, (34, 160, 120), (214, 240, 255), (170, 210, 247))
    talking('hook-1', [('Nobody is talking about this app and I do not get why.', 0.4)], tmp, (76, 110, 245), (255, 236, 214), (247, 205, 170))
    talking('hook-2', [('I tried the viral coffee app so you do not have to.', 0.4)], tmp, (200, 80, 120), (240, 230, 255), (210, 190, 245))
    reaction('react-1', tmp, (76, 110, 245), (255, 236, 214), (247, 205, 170))
    reaction('react-2', tmp, (200, 80, 120), (240, 230, 255), (210, 190, 245))
    reaction('react-3', tmp, (34, 160, 120), (214, 240, 255), (170, 210, 247))
    product('product-1', tmp, (120, 82, 240), 'Moonbrew')
    product('product-2', tmp, (240, 120, 60), 'Your plan')
    product('product-3', tmp, (30, 150, 200), 'Savings')
    song('song-sunny', [261.6, 329.6, 392.0])
    song('song-night', [220.0, 261.6, 329.6])
    logo('logo-moonbrew', 'M', (120, 82, 240))
    logo('logo-fitpocket', 'F', (34, 160, 120))
    logo('logo-notely', 'N', (240, 150, 40))
print('made', sorted(os.listdir(OUT)))
