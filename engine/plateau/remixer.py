#!/usr/bin/env python3
"""
Moteur de remix video.
----------------------
Contient toute la logique ffmpeg. Utilise par le serveur web (server.py)
et par le script en ligne de commande (video_remixer.py).

Une SERIE = un dossier avec:
  serie.json    la config (slots, reglages, captions)
  slots/<id>/      les clips de chaque categorie
  music/           les musiques de fond (optionnel)
  output/          les videos generees
  thumbs/          les vignettes

Un SLOT = une categorie de clips (ex: "Hook", "Corps", "CTA"). Chaque
serie en definit autant qu'elle veut, dans l'ordre ou ils doivent
apparaitre dans la video finale.
"""

import json
import os
import random
import shutil
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import captions

VIDEO_EXTS = (".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm")
AUDIO_EXTS = (".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg")

# Reglages par defaut d'une nouvelle serie. Groupes par impact reel
# sur l'empreinte perceptuelle (voir README).
DEFAULT_SETTINGS = {
    # Format de sortie
    "width": 1080,
    "height": 1920,
    # 60 par defaut: les iPhone filment en 60 im/s et sortir en 30 jetait
    # une image sur deux, ce qui se voit dans les mouvements.
    "fps": 60,
    # Qualite d'encodage. crf: plus bas = meilleur (14 = quasi sans perte,
    # 16 par defaut, 20 correct, 28 visiblement degrade). A 16 le debit
    # obtenu est proche de celui des sources iPhone (~14 contre ~16 Mb/s).
    "crf": 16,
    # `fast` mesure plus rapide que `medium` ET avec un debit superieur a
    # crf egal: pas de raison d'aller plus lent.
    "preset": "fast",
    # ------------------------------------------------------------------
    # PHILOSOPHIE DES REGLAGES PAR DEFAUT
    #
    # La variete vient du MONTAGE: clips differents, points de decoupe
    # differents. C'est gratuit en qualite et c'est le seul levier qui
    # deplace vraiment une empreinte perceptuelle (mesures dans le README).
    #
    # Toutes les retouches d'image et de son sont donc a ZERO par defaut.
    # Elles degradent l'image ou l'experience du spectateur pour un gain
    # nul ou marginal:
    #   couleurs      0 bit de difference mesure -> aucun interet
    #   recadrage     SSIM 0.99 -> 0.81, la perte la plus lourde
    #   vitesse >1.1  change le rythme et la voix, ca s'entend
    #   nettete       change le rendu pour un gain d'empreinte marginal
    # Tout reste reglable si tu veux les reactiver.
    # ------------------------------------------------------------------
    # MONTAGE - impact fort, cout nul
    # La duree se regle PAR CATEGORIE (dur_min / dur_max en secondes).
    # Si rien n'est defini pour une categorie, le clip est pris en entier.
    "shuffle_slots": False,    # melanger l'ordre des categories
    # AUDIO
    # Le son des clips sources est TOUJOURS retire, sans exception.
    # `mute` decide seulement s'il reste une musique de fond par-dessus.
    "mute": 1,                 # 1 = aucun son du tout, meme pas de musique
    "music_volume_min": 0.12,
    "music_volume_max": 0.28,
    # Volume final de la video, en LUFS (norme de loudness). Le son des clips
    # etant toujours retire, la musique EST la bande-son: sans cette
    # normalisation elle sortait a -35/-39 dB de moyenne (mesure sur ce PC,
    # 2026-09-24), soit ~20 dB sous la piste d'origine -> video quasi muette.
    # -14 LUFS = le niveau vise par Instagram, TikTok et YouTube.
    "music_lufs": -14.0,
    # 1 = la musique vient de la bibliotheque partagee (sounds/, page Sounds)
    # et non du dossier de la serie: sons.choisir() pose sur chaque video le
    # son le moins utilise par ce compte, a partir de son refrain. Si la
    # bibliotheque est vide, on retombe sur le dossier de la serie.
    "music_library": 0,
    # CADRE - tres leger. Le recadrage coute cher meme a faible dose (c'est
    # un rescale, pas juste un crop): a 14% le SSIM tombait a 0.81, a 3% deja
    # 0.885. On reste a 1.5%, negligeable a l'oeil.
    "zoom_min": 0.0,
    "zoom_max": 0.015,
    # PIXELS - retouches legeres. Avec one_effect=1 ci-dessous, un clip ne
    # recoit jamais plus d'UNE de ces retouches a la fois, donc les activer
    # toutes ne les cumule pas.
    "speed_min": 1.0,
    "speed_max": 1.04,         # imperceptible, mais change l'echantillonnage
    "brightness_amp": 0.02,
    "contrast_amp": 0.02,
    "saturation_amp": 0.03,
    "hue_amp": 2.0,
    # Nettete (unsharp). ATTENTION: la valeur neutre est 0, pas 1 -- 1 est
    # seulement le defaut de ffmpeg et applique deja une nettete bien
    # visible. Repere mesure sur les clips du projet: 0.3 imperceptible,
    # 0.8 visible et naturel, 1.5 marque, 2.5 tres marque (halos possibles
    # sur les contours contrastes). Plage 1-2 = look net facon CapCut.
    "sharpen_min": 1.0,
    "sharpen_max": 2.0,
    # Une seule retouche a la fois: si plusieurs sont activees, chaque clip
    # n'en recoit qu'UNE, tiree au sort. Empiler recadrage + couleurs +
    # nettete sur le meme clip cumule les degats sans rien
    # apporter de plus.
    "one_effect": 1,
    # Captions
    # 1.0 = un texte s'affiche des qu'une categorie en definit un.
    "caption_prob": 1.0,
    "caption_size": 78,        # taille du texte, relative a une video 1080 de large
    "caption_style": "contour",  # contour = blanc cerne de noir, sans fond
    "caption_font": "TikTok Sans Bold",   # graisse de TikTok Sans
    "caption_outline": 11.0,   # epaisseur du contour noir, en % de la taille
}

TARGET_AR = 44100

# Plafond de debit du rendu final. Meta refuse les Reels au-dessus de
# 25 Mb/s; a crf 16 / 60 im/s, des sources iPhone 4K sortaient entre 16 et
# 33 Mb/s (mesure 2026-09-24). Le plafond ne touche que les passages les
# plus charges: le reste de la video garde la qualite crf.
MAX_VIDEO_RATE = "20M"
MAX_VIDEO_BUF = "40M"
# 128 kb/s: la valeur de la fiche technique Reels de Meta. Au-dela, Instagram
# re-encode de toute facon.
AUDIO_RATE = "128k"

# Qualite des morceaux temporaires, avant l'assemblage. Volontairement tres
# haute: ces fichiers sont ré-encodes juste apres, et toute perte introduite
# ici s'ajouterait a celle du rendu final. Ils sont supprimes ensuite.
INTERMEDIATE_CRF = 14
# Police pour le filtre drawtext de ffmpeg — le chemin d'un fichier, pas un
# nom. Celle livree avec le projet passe en premier: elle est la meme sur
# les trois systemes, donc un montage rendu sur Windows ressemble a un
# montage rendu sur Mac. Les suivantes ne servent que si elle a ete
# supprimee.
FONT_CANDIDATES = [
    str(Path(__file__).resolve().parent / "fonts" /
        "TikTokSans[opsz,slnt,wdth,wght].ttf"),
    "/System/Library/Fonts/Supplemental/Arial.ttf",      # macOS
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
    "C:/Windows/Fonts/arialbd.ttf",                      # Windows
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",   # Linux
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]

# Cache des mesures ffprobe. Il vivait uniquement en memoire: chaque
# redemarrage du serveur relançait un ffprobe par clip, soit ~7 s pour ouvrir
# une serie de 80 clips. Il est maintenant recopie sur disque, donc le
# cout n'est paye qu'une fois par fichier, pour de bon.
_probe_cache = {}
_probe_dirty = False
_PROBE_FILE = Path(__file__).resolve().parent / ".probe-cache.json"
_probe_lock = threading.Lock()
_drawtext_cache = None


def _load_probe_cache():
    """Relit le cache disque. Les cles sont "chemin|mtime|taille": si un
    fichier change, sa cle change, donc une entree perimee est simplement
    ignoree — pas besoin d'invalidation."""
    try:
        with open(_PROBE_FILE, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {}
    out = {}
    for k, v in (d.items() if isinstance(d, dict) else []):
        try:
            out[k] = (float(v[0]), bool(v[1]))
        except (TypeError, ValueError, IndexError):
            pass
    return out


def save_probe_cache():
    """Ecrit le cache sur disque s'il a bouge. Echec silencieux: perdre le
    cache coute du temps, jamais de l'exactitude."""
    global _probe_dirty
    with _probe_lock:
        if not _probe_dirty:
            return
        snapshot, _probe_dirty = dict(_probe_cache), False
    # Les fichiers supprimes laissent leur entree derriere eux. Au-dela de
    # quelques milliers, on fait le menage: c'est rare, et ca evite que le
    # fichier gonfle indefiniment.
    if len(snapshot) > 4000:
        snapshot = {k: v for k, v in snapshot.items()
                    if os.path.exists(k.rsplit("|", 2)[0])}
        with _probe_lock:
            _probe_cache.clear()
            _probe_cache.update(snapshot)
    try:
        tmp = _PROBE_FILE.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({k: list(v) for k, v in snapshot.items()}, f)
        os.replace(str(tmp), str(_PROBE_FILE))
    except OSError:
        pass


_probe_cache = _load_probe_cache()


# ------------------------------------------------------------------
# Utilitaires ffmpeg
# ------------------------------------------------------------------

def tools_available():
    """(ffmpeg_ok, texte_ok, message)

    Le texte ne depend plus de ffmpeg: il est dessine par macOS et incruste
    en PNG, donc il marche meme sans le filtre drawtext."""
    missing = [t for t in ("ffmpeg", "ffprobe") if shutil.which(t) is None]
    if missing:
        return False, False, f"{' et '.join(missing)} introuvable(s). Installe ffmpeg."
    return True, captions.available(), ""


def has_drawtext():
    """Le filtre drawtext n'existe que si ffmpeg est compile avec libfreetype."""
    global _drawtext_cache
    if _drawtext_cache is None:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-h", "filter=drawtext"],
                           capture_output=True, text=True)
        _drawtext_cache = "Unknown filter" not in (r.stdout + r.stderr)
    return _drawtext_cache


def font_file():
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return f
    return None


def audio_rate(path):
    """Frequence d'echantillonnage de la piste audio, ou None."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=sample_rate", "-of", "csv=p=0", path],
        capture_output=True, text=True)
    try:
        return int(r.stdout.strip())
    except ValueError:
        return None


def probe(path):
    """(duree_secondes, a_de_l_audio). Mis en cache par chemin+mtime+taille.

    Un seul appel ffprobe sort les deux informations: la version precedente
    en lançait deux par fichier, ce qui doublait pour rien le nombre de
    processus a demarrer — c'est le demarrage du processus qui coute, pas
    la lecture."""
    global _probe_dirty
    try:
        st = os.stat(path)
        key = f"{path}|{st.st_mtime}|{st.st_size}"
    except OSError:
        return 0.0, False
    hit = _probe_cache.get(key)
    if hit is not None:
        return hit

    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type", "-of", "json", path],
        capture_output=True, text=True)
    duration, has_audio = 0.0, False
    try:
        info = json.loads(r.stdout or "{}")
        duration = float(info.get("format", {}).get("duration") or 0.0)
        has_audio = any(st_.get("codec_type") == "audio"
                        for st_ in info.get("streams", []))
    except (ValueError, TypeError):
        pass

    with _probe_lock:
        _probe_cache[key] = (duration, has_audio)
        _probe_dirty = True
    return duration, has_audio


def _duree_brute(path):
    """Duree d'un fichier SANS passer par le cache: pour les morceaux
    temporaires d'un montage, qui n'ont rien a faire dans .probe-cache.json."""
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", str(path)],
                       capture_output=True, text=True)
    try:
        return float((r.stdout or "0").strip() or 0)
    except ValueError:
        return 0.0


# ------------------------------------------------------------------
# HDR -> SDR
# ------------------------------------------------------------------
# Les iPhone filment en HDR par defaut (HLG, 10 bits, Rec.2020). Encode tel
# quel en 8 bits, le fichier gardait l'etiquette HDR sans les 10 bits qui
# vont avec: selon le lecteur, l'image sortait delavee (mesure sur les prises
# d'Ilyan, iPhone 16, 2026-10-01). Ces sources sont donc ramenees en SDR
# Rec.709 par le tout premier filtre, comme le ferait l'iPhone en exportant
# « Plus compatible ». Cout mesure: ~3 s de plus par morceau en 4K.
_HDR_TRC = ("arib-std-b67", "smpte2084")           # HLG (iPhone) et PQ (HDR10)
TONEMAP = ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
           "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p")
# Meme image, memes etiquettes: chaque morceau sort en Rec.709 « TV ». Si
# deux morceaux d'une meme video n'ont pas les memes etiquettes de couleur
# (un clip d'iPhone converti et une capture d'ecran de PC sans etiquette, par
# exemple), ffmpeg reconstruit ses filtres au milieu de l'assemblage et JETTE
# le second morceau sans rien dire: la video sortait a 2 s au lieu de 4
# (mesure 2026-10-02). Ces options convertissent aussi une source « pleine
# plage » au passage.
SORTIE_709 = ["-color_range", "tv", "-colorspace", "bt709",
              "-color_primaries", "bt709", "-color_trc", "bt709"]
_hdr_cache = {}
_filtres_cache = None


def _filtres():
    """Noms des filtres de ce ffmpeg (lus une fois)."""
    global _filtres_cache
    if _filtres_cache is None:
        try:
            r = subprocess.run(["ffmpeg", "-hide_banner", "-filters"],
                               capture_output=True, text=True)
            _filtres_cache = {l.split()[1] for l in r.stdout.splitlines() if len(l.split()) > 2}
        except (OSError, IndexError):
            _filtres_cache = set()
    return _filtres_cache


def has_tonemap():
    """Les filtres zscale et tonemap n'existent que si ffmpeg est compile
    avec libzimg. Sans eux on garde l'ancien rendu plutot que d'echouer."""
    return "zscale" in _filtres() and "tonemap" in _filtres()


def chaines_hdr(path):
    """Debuts de chaine de filtres a essayer, dans l'ordre, pour cette source.
    [""] pour une source ordinaire. Pour une source HDR:

      1. la conversion normale;
      2. la meme, en disant d'abord a ffmpeg que l'image est en Rec.2020 —
         certains fichiers ré-exportes annoncent le HDR dans leur en-tete
         mais pas dans leurs images, et zscale refuse alors de convertir
         (« no path between colorspaces »). Sans ce second essai, un seul
         clip de ce genre faisait echouer tout le lot;
      3. rien: l'ancien rendu, delave mais entier.

    Les metadonnees HDR10 (luminance du moniteur de reference) sont retirees
    au passage: une video SDR qui les garde se contredit."""
    trc = _trc_hdr(path)
    if not trc or not has_tonemap():
        return [""]
    fin = ""
    if "sidedata" in _filtres():
        fin = (",sidedata=mode=delete:type=MASTERING_DISPLAY_METADATA"
               ",sidedata=mode=delete:type=CONTENT_LIGHT_LEVEL")
    force = f"setparams=colorspace=bt2020nc:color_primaries=bt2020:color_trc={trc},"
    return [TONEMAP + fin, force + TONEMAP + fin, ""]


def video_info(path):
    """Ce qu'on a besoin de savoir d'une source video, sans cache:
    {width, height, duration, codec, hdr, fps}. Largeur et hauteur tiennent
    compte de la rotation (un iPhone tenu debout ecrit 3840x2160 + « tourner
    de 90° »). Dictionnaire vide si ffprobe ne lit pas de piste video."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=codec_name,width,height,color_transfer,color_space,avg_frame_rate"
         ":stream_side_data=rotation:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True)
    try:
        info = json.loads(r.stdout or "{}")
        st = (info.get("streams") or [])[0]
        w, h = int(st.get("width") or 0), int(st.get("height") or 0)
        if w <= 0 or h <= 0:
            return {}
        rot = 0
        for sd in st.get("side_data_list") or []:
            if "rotation" in sd:
                rot = int(float(sd["rotation"]))
        if abs(rot) % 180 == 90:
            w, h = h, w
        num, _, den = str(st.get("avg_frame_rate") or "0/1").partition("/")
        fps = float(num) / float(den or 1) if float(den or 1) else 0.0
        return {"width": w, "height": h,
                "duration": float(info.get("format", {}).get("duration") or 0.0),
                "codec": st.get("codec_name") or "",
                "hdr": st.get("color_transfer") in _HDR_TRC,
                "trc": st.get("color_transfer") or "",
                "matrice": st.get("color_space") or "",
                "fps": round(fps, 2)}
    except (ValueError, TypeError, IndexError, ZeroDivisionError):
        return {}


def _trc_hdr(path):
    """Courbe de transfert d'une source HDR (« arib-std-b67 » pour le HLG
    des iPhone, « smpte2084 » pour le PQ), ou "" si la source est ordinaire.
    Garde en memoire par chemin+mtime+taille, comme probe()."""
    try:
        st = os.stat(path)
        key = f"{path}|{st.st_mtime}|{st.st_size}"
    except OSError:
        return ""
    hit = _hdr_cache.get(key)
    if hit is None:
        info = video_info(path)
        hit = info.get("trc", "") if info.get("hdr") else ""
        with _probe_lock:
            _hdr_cache[key] = hit
    return hit


def est_hdr(path):
    """True si la source est en HDR (HLG ou PQ)."""
    return bool(_trc_hdr(path))


_sans_matrice_cache = {}


def hd_sans_matrice(path):
    """True pour une source HD dont le flux n'annonce aucune matrice de
    couleur (capture d'ecran de PC, video telechargee, re-export qui a perdu
    ses etiquettes).

    Tout lecteur lit une telle video en Rec.709. ffmpeg, lui, la suppose en
    Rec.601 des qu'on lui demande une sortie Rec.709 (SORTIE_709) et la
    « convertit »: l'image sortait plus sombre et plus saturee que la source
    (mesure 2026-10-07: 94 % des pixels decales d'au moins 6/255). On lui
    dit donc d'avance que c'est du Rec.709, et il n'y touche plus. Les
    petites videos SD gardent l'hypothese Rec.601, qui est la bonne pour
    elles."""
    try:
        st = os.stat(path)
        key = f"{path}|{st.st_mtime}|{st.st_size}"
    except OSError:
        return False
    hit = _sans_matrice_cache.get(key)
    if hit is None:
        info = video_info(path)
        hit = bool(info) and not info.get("hdr") \
            and info.get("matrice", "") in ("", "unknown") \
            and (info.get("height", 0) >= 720 or info.get("width", 0) >= 1280)
        with _probe_lock:
            _sans_matrice_cache[key] = hit
    return hit


def probe_many(paths, workers=8):
    """Mesure une liste de fichiers en parallele.

    ffprobe passe l'essentiel de son temps a demarrer et a lire le disque,
    pas a calculer: les lancer a plusieurs divise l'attente d'autant. Sert a
    l'ouverture d'une serie, ou il y a des dizaines de clips a mesurer."""
    paths = list(paths)
    todo = [p for p in paths if not _cached(p)]
    if len(todo) > 1:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(probe, todo))
        save_probe_cache()
    return {p: probe(p) for p in paths}


def _cached(path):
    try:
        st = os.stat(path)
    except OSError:
        return True                      # illisible: inutile de paralleliser
    return f"{path}|{st.st_mtime}|{st.st_size}" in _probe_cache


def frame_luma(video_path, t):
    """Luminance moyenne (0-255) de l'image a l'instant t, ou None.

    On reduit l'image a un seul pixel: c'est ffmpeg qui fait la moyenne,
    donc rien a decoder cote Python."""
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(t), "-i", video_path,
         "-frames:v", "1", "-vf", "scale=1:1,format=gray", "-f", "rawvideo", "-"],
        capture_output=True)
    return r.stdout[0] if r.stdout else None


def make_thumbnail(video_path, thumb_path, width=360):
    """Vignette JPEG pour l'interface. Echec silencieux: c'est cosmetique.

    On ne prend plus l'image a 1 s aveuglement: certains clips commencent
    par un plan sombre (un ecran filme dans une piece noire, par exemple)
    et la vignette sortait toute noire, ce qui donnait l'impression d'une
    video ratee. On echantillonne donc quelques instants et on garde le
    plus lumineux — a condition qu'il le soit assez pour qu'on distingue
    quelque chose."""
    duration, _ = probe(video_path)
    if not duration:
        candidats = [0]
    else:
        # Reparti sur toute la video, en evitant la toute premiere et la
        # toute derniere image (souvent un fondu ou une transition).
        candidats = [round(duration * f, 2) for f in (.12, .3, .5, .7, .88)]

    best, best_l = candidats[0], -1
    for t in candidats:
        l = frame_luma(video_path, t)
        if l is None:
            continue
        if l > best_l:
            best, best_l = t, l
        if l >= 90:            # assez lumineuse, inutile de chercher mieux
            break

    # Une source HDR donnerait une vignette delavee: meme conversion qu'au
    # montage, avec les memes replis (voir chaines_hdr).
    for pre in chaines_hdr(video_path):
        r = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", str(best), "-i", video_path,
             "-frames:v", "1", "-vf", f"{pre + ',' if pre else ''}scale={width}:-2",
             "-q:v", "4", thumb_path],
            capture_output=True)
        if r.returncode == 0 and Path(thumb_path).exists():
            break
    return Path(thumb_path).exists()


# ------------------------------------------------------------------
# Construction des filtres
# ------------------------------------------------------------------

def escape_drawtext(text):
    """drawtext: backslash, apostrophe, deux-points et % sont speciaux."""
    for ch in ("\\", "'", ":", "%"):
        text = text.replace(ch, "\\" + ch)
    return text


def slot_captions(slot, serie_captions):
    """Textes utilisables pour un clip de cette categorie.

    Les textes propres a la categorie ont la priorite; ceux de la serie
    servent de repli pour les categories qui n'en definissent pas."""
    own = [c for c in (slot or {}).get("captions", []) if c and c.strip()]
    return own or [c for c in (serie_captions or []) if c and c.strip()]


def slot_speed(slot, s):
    """Plage de vitesse a appliquer: celle de la categorie si elle en
    definit une, sinon celle de la serie. Jamais en dessous de 1x --
    un ralenti etirerait le clip, ce qui se voit tout de suite."""
    lo = float((slot or {}).get("speed_min") or 0)
    hi = float((slot or {}).get("speed_max") or 0)
    if hi <= 0:
        lo, hi = float(s["speed_min"]), float(s["speed_max"])
    if lo <= 0:
        lo = hi
    lo, hi = max(1.0, lo), max(1.0, hi)
    return (lo, hi) if lo <= hi else (hi, lo)


def roll_variation(s, texts, texts_ok, slot=None, bags=None):
    """Tire au sort les parametres de variation d'un clip."""
    # Le recadrage rogne puis re-agrandit: si la source fait deja la taille
    # de sortie, c'est une perte de nettete seche. On peut donc le couper
    # categorie par categorie, typiquement sur le clip d'accroche.
    can_zoom = (slot or {}).get("allow_zoom", True)

    # Vitesse: une categorie peut imposer la sienne (certains clips sont
    # toujours acceleres). Sinon on prend celle de la serie.
    sp_min, sp_max = slot_speed(slot, s)

    # Les textes sont tires comme les clips: sans remise, pour que chaque
    # phrase passe une fois avant qu'aucune ne repasse.
    pool = slot_captions(slot, texts)
    caption = None
    if pool and texts_ok and random.random() < s["caption_prob"]:
        if bags is not None:
            key = "texte|" + (slot or {}).get("id", "serie")
            drawn = draw_from_bag(bags, key, pool, 1)
            caption = drawn[0] if drawn else None
        else:
            caption = random.choice(pool)
    v = {
        # La vitesse n'est pas une "retouche": a 1.00-1.04 c'est
        # imperceptible et ca fait partie du montage. Elle reste toujours
        # active et n'entre pas dans le tirage ci-dessous.
        "speed": round(random.uniform(sp_min, sp_max), 3),
        "zoom": (round(random.uniform(s["zoom_min"], s["zoom_max"]), 3)
                 if can_zoom else 0.0),
        "crop_x": round(random.uniform(0, 1), 3),
        "crop_y": round(random.uniform(0, 1), 3),
        "brightness": round(random.uniform(-s["brightness_amp"], s["brightness_amp"]), 3),
        "contrast": round(random.uniform(1 - s["contrast_amp"], 1 + s["contrast_amp"]), 3),
        "saturation": round(random.uniform(1 - s["saturation_amp"], 1 + s["saturation_amp"]), 3),
        "hue": round(random.uniform(-s["hue_amp"], s["hue_amp"]), 2),
        "sharpen": round(random.uniform(s.get("sharpen_min", 0),
                                        s.get("sharpen_max", 0)), 3),
        # Petit decalage aleatoire a l'interieur du tiers choisi.
        "caption_jitter": round(random.uniform(-0.015, 0.015), 4),
        "caption": caption,
    }
    return keep_one_effect(v) if s.get("one_effect") else v


# Retouches mutuellement exclusives, avec de quoi les neutraliser.
_EFFECTS = {
    "recadrage": {"zoom": 0.0},
    "nettete":   {"sharpen": 0.0},
    "couleurs":  {"brightness": 0.0, "contrast": 1.0, "saturation": 1.0, "hue": 0.0},
}


def keep_one_effect(v):
    """Ne garde qu'UNE retouche parmi celles qui se sont declenchees.

    Empiler recadrage + couleurs + nettete sur le meme clip
    cumule les degradations sans rien apporter de plus: une seule suffit
    a changer l'empreinte, et le spectateur ne voit presque rien."""
    actives = [name for name, off in _EFFECTS.items()
               if any(v[k] != neutral for k, neutral in off.items())]
    if len(actives) <= 1:
        return v
    garde = random.choice(actives)
    for name, off in _EFFECTS.items():
        if name != garde:
            v.update(off)
    return v


def build_video_filter(v, s, fill=False, hdr="", rec709=False):
    """`hdr` = debut de chaine qui ramene une source HDR en SDR (une des
    valeurs de chaines_hdr), ou "" pour une source ordinaire. `rec709` pose
    les etiquettes Rec.709 en fin de chaine (voir SORTIE_709)."""
    f = []
    # Source HDR (iPhone): ramenee en SDR avant tout le reste, pour que les
    # retouches et le texte travaillent sur les couleurs finales.
    if hdr:
        f.append(TONEMAP if hdr is True else hdr)
    # Crop DECENTRE: change la composition, pas seulement l'echelle.
    # A zoom nul on saute le filtre: aucun rognage, aucune remise a
    # l'echelle, l'image source passe telle quelle.
    if v["zoom"] > 0.001:
        p = round(1 - v["zoom"], 3)
        f.append(f"crop=iw*{p}:ih*{p}:(iw-ow)*{v['crop_x']}:(ih-oh)*{v['crop_y']}")
    # PTS-STARTPTS remet l'horloge du clip a zero. Sans ca, un clip decoupe
    # (ou filme en frequence d'images variable, comme les .MOV iPhone) garde
    # l'horodatage d'origine: le lecteur affiche la premiere image figee
    # pendant tout le decalage avant que la video demarre.
    f.append(f"setpts={1/v['speed']}*(PTS-STARTPTS)")
    f.append(f"eq=brightness={v['brightness']}:contrast={v['contrast']}"
             f":saturation={v['saturation']}")
    f.append(f"hue=h={v['hue']}")
    # Normalisation: sans ca, concatener des sources de resolutions ou de
    # framerates differents produit une video cassee.
    f.append(f"fps={s['fps']}")
    if fill:
        # « Remplir le cadre »: on agrandit jusqu'a couvrir tout l'ecran et on
        # rogne l'exces, au lieu de bandes noires. Une capture d'ecran
        # d'iPhone (19,5:9) perd un peu de haut et de bas, mais occupe tout
        # le Reel — les bandes noires font « video recyclee ».
        f.append(f"scale={s['width']}:{s['height']}:force_original_aspect_ratio=increase")
        f.append(f"crop={s['width']}:{s['height']}")
    else:
        f.append(f"scale={s['width']}:{s['height']}:force_original_aspect_ratio=decrease")
        f.append(f"pad={s['width']}:{s['height']}:(ow-iw)/2:(oh-ih)/2")
    f.append("setsar=1")

    # Nettete, apres le redimensionnement (c'est la qu'elle est la plus utile:
    # elle rattrape le flou introduit par le scale). Negatif = flou.
    if abs(v.get("sharpen", 0)) > 0.01:
        f.append(f"unsharp=5:5:{v['sharpen']}:5:5:0")
    # Primaires et courbe: une simple etiquette, que les options de sortie ne
    # suffisent pas a poser. (La matrice et la plage, elles, sont converties
    # pour de bon par SORTIE_709.)
    if rec709 and "setparams" in _filtres():
        f.append("setparams=color_primaries=bt709:color_trc=bt709")
    return ",".join(f)


def _chevauchement(a0, a1, fenetres):
    """Secondes communes entre [a0, a1] et des fenetres deja utilisees."""
    return sum(max(0.0, min(a1, b0 + bl) - max(a0, b0)) for b0, bl in fenetres)


def pick_trim(path, s, slot=None, speed=1.0, bags=None):
    """Fenetre aleatoire dans le clip -> (start, duree) ou (None, None).

    Si la categorie fixe une duree (slot.dur_min / dur_max en secondes), on
    decoupe une fenetre au hasard qui donnera exactement cette duree en
    sortie. Comme la variation de vitesse change la duree, on prend
    `cible * vitesse` dans la source pour compenser.

    Sans duree fixee: (None, None) = le clip est pris en entier.

    Le decoupage est la variation la plus efficace du lot: des points
    d'entree/sortie differents changent la sequence de frames elle-meme.
    """
    dmax = float((slot or {}).get("dur_max") or 0)
    if dmax <= 0:
        return None, None              # clip complet

    duration, _ = probe(path)
    if duration <= 0:
        return None, None

    dmin = float((slot or {}).get("dur_min") or 0)
    if dmin <= 0 or dmin > dmax:
        dmin = dmax

    target = random.uniform(dmin, dmax)
    need = target * speed              # compense l'acceleration
    if need >= duration:
        # Clip plus court que la cible: on le prend EN ENTIER, tel quel.
        # Jamais de ralenti pour l'etirer, jamais de noir pour combler --
        # la video sera simplement un peu plus courte que prevu.
        return None, None
    if bags is None:
        return round(random.uniform(0, duration - need), 3), round(need, 3)

    # Memoire des fenetres deja decoupees dans ce clip: au hasard pur, la
    # 2e video tiree d'une prise de 12 s reprenait souvent la moitie des
    # images de la 1re. On tire 12 departs et on garde celui qui recoupe le
    # moins le deja-vu. C'est ce qui fait qu'une prise de visage donne
    # plusieurs accroches vraiment differentes avant de se repeter.
    key = "fen|" + str(path)
    deja = [tuple(f) for f in bags.get(key, []) if isinstance(f, list) and len(f) == 2]
    best, best_c = None, None
    for _ in range(12):
        st = random.uniform(0, duration - need)
        c = _chevauchement(st, st + need, deja)
        if best_c is None or c < best_c:
            best, best_c = st, c
        if c == 0:
            break
    # 60 fenetres gardees au plus: au-dela le clip est de toute facon epuise.
    bags[key] = [[round(best, 3), round(need, 3)]] + [list(f) for f in deja][:59]
    return round(best, 3), round(need, 3)


# ------------------------------------------------------------------
# Rendu
# ------------------------------------------------------------------

class RenderError(Exception):
    pass


def caption_y(video_h, cap_h, position, jitter=0.0):
    """Position verticale du bloc de texte, selon le tiers demande.

    Un petit decalage aleatoire evite que le texte tombe toujours au pixel
    pres au meme endroit. Le resultat est borne pour ne jamais deborder."""
    if position == "milieu":
        y = (video_h - cap_h) / 2.0
    elif position == "bas":
        y = video_h * (0.76 + jitter) - cap_h / 2.0
    else:                                   # haut (defaut)
        y = video_h * (0.13 + jitter)
    return int(max(video_h * 0.03, min(y, video_h * 0.95 - cap_h)))


def process_clip(src, dst, s, texts, texts_ok, slot=None, cache_dir=None, bags=None):
    v = roll_variation(s, texts, texts_ok, slot, bags)
    # La vitesse est tiree avant le decoupage: la duree cible en depend.
    start, keep = pick_trim(src, s, slot, v["speed"], bags)

    cmd = ["ffmpeg", "-y", "-v", "error"]
    if start is not None:
        cmd += ["-ss", str(start), "-t", str(keep)]
    cmd += ["-i", src]
    idx = 1

    # Le son des clips sources est TOUJOURS remplace par du silence, que la
    # source en ait ou non. On garde une piste audio (vide) plutot que pas
    # de piste du tout: le demuxeur concat exige les memes flux partout, et
    # une musique de fond pourra s'y mixer a l'assemblage.
    cmd += ["-f", "lavfi", "-i", f"anullsrc=r={TARGET_AR}:cl=stereo"]
    silence_idx = idx
    idx += 1

    # Le texte est une image PNG transparente dessinee par captions.py,
    # incrustee avec `overlay`. ffmpeg de Homebrew n'a pas `drawtext`.
    cap_idx, cap_y = None, 0
    if v["caption"] and texts_ok:
        rendered = captions.cached(
            v["caption"], s["width"], s["height"],
            cache_dir or Path(dst).parent,
            size=int(s.get("caption_size", 56)),
            style=s.get("caption_style", "contour"),
            font_ps=captions.FONT_CHOICES.get(s.get("caption_font", "")),
            outline=s.get("caption_outline"))
        if rendered:
            png, cap_h = rendered
            cmd += ["-i", png]
            cap_idx = idx
            idx += 1
            cap_y = caption_y(s["height"], cap_h,
                              (slot or {}).get("text_pos", "haut"),
                              v["caption_jitter"])

    entrees = cmd
    source_hdr = est_hdr(src)
    r = None
    # Une source HDR a plusieurs chaines possibles (voir chaines_hdr): on
    # prend la premiere que ffmpeg accepte. Une source ordinaire n'en a qu'une.
    sans_matrice = (not source_hdr) and hd_sans_matrice(src) and "setparams" in _filtres()
    for pre in chaines_hdr(src):
        if sans_matrice:
            pre = "setparams=colorspace=bt709"       # voir hd_sans_matrice
        # Etiquettes de couleur identiques sur tous les morceaux (voir
        # SORTIE_709) — sauf pour une source HDR qu'on n'a pas pu convertir:
        # l'etiqueter Rec.709 serait mentir sur ce que contient l'image.
        rec709 = bool(pre) or not source_hdr
        fc = f"[0:v]{build_video_filter(v, s, bool((slot or {}).get('remplir')), pre, rec709)}[vb]"
        vout = "[vb]"
        if cap_idx is not None:
            fc += f";[vb][{cap_idx}:v]overlay=(W-w)/2:{cap_y}[vo]"
            vout = "[vo]"

        cmd = entrees + ["-filter_complex", fc, "-map", vout, "-map", f"{silence_idx}:a:0"]
        # anullsrc est infini: -shortest coupe le silence a la fin de la video,
        # et garantit que les deux pistes font exactement la meme duree.
        cmd += ["-shortest"]

        cmd += [# fps_mode cfr force une cadence constante: les sources iPhone
                # sont en frequence variable et produisent sinon des saccades.
                "-fps_mode", "cfr", "-r", str(s["fps"]),
                # Morceau intermediaire: quasi-sans-perte et rapide. Il sera
                # re-encode a l'assemblage, donc toute compression appliquee ici
                # serait une degradation pure ajoutee a celle du rendu final.
                "-c:v", "libx264", "-preset", "veryfast",
                "-crf", str(INTERMEDIATE_CRF), "-pix_fmt", "yuv420p"]
        if rec709:
            cmd += SORTIE_709
        cmd += ["-c:a", "aac", "-b:a", "256k", "-ar", str(TARGET_AR), "-ac", "2",
                # negative_cts_offsets laisse la premiere image a l'instant 0.
                # (`-avoid_negative_ts make_zero` decalait tout de 2 images, ce
                # que le MP4 final encode en "edition vide" = ecran noir avant
                # le debut de la video.)
                "-movflags", "+negative_cts_offsets", dst]

        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            break
    if r is None or r.returncode != 0:
        raise RenderError(f"{Path(src).name}: {(r.stderr if r else '')[-500:]}")
    return v, start


def assemble(parts, dst, tmp_dir, music_files, s, bags=None, pick=None):
    """Concatene les morceaux, mixe une musique si dispo.

    La musique est appliquee sur la video assemblee (pas clip par clip),
    sinon elle repartirait de zero a chaque raccord.

    Avec `bags`, la musique est tiree sans remise comme les clips: au
    hasard pur, sur 5 morceaux, le meme revenait deux fois de suite une
    video sur cinq — et le son est l'empreinte la plus reconnaissable.

    `pick` = (piste, debut) impose par la bibliotheque de sons: la video
    demarre pile sur le passage choisi (le refrain), sans tirage.
    Renvoie (piste, debut), ou (None, 0) sans musique.
    """
    list_file = os.path.join(tmp_dir, f"concat_{uuid.uuid4().hex}.txt")
    with open(list_file, "w", encoding="utf-8") as f:
        for p in parts:
            f.write(f"file '{os.path.abspath(p)}'\n")

    # -reinit_filter 0: filet de securite. Les morceaux ont tous la meme
    # taille, la meme cadence et (voir SORTIE_709) les memes etiquettes de
    # couleur; s'il en restait un different, ffmpeg reconstruirait ses filtres
    # en plein assemblage et jetterait la suite de la video sans rien dire.
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
           "-reinit_filter", "0", "-i", list_file]
    track, offset, fondu = None, 0, 0.8

    if s.get("mute"):
        music_files = []          # pas de musique sur une video muette
        pick = None
    if pick:
        music_files = [pick[0]]   # son impose par la bibliotheque

    # setpts/asetpts remettent les DEUX pistes a zero. Sans ca la piste
    # video demarrait quelques dizaines de millisecondes apres l'audio, ce
    # que le conteneur MP4 encode comme une "edition vide" -- et que les
    # lecteurs affichent en noir avant la premiere image.
    vchain = "[0:v]setpts=PTS-STARTPTS[vout]"

    if music_files:
        boucle = False
        if pick:
            # Le refrain doit tomber tout de suite: fondu tres court, juste
            # assez pour eviter un clic.
            track, offset, fondu = pick[0], float(pick[1] or 0), 0.15
            # Garde-fou sur les vraies durees: un debut trop tardif laisserait
            # une fin de video muette. Un son plus court que la video tourne
            # en boucle plutot que de s'arreter net.
            mdur, _ = probe(track)
            vdur = sum(_duree_brute(p) for p in parts)
            if mdur > 0 and vdur > 0:
                offset = round(max(0.0, min(offset, mdur - vdur)), 2)
                boucle = mdur - offset < vdur
        else:
            if bags is not None:
                track = (draw_from_bag(bags, "musique", music_files, 1)
                         or [random.choice(music_files)])[0]
            else:
                track = random.choice(music_files)
            mdur, _ = probe(track)
            offset = round(random.uniform(0, max(0, mdur - 20)), 2) if mdur > 25 else 0
        vol = round(random.uniform(s["music_volume_min"], s["music_volume_max"]), 3)
        lufs = float(s.get("music_lufs", -14.0) or 0)
        # normalize=0: amix divisait sinon chaque entree par leur nombre
        # (-6 dB), en plus du volume deja bas — d'ou des videos quasi muettes.
        # loudnorm ramene ensuite l'ensemble au niveau cible; il ressort en
        # 192 kHz, d'ou le aresample qui suit. music_lufs a 0 = ancien rendu.
        level = (f"loudnorm=I={lufs}:TP=-1.5:LRA=11,aresample={TARGET_AR},"
                 if lufs < 0 else "dynaudnorm=p=0.9,")
        cmd += (["-stream_loop", "-1"] if boucle else []) + ["-ss", str(offset), "-i", track,
                "-filter_complex",
                f"{vchain};"
                f"[1:a]volume={vol},afade=t=in:d={fondu},aresample={TARGET_AR},"
                f"aformat=sample_fmts=fltp:channel_layouts=stereo[bg];"
                f"[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0"
                f"{':normalize=0' if lufs < 0 else ''},"
                f"{level}asetpts=PTS-STARTPTS[aout]",
                "-map", "[vout]", "-map", "[aout]"]
    else:
        cmd += ["-filter_complex", f"{vchain};[0:a]asetpts=PTS-STARTPTS[aout]",
                "-map", "[vout]", "-map", "[aout]"]

    # Ne PAS recopier les flux ici (-c copy): le demuxeur concat produit
    # alors des horodatages non monotones et des images figees de plusieurs
    # secondes. On re-encode donc, mais les morceaux d'entree ont ete faits
    # en quasi-sans-perte (INTERMEDIATE_CRF), si bien que cet encodage-ci
    # est le seul qui degrade vraiment l'image.
    cmd += ["-c:v", "libx264", "-preset", s.get("preset", "medium"),
            "-crf", str(s.get("crf", 20)), "-pix_fmt", "yuv420p",
            "-maxrate", MAX_VIDEO_RATE, "-bufsize", MAX_VIDEO_BUF,
            "-c:a", "aac", "-b:a", AUDIO_RATE, "-ar", str(TARGET_AR), "-ac", "2",
            # Meme raison que pour les morceaux: pas d'edition vide en tete,
            # la video demarre a l'instant 0.
            "-muxdelay", "0", "-muxpreload", "0",
            "-movflags", "+faststart+negative_cts_offsets", dst]

    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        os.remove(list_file)
    except OSError:
        pass
    if r.returncode != 0:
        raise RenderError(f"assemblage: {r.stderr[-500:]}")
    return track, offset


def draw_from_bag(bags, key, pool, n):
    """Tire n clips SANS REMISE dans un sac melange.

    Un tirage aleatoire independant repete naturellement: sur 7 clips, le
    meme sort 3 fois d'affilee environ une fois sur 50. Ici on melange le
    lot entier et on le vide avant d'en refaire un: chaque clip passe donc
    une fois avant qu'aucun ne repasse. C'est la variete maximale possible.
    """
    pool = list(pool)
    if not pool or n <= 0:
        return []

    bag = [b for b in bags.get(key, []) if b in pool]   # oublie les fichiers disparus
    last = bags.get(key + "|last")
    out = []

    while len(out) < min(n, len(pool)):
        if not bag:
            bag = list(pool)
            random.shuffle(bag)
            # Evite que le nouveau sac redonne aussitot le dernier clip joue.
            if len(bag) > 1 and bag[0] == last:
                bag.append(bag.pop(0))
        pick = bag.pop(0)
        if pick in out:                 # deja pris pour cette meme video
            continue
        out.append(pick)
        last = pick

    bags[key] = bag
    bags[key + "|last"] = last
    return out


def pick_sequence(serie_dir, serie, bags=None):
    """Choisit les clips d'une video: pour chaque slot, min..max clips."""
    if bags is None:
        bags = {}
    slots = list(serie["slots"])
    if serie["settings"].get("shuffle_slots"):
        random.shuffle(slots)

    sequence = []
    for slot in slots:
        pool = slot_clips(serie_dir, slot)
        if not pool:
            continue
        n = random.randint(int(slot.get("min", 1)), int(slot.get("max", 1)))
        picked = draw_from_bag(bags, slot["id"], pool, n)
        random.shuffle(picked)
        sequence += [(slot, p) for p in picked]
    return sequence


def combination_count(serie_dir, serie):
    """Nombre de structures distinctes possibles (indicatif)."""
    total = 1
    for slot in serie["slots"]:
        pool = slot_clips(serie_dir, slot)
        if not pool:
            continue
        lo, hi = int(slot.get("min", 1)), int(slot.get("max", 1))
        ways = 0
        for n in range(lo, hi + 1):
            if n <= len(pool):
                c = 1
                for k in range(n):
                    c = c * (len(pool) - k) // (k + 1)
                ways += c
        total *= max(1, ways)
    return total


# ------------------------------------------------------------------
# Structure de serie sur disque
# ------------------------------------------------------------------

def slot_dir(serie_dir, slot_id):
    return Path(serie_dir) / "slots" / slot_id


def list_media(folder, exts):
    """Liste les fichiers d'un dossier. Ignore les fichiers caches et les
    .part (uploads en cours) et les fichiers fantomes de synchro cloud."""
    try:
        d = Path(folder)
        if not d.is_dir():
            return []
        return sorted(str(f) for f in d.iterdir()
                      if f.is_file()
                      and not f.name.startswith(".")
                      and f.suffix.lower() in exts)
    except OSError:
        return []


def slot_clips(serie_dir, slot):
    """Clips d'une categorie.

    Si le slot a un `path`, les clips sont lus EN DIRECT depuis ce dossier
    (Google Drive synchronise, dossier local, disque externe...). Rien n'y
    est jamais ecrit ni supprime. Sinon on utilise le stockage interne de
    la serie, alimente par glisser-deposer.
    """
    if isinstance(slot, str):                    # compat: ancien appel par id
        slot = {"id": slot}
    if slot.get("path"):
        return list_media(slot["path"], VIDEO_EXTS)
    return list_media(slot_dir(serie_dir, slot["id"]), VIDEO_EXTS)


def load_bags(serie_dir):
    """Etat des sacs de tirage. Persiste sur disque pour que relancer
    l'app ne redonne pas systematiquement le meme premier clip."""
    f = Path(serie_dir) / "bags.json"
    try:
        with open(f, encoding="utf-8") as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save_bags(serie_dir, bags):
    f = Path(serie_dir) / "bags.json"
    try:
        tmp = f.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(bags, fh)
        os.replace(str(tmp), str(f))
    except OSError:
        pass


def output_dir(serie_dir, serie=None):
    """Dossier de sortie de la serie.

    Par defaut output/<Serie>/ a la racine du projet, pour que toutes
    les videos generees soient regroupees au meme endroit. Les anciennes
    series qui n'ont pas de `output_dir` gardent leur dossier interne."""
    if serie and serie.get("output_dir"):
        return Path(serie["output_dir"])
    return Path(serie_dir) / "output"


def music_files(serie_dir, serie=None):
    if serie and serie.get("music_dir"):
        return list_media(serie["music_dir"], AUDIO_EXTS)
    return list_media(Path(serie_dir) / "music", AUDIO_EXTS)


def scan_subfolders(root):
    """Sous-dossiers d'un dossier, avec le nombre de videos dans chacun.
    Sert a proposer automatiquement une categorie par sous-dossier."""
    out = []
    try:
        for d in sorted(Path(root).iterdir()):
            if d.is_dir() and not d.name.startswith("."):
                out.append({"name": d.name, "path": str(d),
                            "clips": len(list_media(d, VIDEO_EXTS)),
                            "audio": len(list_media(d, AUDIO_EXTS))})
    except OSError:
        pass
    return out


def generate(serie_dir, serie, count, progress=None, stop_flag=None):
    """Genere `count` videos. `progress(done, total, message)` est appele
    apres chaque etape. Retourne la liste des fichiers produits."""
    serie_dir = Path(serie_dir)
    out_dir = output_dir(serie_dir, serie)
    # Le temporaire reste dans la serie: on ne veut pas de dossier
    # technique au milieu des videos finies.
    #
    # UN DOSSIER PAR EXECUTION. Avant, toutes les generations d'une meme
    # serie partageaient `_tmp`, et chacune faisait un rmtree du dossier
    # entier en terminant: lancer une generation pendant qu'une autre
    # tournait (par exemple depuis la file d'attente et depuis la serie)
    # effacait les morceaux intermediaires de l'autre en plein montage.
    # Le concat lisait alors des fichiers tronques, dont la duree annoncee
    # ne correspondait plus aux images -> image figee de plusieurs secondes
    # au milieu de la video.
    tmp_dir = serie_dir / "_tmp" / f"run-{uuid.uuid4().hex[:10]}"
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    s = dict(DEFAULT_SETTINGS)
    s.update(serie.get("settings", {}))
    texts = [c for c in serie.get("captions", []) if c.strip()]
    texts_ok = captions.available()
    music = music_files(serie_dir, serie)
    # Bibliotheque de sons partagee (page Sounds): le son est choisi video
    # par video, pas tire dans le dossier de la serie. Import tardif: sons
    # importe remixer pour mesurer les fichiers.
    biblio = None
    if s.get("music_library") and not s.get("mute"):
        try:
            import sons as biblio
        except ImportError:
            biblio = None
    # Les PNG de texte sont mis en cache: le meme texte n'est dessine
    # qu'une fois pour tout le lot.
    cache_dir = serie_dir / "thumbs" / "_captions"
    bags = load_bags(serie_dir)

    made = []
    try:
        for i in range(1, count + 1):
            if stop_flag and stop_flag():
                break
            sequence = pick_sequence(serie_dir, serie, bags)
            if not sequence:
                raise RenderError("Aucun clip disponible. Ajoute des clips dans tes catégories.")

            parts = []
            for j, (slot, src) in enumerate(sequence):
                if progress:
                    progress(i - 1, count,
                             f"Vidéo {i}/{count} — {slot['name']} ({j+1}/{len(sequence)})")
                dst = str(tmp_dir / f"p_{uuid.uuid4().hex}.mp4")
                process_clip(src, dst, s, texts, texts_ok, slot, cache_dir, bags)
                parts.append(dst)

            if progress:
                progress(i - 1, count, f"Vidéo {i}/{count} — assemblage")

            stamp = time.strftime("%Y%m%d-%H%M%S")
            name = f"{stamp}-{uuid.uuid4().hex[:4]}.mp4"
            final = str(out_dir / name)
            pick = None
            if biblio:
                try:
                    pick = biblio.choisir(serie.get("id") or serie_dir.name)
                except Exception:                           # noqa: BLE001
                    pick = None      # bibliotheque illisible: dossier de la serie
                if pick:
                    # Note DES le choix, pas apres le montage: deux comptes qui
                    # montent en meme temps prenaient sinon le meme son, chacun
                    # ignorant celui de l'autre pendant les secondes d'assemblage.
                    # Un echec d'ecriture ici ne doit pas faire perdre le son.
                    try:
                        biblio.noter(serie_dir, name, pick[0], pick[1], True, fait=False)
                    except Exception:                       # noqa: BLE001
                        pass
            try:
                track, debut = assemble(parts, final, str(tmp_dir), music, s, bags, pick)
            except RenderError:
                if not pick:
                    raise
                # Le son choisi ne passe pas dans ffmpeg (fichier abime): il
                # sort de la rotation et la video est refaite sans lui, au
                # lieu de faire echouer toute la fournee.
                try:
                    biblio.marquer_casse(pick[0])
                except Exception:                           # noqa: BLE001
                    pass
                pick = None
                track, debut = assemble(parts, final, str(tmp_dir), music, s, bags, None)

            make_thumbnail(final, str(serie_dir / "thumbs" / (name + ".jpg")))
            if track:
                # Video ecrite: son registre passe a « fait ». Un son tire dans
                # le dossier de la serie est note aussi, pour le planning.
                try:
                    import sons
                    sons.noter(serie_dir, name, track, debut, bool(pick), fait=True)
                except Exception:                           # noqa: BLE001
                    pass

            for p in parts:
                try:
                    os.remove(p)
                except OSError:
                    pass

            made.append(name)
            save_bags(serie_dir, bags)
            if progress:
                progress(i, count, f"Vidéo {i}/{count} terminée")
    finally:
        save_bags(serie_dir, bags)
        # On ne supprime QUE le dossier de cette execution.
        shutil.rmtree(str(tmp_dir), ignore_errors=True)
        try:
            # Le parent `_tmp` ne part que s'il est vide, donc jamais tant
            # qu'une autre generation y travaille.
            (serie_dir / "_tmp").rmdir()
        except OSError:
            pass

    return made
