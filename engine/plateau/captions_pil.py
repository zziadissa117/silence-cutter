#!/usr/bin/env python3
"""
Rendu des textes sans macOS.
----------------------------
`captions.py` dessine les textes avec CoreText, qui n'existe que sur Mac —
et meme sur Mac, seul le Python livre par Apple embarque PyObjC. Ce module
refait le meme dessin avec Pillow (`pip install pillow`), pour que
Windows, Linux et les Mac sous un Python installe a la main aient des
textes eux aussi.

La geometrie est copiee ligne pour ligne sur `captions.render()`: memes
marges, meme hauteur de pastille, meme interligne. Une video montee ici et
une video montee sur le Mac d'origine doivent se superposer.
"""

import os
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
    _OK = True
except ImportError:
    _OK = False

_HERE = Path(__file__).resolve().parent
_FICHIER = _HERE / "fonts" / "TikTokSans[opsz,slnt,wdth,wght].ttf"

# FONT_CHOICES de captions.py donne des noms PostScript (« TikTokSans-Bold »).
# Pillow, lui, veut le nom de l'instance dans la police variable (« Bold »).
_GRAISSES = {"TikTokSans-Light": "Light", "TikTokSans-Regular": "Regular",
             "TikTokSans-Medium": "Medium", "TikTokSans-SemiBold": "SemiBold",
             "TikTokSans-Bold": "Bold", "TikTokSans-ExtraBold": "ExtraBold",
             "TikTokSans-Black": "Black"}

_cache_police = {}


def available():
    return _OK and _FICHIER.exists()


def available_fonts():
    """Les graisses disponibles, nommees comme dans captions.FONT_CHOICES.

    Attention au vocabulaire: FONT_CHOICES parle en noms PostScript
    (« TikTokSans-Bold »), la police variable en noms d'instance
    (« Bold »). C'est ici qu'on traduit — renvoyer les noms d'instance
    laissait la liste des polices vide dans l'interface."""
    if not available():
        return []
    dispo = set(_noms_instances())
    return [ps for ps, instance in _GRAISSES.items() if instance in dispo]


def _noms_instances():
    try:
        f = ImageFont.truetype(str(_FICHIER), 48)
        return [n.decode("utf-8", "replace") if isinstance(n, bytes) else n
                for n in f.get_variation_names()]
    except Exception:                                   # noqa: BLE001
        return []


def font_name():
    return "TikTok Sans" if available() else None


def _police(taille, ps=None):
    """Charge la police a cette taille, dans cette graisse.

    Les objets ImageFont sont mis en cache: `_wrap` mesure chaque mot, donc
    on repasse ici des dizaines de fois par texte."""
    graisse = _GRAISSES.get(ps or "", "Bold")
    cle = (int(taille), graisse)
    if cle in _cache_police:
        return _cache_police[cle]
    f = ImageFont.truetype(str(_FICHIER), int(taille))
    try:
        f.set_variation_by_name(graisse)
    except Exception:                                   # noqa: BLE001
        pass                                            # police non variable
    _cache_police[cle] = f
    return f


def _largeur(texte, police):
    """Largeur d'avance, pas la boite d'encre.

    CoreText mesure ce dont le texte a besoin pour avancer, approches
    laterales comprises; `getbbox` s'arrete aux pixels allumes. Sur un mot
    qui finit par un « l » l'ecart depasse la demi-lettre."""
    return police.getlength(texte) if texte else 0


def _wrap(texte, police, largeur_max):
    """Retour a la ligne au mot. Un mot plus long que la ligne est coupe."""
    lignes, courante = [], ""
    for mot in texte.split():
        essai = f"{courante} {mot}".strip()
        if _largeur(essai, police) <= largeur_max or not courante:
            courante = essai
        else:
            lignes.append(courante)
            courante = mot
        while _largeur(courante, police) > largeur_max and len(courante) > 1:
            coupe = len(courante) - 1
            while coupe > 1 and _largeur(courante[:coupe], police) > largeur_max:
                coupe -= 1
            lignes.append(courante[:coupe])
            courante = courante[coupe:]
    if courante:
        lignes.append(courante)
    return lignes or [texte]


def sans_emoji(texte):
    """Retire les emoji, que TikTok Sans ne sait pas dessiner.

    Sous Windows (Pillow, sans police de repli), chaque emoji sortait en
    carre vide « tofu » en plein milieu de l'accroche — verifie sur ce PC le
    2026-09-24. Mieux vaut une phrase sans emoji qu'une phrase qui a l'air
    cassee. Le rendu macOS (CoreText) les garde, lui, en couleur."""
    out = []
    for ch in texte:
        cp = ord(ch)
        if (0x1F000 <= cp <= 0x1FAFF or 0x2600 <= cp <= 0x27BF
                or 0x2B00 <= cp <= 0x2BFF or 0x1F1E6 <= cp <= 0x1F1FF
                or cp in (0xFE0F, 0x200D, 0x20E3) or 0xE0020 <= cp <= 0xE007F):
            continue
        out.append(ch)
    # Un emoji retire laisse souvent deux espaces cote a cote.
    return " ".join("".join(out).split())


def render(text, video_w, video_h, out_path, size=56, style="contour",
           font_ps=None, outline=None, styles=None):
    """Meme contrat que captions.render(): (chemin, hauteur) ou None."""
    text = sans_emoji(text or "")
    if not available() or not text.strip():
        return None

    st = dict((styles or {}).get(style) or
              {"box": False, "text": (1, 1, 1), "stroke": -11.0,
               "stroke_rgb": (0, 0, 0)})
    if outline is not None and st.get("stroke"):
        st["stroke"] = -abs(float(outline))

    police = _police(size, font_ps)

    if st.get("box"):
        pad_x, pad_y, gap = size * 0.42, size * 0.24, size * 0.16
    else:
        # Sans pastille, il faut quand meme de la marge pour que le contour
        # noir ne soit pas rogne par le bord de l'image.
        pad_x, pad_y, gap = size * 0.18, size * 0.10, size * 0.04
    largeur_max = video_w * 0.92 - 2 * pad_x

    lignes = _wrap(text.strip(), police, largeur_max)
    # Hauteur de LIGNE, pas hauteur d'encre: CoreText renvoie ascendante +
    # descendante, ce que `getmetrics` donne aussi. Mesurer la boite d'encre
    # de « Ág » donnait des pastilles trop serrees de 12 px.
    montee, descente = police.getmetrics()
    line_h = montee + descente
    box_h = line_h + 2 * pad_y
    total_h = int(len(lignes) * box_h + (len(lignes) - 1) * gap + 4)

    img = Image.new("RGBA", (int(video_w), total_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    couleur = tuple(int(round(c * 255)) for c in st["text"]) + (255,)
    trait = int(round(abs(st.get("stroke") or 0) / 100.0 * size))
    trait_rgb = tuple(int(round(c * 255))
                      for c in st.get("stroke_rgb", (0, 0, 0))) + (255,)

    y = 2.0
    for ligne in lignes:
        tw = _largeur(ligne, police)
        bw = tw + 2 * pad_x
        x = (video_w - bw) / 2.0
        if st.get("box"):
            d.rounded_rectangle(
                [x, y, x + bw, y + box_h], radius=size * 0.22,
                fill=(0, 0, 0, int(round(st.get("box_alpha", 0.55) * 255))))
        # `anchor="la"` cale l'ascendante sur y: c'est ce que fait
        # drawInRect_ de CoreText, qui part du haut de la boite.
        d.text((x + pad_x, y + pad_y * 0.7), ligne, font=police,
               fill=couleur, anchor="la",
               stroke_width=trait or 0,
               stroke_fill=trait_rgb if trait else None)
        y += box_h + gap

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(str(out_path), "PNG")
    return str(out_path), total_h


def hauteur_png(path):
    """Hauteur d'un PNG deja dessine, pour reutiliser le cache."""
    if not _OK:
        return None
    try:
        with Image.open(str(path)) as im:
            return int(im.height)
    except Exception:                                   # noqa: BLE001
        try:
            os.remove(path)
        except OSError:
            pass
        return None
