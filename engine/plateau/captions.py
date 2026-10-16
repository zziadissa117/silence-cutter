#!/usr/bin/env python3
"""
Rendu des textes a l'ecran (style TikTok).
------------------------------------------
ffmpeg de Homebrew est compile sans libfreetype: le filtre `drawtext`
n'existe pas. On dessine donc le texte avec le moteur de rendu natif de
macOS (CoreText via PyObjC), on l'enregistre en PNG transparent, et on
l'incruste avec le filtre `overlay` de ffmpeg — qui, lui, marche partout.

Bonus par rapport a drawtext: le retour a la ligne est automatique, et on
peut dessiner une pastille arrondie derriere chaque ligne, comme sur TikTok.
"""

import hashlib
import os
from pathlib import Path

try:
    from AppKit import (NSBitmapImageRep, NSColor, NSFont, NSGraphicsContext,
                        NSMutableParagraphStyle, NSBezierPath, NSMakeRect,
                        NSAttributedString, NSCalibratedRGBColorSpace,
                        NSFontAttributeName, NSForegroundColorAttributeName,
                        NSParagraphStyleAttributeName, NSStrokeColorAttributeName,
                        NSStrokeWidthAttributeName)
    _OK = True
except ImportError:                                    # pas macOS / pas PyObjC
    _OK = False

# Repli quand CoreText n'est pas la: Windows, Linux, ou un Mac tournant sur
# un Python installe a la main (seul celui d'Apple embarque PyObjC).
# captions_pil refait le meme dessin avec Pillow.
try:
    import captions_pil as _PIL
except ImportError:
    _PIL = None

# Styles disponibles.
#   contour = texte blanc epais cerne de noir, sans fond -> le look TikTok/CapCut
#   pastille = bandeau sombre arrondi derriere chaque ligne
# `stroke` est un pourcentage de la taille de police (negatif = remplir ET cerner).
STYLES = {
    "contour":  {"box": False, "text": (1, 1, 1), "stroke": -11.0, "stroke_rgb": (0, 0, 0)},
    "nu":       {"box": False, "text": (1, 1, 1), "stroke": 0},
    "pastille": {"box": True,  "box_alpha": 0.55, "text": (1, 1, 1), "stroke": 0},
    "blanc":    {"box": False, "text": (1, 1, 1), "stroke": 0},
    "noir":     {"box": False, "text": (0, 0, 0), "stroke": 0},
}

# TikTok Sans est la police officielle de TikTok, publiee par TikTok Inc.
# sous licence SIL Open Font. Elle a remplace Proxima Nova, sur laquelle le
# style "Classic" etait historiquement base. Le fichier est livre avec le
# projet dans fonts/ et charge EN MEMOIRE, jamais installe dans le systeme.
_HERE = Path(__file__).resolve().parent

EXTRA_FONT_FILES = [
    str(_HERE / "fonts" / "TikTokSans[opsz,slnt,wdth,wght].ttf"),
    # Repli si le fichier a ete supprime: la police maison de CapCut
    # (meme editeur, ByteDance) s'en approche.
    "/Applications/CapCut.app/Contents/Resources/Font/SystemFont/CapCutSansText-Bold.otf",
]

# Graisses proposees dans les reglages.
FONT_CHOICES = {
    "TikTok Sans Bold": "TikTokSans-Bold",
    "TikTok Sans SemiBold": "TikTokSans-SemiBold",
    "TikTok Sans ExtraBold": "TikTokSans-ExtraBold",
    "TikTok Sans Black": "TikTokSans-Black",
    "TikTok Sans Medium": "TikTokSans-Medium",
}

FONTS = ["TikTokSans-Bold", "CapCutSansText-Bold",
         "AvenirNext-Bold", "HelveticaNeue-Bold", "Helvetica-Bold"]


def _register_extra_fonts():
    """Rend disponibles des polices livrees avec d'autres apps, pour ce
    processus uniquement (aucune installation dans ~/Library/Fonts)."""
    if not _OK:
        return []
    loaded = []
    try:
        import objc
        from Foundation import NSURL
        bundle = objc.loadBundle(
            "CoreText", globals(),
            bundle_path="/System/Library/Frameworks/CoreText.framework")
        objc.loadBundleFunctions(
            bundle, globals(),
            [("CTFontManagerRegisterFontsForURL", b"Z@i^@")])
    except Exception:                                  # noqa: BLE001
        return []
    for path in EXTRA_FONT_FILES:
        if not Path(path).exists():
            continue
        try:
            # 1 = kCTFontManagerScopeProcess
            if CTFontManagerRegisterFontsForURL(          # noqa: F821
                    NSURL.fileURLWithPath_(path), 1, None):
                loaded.append(Path(path).name)
        except Exception:                              # noqa: BLE001
            pass
    return loaded


_EXTRA_LOADED = _register_extra_fonts()

# Positions verticales proposees dans l'interface.
POSITIONS = ("haut", "milieu", "bas")


def available():
    return _OK or bool(_PIL and _PIL.available())


def font_name(preferred=None):
    """Nom de la police reellement utilisee (pour l'afficher dans l'app)."""
    if not _OK:
        return _PIL.font_name() if _PIL else None
    f = _font(48, preferred)
    return f.fontName() if f else None


def available_fonts():
    """Graisses de FONT_CHOICES reellement chargees sur cette machine."""
    if not _OK:
        if not _PIL:
            return []
        dispo = set(_PIL.available_fonts())
        return [n for n, ps in FONT_CHOICES.items() if ps in dispo]
    return [n for n, ps in FONT_CHOICES.items()
            if NSFont.fontWithName_size_(ps, 48) is not None]


def _font(size, preferred=None):
    """Police demandee si elle existe, sinon la premiere disponible."""
    for name in ([preferred] if preferred else []) + FONTS:
        if not name:
            continue
        f = NSFont.fontWithName_size_(name, size)
        if f is not None:
            return f
    return NSFont.boldSystemFontOfSize_(size)


def _attrs(font, st, stroke_only=False):
    """Attributs de dessin.

    Le contour est fait en DEUX passes: une passe qui ne trace que le
    contour, puis le remplissage par-dessus. Une seule passe avec une
    epaisseur negative centre le trait sur le bord du glyphe et ronge donc
    l'interieur des lettres, ce qui les amincit visiblement."""
    para = NSMutableParagraphStyle.alloc().init()
    para.setAlignment_(2)                              # 2 = centre
    a = {NSFontAttributeName: font, NSParagraphStyleAttributeName: para}
    if stroke_only:
        a[NSStrokeWidthAttributeName] = abs(st.get("stroke", 0))
        a[NSStrokeColorAttributeName] = \
            NSColor.colorWithCalibratedRed_green_blue_alpha_(*st.get("stroke_rgb", (0, 0, 0)), 1.0)
        a[NSForegroundColorAttributeName] = NSColor.clearColor()
    else:
        a[NSForegroundColorAttributeName] = \
            NSColor.colorWithCalibratedRed_green_blue_alpha_(*st["text"], 1.0)
    return a


def _measure(text, attrs):
    return NSAttributedString.alloc().initWithString_attributes_(text, attrs).size()


def _wrap(text, attrs, max_width):
    """Coupe le texte en lignes qui tiennent dans max_width.

    Un mot plus long que la ligne entiere est coupe en deux plutot que de
    deborder (rare, mais sinon le texte sortirait du cadre)."""
    lines, current = [], ""
    for word in text.split():
        trial = f"{current} {word}".strip()
        if _measure(trial, attrs).width <= max_width or not current:
            current = trial
            while _measure(current, attrs).width > max_width and len(current) > 1:
                cut = len(current) - 1
                while cut > 1 and _measure(current[:cut], attrs).width > max_width:
                    cut -= 1
                lines.append(current[:cut])
                current = current[cut:]
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def render(text, video_w, video_h, out_path, size=56, style="contour",
           font_ps=None, outline=None):
    """Dessine `text` dans un PNG transparent de la largeur de la video.

    `outline` = epaisseur du contour en % de la taille de police.
    Retourne (chemin, hauteur_px) ou None si le rendu est impossible."""
    if not _OK:
        if not _PIL:
            return None
        return _PIL.render(text, video_w, video_h, out_path, size, style,
                           font_ps, outline, styles=STYLES)
    if not text.strip():
        return None

    st = dict(STYLES.get(style, STYLES["contour"]))
    if outline is not None and st.get("stroke"):
        st["stroke"] = -abs(float(outline))
    font = _font(size, font_ps)
    attrs = _attrs(font, st)
    outline = _attrs(font, st, stroke_only=True) if st.get("stroke") else None

    if st["box"]:
        pad_x, pad_y, gap = size * 0.42, size * 0.24, size * 0.16
    else:
        # Sans pastille, il faut quand meme de la marge pour que le contour
        # noir ne soit pas rogne par le bord de l'image.
        pad_x, pad_y, gap = size * 0.18, size * 0.10, size * 0.04
    max_text_w = video_w * 0.92 - 2 * pad_x

    lines = _wrap(text.strip(), attrs, max_text_w)
    line_h = _measure("Ág", attrs).height
    box_h = line_h + 2 * pad_y
    total_h = int(len(lines) * box_h + (len(lines) - 1) * gap + 4)

    rep = NSBitmapImageRep.alloc().\
        initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
            None, int(video_w), total_h, 8, 4, True, False,
            NSCalibratedRGBColorSpace, 0, 0)
    if rep is None:
        return None

    ctx = NSGraphicsContext.graphicsContextWithBitmapImageRep_(rep)
    if ctx is None:
        return None
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.setCurrentContext_(ctx)

    # L'origine d'une NSBitmapImageRep est en bas a gauche: on dessine donc
    # la derniere ligne en premier.
    y = 2.0
    for line in reversed(lines):
        tw = _measure(line, attrs).width
        bw = tw + 2 * pad_x
        x = (video_w - bw) / 2.0

        if st["box"]:
            NSColor.colorWithCalibratedRed_green_blue_alpha_(
                0, 0, 0, st["box_alpha"]).set()
            NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(
                NSMakeRect(x, y, bw, box_h), size * 0.22, size * 0.22).fill()

        rect = NSMakeRect(x + pad_x, y + pad_y * 0.7, tw + 2, line_h)
        if outline:
            NSAttributedString.alloc().initWithString_attributes_(line, outline).\
                drawInRect_(rect)
        NSAttributedString.alloc().initWithString_attributes_(line, attrs).\
            drawInRect_(rect)
        y += box_h + gap

    NSGraphicsContext.restoreGraphicsState()

    data = rep.representationUsingType_properties_(4, {})   # 4 = PNG
    if data is None:
        return None
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    if not data.writeToFile_atomically_(str(out_path), True):
        return None
    return str(out_path), total_h


def cached(text, video_w, video_h, cache_dir, size=56, style="contour",
           font_ps=None, outline=None):
    """Comme render(), mais reutilise le PNG s'il a deja ete dessine."""
    key = hashlib.sha1(
        f"{text}|{video_w}|{size}|{style}|{font_ps}|{outline}".encode("utf-8")).hexdigest()[:16]
    path = Path(cache_dir) / f"cap_{key}.png"
    if path.exists() and path.stat().st_size > 0:
        if not _OK:
            h = _PIL.hauteur_png(path) if _PIL else None
            if h:
                return str(path), h
        else:
            rep = NSBitmapImageRep.imageRepWithContentsOfFile_(str(path))
            if rep is not None:
                return str(path), int(rep.pixelsHigh())
            try:
                os.remove(path)
            except OSError:
                pass
    return render(text, video_w, video_h, path, size, style, font_ps, outline)
