# -*- coding: utf-8 -*-
"""Bibliotheque de sons partagee et choix du son de chaque video.

Ilyan depose ses sons TikTok une seule fois, pour tous les comptes :
- les fichiers vivent dans sounds/, leurs reglages (titre, debut du
  refrain, actif ou non) dans sounds/library.json ;
- au montage, remixer.generate() demande ici quel son poser a une video
  (voir `choisir`) : celui que ce compte a le moins utilise, jamais deux fois
  de suite le meme, en evitant celui que les autres comptes passent deja ;
- chaque video retient son son dans series/<id>/sons.json (voir `noter`) :
  c'est ce registre qui sert a compter, et que le planning et Analytics
  affichent ;
- au moment de planifier, `ordonner` range les videos dans les creneaux pour
  que deux posts qui se suivent n'aient pas le meme son.

Un fichier video depose (la video TikTok elle-meme) est converti : on n'en
garde que le son. Bibliotheque standard seulement, comme le reste.

Deux processus touchent ces fichiers (le serveur et la tache planifiee) :
library.json ne s'ecrit que sous un verrou fichier, et toute ecriture passe
par un fichier temporaire propre au processus puis un remplacement atomique."""

import array
import calendar
import json
import os
import random
import re
import subprocess
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIR = ROOT / "sounds"
LIB = DIR / "library.json"
VERROU = DIR / ".library.lock"
SERIES_DIR = ROOT / "series"

AUDIO_EXTS = (".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg")
VIDEO_EXTS = (".mp4", ".mov", ".m4v", ".webm", ".mkv")

# Une video de l'autopilote dure 8 a 11 s : on cherche le passage fort sur
# 12 s, et on ne demarre jamais si pres de la fin que le son s'arrete avant
# l'image.
EXTRAIT = 12.0
# Un fichier court est deja « le son TikTok » (l'extrait qui tourne) : on
# le prend depuis le debut plutot que de chercher un refrain dedans.
COURT = 35.0
# Le registre d'une serie ne garde que les videos recentes.
GARDE = 120 * 86400
# Un son choisi pour une video encore en montage compte deja comme
# utilise pendant ce delai (un montage dure 10 a 30 s).
EN_COURS = 600
# Un fichier illisible n'est re-mesure qu'a cet intervalle (sauf s'il change).
RECHECK = 600
# Statuts de post qui comptent comme « passe » : un post annule ou en
# erreur n'a jamais ete vu par personne.
COMPTES = ("a_envoyer", "programme", "publie", "simule")

_lock = threading.Lock()


# ------------------------------------------------------------------
# Fichiers : lecture, ecriture atomique, verrou entre processus
# ------------------------------------------------------------------

def _charger():
    try:
        data = json.loads(LIB.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict) or not isinstance(data.get("tracks"), dict):
        data = {"tracks": {}}
    return data


def _ecrire(path, data):
    """Ecriture atomique: un lecteur ne voit jamais un fichier a moitie
    ecrit. Le temporaire porte le numero du processus (deux processus ne
    se marchent pas dessus), et le remplacement est retente: sous Windows
    il echoue tant qu'un autre processus a le fichier ouvert en lecture."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    for essai in range(40):
        try:
            os.replace(str(tmp), str(path))
            return
        except PermissionError:
            if essai == 39:
                tmp.unlink(missing_ok=True)
                raise
            time.sleep(0.05)


@contextmanager
def _verrou(delai=10.0):
    """Verrou fichier pour library.json, partage par le serveur et la tache
    planifiee. Un verrou vieux de plus de 60 s est un reste de plantage."""
    DIR.mkdir(exist_ok=True)
    fin = time.time() + delai
    fd = None
    while fd is None:
        try:
            fd = os.open(str(VERROU), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                if time.time() - VERROU.stat().st_mtime > 60:
                    VERROU.unlink(missing_ok=True)
                    continue
            except OSError:
                pass
            if time.time() > fin:
                raise TimeoutError("Sounds library is busy, try again in a moment.")
            time.sleep(0.05)
    try:
        with _lock:
            yield
    finally:
        os.close(fd)
        try:
            VERROU.unlink()
        except OSError:
            pass


def _titre_de(nom):
    t = re.sub(r"[_]+", " ", Path(nom).stem).strip()
    return t[:80] or Path(nom).stem


def _duree(path):
    import remixer                      # import tardif: remixer nous importe aussi
    return remixer.probe(str(path))[0]


def _mesure_brute(path):
    """(duree, a_du_son) sans passer par le cache de remixer: pour les
    fichiers temporaires, qui n'ont rien a y faire."""
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration:stream=codec_type", "-of", "json", str(path)],
                       capture_output=True, text=True)
    try:
        info = json.loads(r.stdout or "{}")
        d = float(info.get("format", {}).get("duration") or 0.0)
        son = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
        return d, son
    except (ValueError, TypeError):
        return 0.0, False


def _borner(debut, duree):
    """Le debut d'un son, borne pour qu'une video de 12 s tienne dedans.
    La meme regle partout: page, apercu et montage entendent la meme chose."""
    d = float(duree or 0)
    return round(max(0.0, min(float(debut or 0), d - EXTRAIT)), 2) if d > EXTRAIT else 0.0


# ------------------------------------------------------------------
# Bibliotheque
# ------------------------------------------------------------------

def trouver_refrain(path, duree=None):
    """Debut du passage le plus fort (souvent le refrain ou le drop, la
    partie qui tourne sur TikTok), en secondes.

    On decode le son en mono a 2 kHz (assez pour mesurer l'energie, cent
    fois plus leger que l'original), puis on cherche la fenetre de 12 s la
    plus forte, avec un bonus quand elle demarre sur une montee nette: on
    veut tomber au debut du refrain, pas au milieu. Seules les 10 premieres
    minutes sont lues: au-dela ce n'est plus un son TikTok, et la memoire
    reste bornee."""
    duree = duree if duree is not None else _duree(path)
    if duree <= COURT:
        return 0.0
    r = subprocess.run(["ffmpeg", "-v", "error", "-t", "600", "-i", str(path), "-ac", "1",
                        "-ar", "2000", "-f", "s16le", "-"], capture_output=True)
    brut = r.stdout[: len(r.stdout) // 2 * 2]
    if not brut:
        return 0.0
    ech = array.array("h")
    ech.frombytes(brut)
    pas = 500                                   # 0,25 s par bloc
    blocs = [sum(x * x for x in ech[i:i + pas]) / pas
             for i in range(0, len(ech) - pas + 1, pas)]
    n = int(EXTRAIT / 0.25)
    if len(blocs) <= n + 16:
        return 0.0
    cumul = [0.0]
    for b in blocs:
        cumul.append(cumul[-1] + b)
    moy = lambda a, b: (cumul[b] - cumul[a]) / max(1, b - a)
    top = max(blocs) or 1.0
    meilleur, debut = -1.0, 0
    # Les 4 premieres secondes sont presque toujours une intro.
    for i in range(16, len(blocs) - n + 1):
        fenetre = moy(i, i + n)
        montee = moy(i, i + 8) - moy(max(0, i - 8), i)      # 2 s apres vs 2 s avant
        # Leger avantage au passage le plus tot: a force egale, c'est le
        # premier refrain qui tourne sur TikTok, pas la reprise finale.
        score = fenetre / top + 0.6 * max(0.0, montee) / top - 0.05 * i / len(blocs)
        if score > meilleur:
            meilleur, debut = score, i
    return _borner(debut * 0.25, duree)


def _menage():
    """Restes d'envois interrompus (.upload-*, .import-*) de plus de 6 h."""
    try:
        for f in DIR.iterdir():
            if (f.name.startswith((".upload-", ".import-")) and f.is_file()
                    and time.time() - f.stat().st_mtime > 6 * 3600):
                f.unlink(missing_ok=True)
    except OSError:
        pass


def scanner():
    """Met la bibliotheque a jour avec le contenu du dossier: un fichier
    pose a la main dans sounds/ est pris en compte, un fichier retire
    disparait, un fichier modifie est re-mesure. Un fichier illisible est
    garde mais marque « broken » (jamais choisi) et re-mesure plus tard:
    il etait peut-etre encore en train d'etre copie. Renvoie la bibliotheque.

    Les mesures (ffprobe, recherche du refrain) se font hors verrou; on
    relit ensuite library.json sous verrou avant d'ecrire, pour ne pas
    effacer un reglage fait entre-temps par l'autre processus."""
    DIR.mkdir(exist_ok=True)
    _menage()
    fichiers = {}
    for f in DIR.iterdir():
        if f.is_file() and f.suffix.lower() in AUDIO_EXTS and not f.name.startswith("."):
            try:
                st = f.stat()
                fichiers[f.name] = (st.st_size, round(st.st_mtime, 2))
            except OSError:
                pass
    lib = _charger()
    now = time.time()
    a_mesurer = []
    for nom, (taille, mtime) in fichiers.items():
        t = lib["tracks"].get(nom)
        change = not t or t.get("size") != taille or abs(float(t.get("mtime") or 0) - mtime) > 0.01
        casse = t and float(t.get("duration") or 0) <= 0 and now - float(t.get("checked") or 0) > RECHECK
        if change or casse:
            a_mesurer.append(nom)
    disparus = [n for n in lib["tracks"] if n not in fichiers]
    if not a_mesurer and not disparus:
        return lib
    mesures = {}
    for nom in a_mesurer:
        p = DIR / nom
        d, son = _mesure_brute(p)
        d = d if son else 0.0
        mesures[nom] = (d, trouver_refrain(p, d) if d > 0 else 0.0, fichiers[nom])
    with _verrou():
        lib = _charger()
        for nom in list(lib["tracks"]):
            if not (DIR / nom).exists():
                del lib["tracks"][nom]
        for nom, (d, debut, (taille, mtime)) in mesures.items():
            if not (DIR / nom).exists():
                continue
            t = lib["tracks"].get(nom)
            if t is None:
                t = lib["tracks"][nom] = {"id": uuid.uuid4().hex[:10], "title": _titre_de(nom),
                                          "start": debut, "active": True, "added": now}
            elif abs(float(t.get("start") or 0) - float(t.get("auto_start") or 0)) < 0.01:
                t["start"] = debut           # pas retouche a la main: on suit la mesure
            t.setdefault("id", uuid.uuid4().hex[:10])
            t.update({"auto_start": debut, "duration": round(d, 2), "size": taille,
                      "mtime": mtime, "checked": now, "broken": d <= 0})
            t["start"] = _borner(t.get("start"), d)
        _ecrire(LIB, lib)
        return lib


def importer(tmp, nom):
    """Range un fichier depose dans la bibliotheque. Une video n'y entre
    que par son son (converti en .m4a). Tout se prepare sous un nom cache
    (.import-…, ignore par `scanner`) et n'apparait sous son vrai nom
    qu'une fois verifie: un scan simultane ne voit jamais un fichier a
    moitie ecrit. Renvoie le nom retenu."""
    DIR.mkdir(exist_ok=True)
    nom = os.path.basename(str(nom or "son").replace("\\", "/"))
    ext = Path(nom).suffix.lower()
    stem = re.sub(r"[^\w\-. ()'&]+", "_", Path(nom).stem).strip(" ._")[:80] or "son"
    if ext in VIDEO_EXTS:
        final = ".m4a"
    elif ext in AUDIO_EXTS:
        final = ext
    else:
        Path(tmp).unlink(missing_ok=True)
        raise ValueError(f"Unsupported file type: {ext or '?'} "
                         "(use mp3, m4a, wav, or a TikTok video).")
    travail = DIR / f".import-{uuid.uuid4().hex}{final}"
    try:
        if ext in VIDEO_EXTS:
            r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(tmp), "-vn",
                                "-ac", "2", "-c:a", "aac", "-b:a", "192k", str(travail)],
                               capture_output=True, text=True)
            if r.returncode != 0:
                raise ValueError(f"No sound found in {nom}.")
        else:
            os.replace(str(tmp), str(travail))
        d, son = _mesure_brute(travail)
        if not son or d <= 0:
            raise ValueError(f"{nom} can't be read as audio.")
        with _verrou():
            dest = _libre(stem, final)
            os.replace(str(travail), str(dest))
    finally:
        Path(tmp).unlink(missing_ok=True)
        travail.unlink(missing_ok=True)
    scanner()
    return dest.name


def _libre(stem, ext):
    dest, i = DIR / f"{stem}{ext}", 1
    while dest.exists():
        dest = DIR / f"{stem}-{i}{ext}"
        i += 1
    return dest


def modifier(nom, data):
    """Titre, debut du passage (secondes) et actif/inactif."""
    with _verrou():
        lib = _charger()
        t = lib["tracks"].get(nom)
        if not t:
            raise KeyError(nom)
        if "title" in data:
            t["title"] = (str(data["title"] or "").strip() or _titre_de(nom))[:80]
        if "start" in data:
            v = data["start"]
            v = t.get("auto_start", 0.0) if v is None or v == "auto" else float(v)
            t["start"] = _borner(v, t.get("duration"))
        if "active" in data:
            t["active"] = bool(data["active"])
        _ecrire(LIB, lib)
        return dict(t, file=nom)


def supprimer(nom):
    """KeyError si le son n'existe pas; OSError si Windows le tient ouvert
    (en ecoute, ou en plein montage) — on reessaiera plus tard."""
    p = DIR / os.path.basename(nom)
    with _verrou():
        lib = _charger()
        if nom not in lib["tracks"] and not p.exists():
            raise KeyError(nom)
        if p.exists():
            p.unlink()
        lib["tracks"].pop(nom, None)
        _ecrire(LIB, lib)


def marquer_casse(chemin):
    """Un son que ffmpeg n'a pas su mixer: il sort de la rotation."""
    nom = os.path.basename(str(chemin))
    with _verrou():
        lib = _charger()
        t = lib["tracks"].get(nom)
        if t:
            t["broken"] = True
            t["checked"] = time.time()
            _ecrire(LIB, lib)


# ------------------------------------------------------------------
# Registre: quel son sur quelle video
# ------------------------------------------------------------------

def _registre(serie_dir):
    try:
        data = json.loads((Path(serie_dir) / "sons.json").read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def noter(serie_dir, video, piste, debut, biblio, fait=True):
    """Appele par le moteur: au choix du son (`fait=False`, la video est
    encore en montage) puis une fois la video ecrite (`fait=True`). Pas de
    verrou: les montages d'une meme serie sont deja faits un par un.

    On garde l'identifiant du son (`sid`): un nouveau son qui reprendrait le
    nom de fichier d'un son supprime n'herite pas de son historique."""
    reg = _registre(serie_dir)
    now = time.time()
    reg = {k: v for k, v in reg.items() if now - float(v.get("at") or 0) < GARDE}
    avant = reg.get(video) or {}
    nom = os.path.basename(str(piste))
    sid = avant.get("sid") or (_charger()["tracks"].get(nom) or {}).get("id")
    reg[video] = {"son": nom, "sid": sid, "start": round(float(debut or 0), 2),
                  # L'heure du CHOIX est gardee: c'est elle qui ordonne les
                  # videos d'un compte (« jamais deux fois de suite »).
                  "at": float(avant.get("at") or now), "biblio": bool(biblio),
                  "fait": bool(fait)}
    _ecrire(Path(serie_dir) / "sons.json", reg)


def titre(nom, lib=None):
    lib = lib or _charger()
    t = lib["tracks"].get(nom)
    return t["title"] if t else _titre_de(nom)


def _meme_son(e, lib):
    """L'entree du registre parle-t-elle du son qui porte AUJOURD'HUI ce
    nom de fichier ? (non si le son a ete supprime puis remplace)."""
    t = lib["tracks"].get(e.get("son"))
    return not (t and e.get("sid") and t.get("id") and t["id"] != e["sid"])


def son_de(serie_id, video, _cache=None):
    """Titre du son d'une video, ou '' si on ne sait pas (video montee
    avant la bibliotheque)."""
    _cache = _cache if _cache is not None else {}
    if serie_id not in _cache:
        _cache[serie_id] = _registre(SERIES_DIR / str(serie_id))
    e = _cache[serie_id].get(video)
    if not e:
        return ""
    if "_lib" not in _cache:
        _cache["_lib"] = _charger()
    lib = _cache["_lib"]
    return titre(e["son"], lib) if _meme_son(e, lib) else _titre_de(e["son"])


def _usages(now, lib=None):
    """Toutes les videos recentes qui portent un son, avec leur sort:
    - d'apres les posts: planifiee, programmee, publiee, en essai (a l'heure
      du post); un post annule ou en erreur ne compte pas;
    - publiee a la main (statut « Posté »): a l'heure du montage;
    - prete a partir (le fichier est la, pas encore planifie ni ecarte) ou
      encore en montage: a l'heure du montage.
    Une video finie puis jetee par le garde-fou n'a plus de fichier: elle ne
    compte pas — seul compte ce que le public verra."""
    import remixer
    import plateau
    lib = lib or _charger()
    posts, ecartees, manuels = {}, set(), set()
    try:
        for r in plateau.db().execute(
                "SELECT video_path, serie_id, account_id, statut, due_at, vues FROM posts "
                "WHERE created_at >= ?", (now - GARDE,)):
            posts[(str(r["serie_id"]), os.path.basename(r["video_path"]))] = dict(r)
        ecartees = {os.path.basename(r[0]) for r in
                    plateau.db().execute("SELECT video_path FROM ecartees")}
    except Exception:                                   # noqa: BLE001
        pass                                           # autopilote jamais lance
    try:
        manuels = {os.path.basename(r[0]) for r in plateau.db().execute(
            "SELECT file_path FROM videos WHERE status = 'Posté'") if r[0]}
    except Exception:                                   # noqa: BLE001
        pass
    out = []
    if not SERIES_DIR.is_dir():
        return out
    for d in SERIES_DIR.iterdir():
        reg = _registre(d)
        if not reg:
            continue
        try:
            serie = json.loads((d / "serie.json").read_text(encoding="utf-8"))
            sortie = Path(remixer.output_dir(d, serie))
        except Exception:                               # noqa: BLE001
            continue
        for video, e in reg.items():
            if not _meme_son(e, lib):
                continue
            at = float(e.get("at") or 0)
            base = {"serie": d.name, "son": e.get("son"), "at": at}
            p = posts.get((d.name, video))
            if p:
                if p["statut"] not in COMPTES:
                    continue
                out.append(dict(base, t=_ts(p["due_at"]) or at, statut=p["statut"],
                                vues=p["vues"], compte=p["account_id"]))
            elif video in manuels:
                out.append(dict(base, t=at, statut="publie", vues=None, compte=None))
            elif video in ecartees:
                continue
            elif (sortie / video).exists() or (not e.get("fait", True) and now - at < EN_COURS):
                out.append(dict(base, t=at, statut="prete", vues=None, compte=None))
    return out


def _ts(iso):
    try:
        return float(calendar.timegm(time.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")))
    except (TypeError, ValueError):
        return 0.0


def choisir(serie_id, now=None):
    """(chemin, debut) du son a poser sur la prochaine video de cette
    serie, ou None si la bibliotheque n'a aucun son utilisable.

    Regle (choisie par Ilyan): repartir au plus egal.
    1. jamais le son de la video precedente de ce compte;
    2. d'abord celui que CE compte a le moins passe sur 24 h;
    3. a egalite, celui que les AUTRES comptes passent le moins (les trois
       comptes ne sortent pas le meme son le meme jour);
    4. puis le moins passe sur 7 jours, puis au hasard."""
    now = now or time.time()
    lib = scanner()
    pistes = {n: t for n, t in lib["tracks"].items()
              if t.get("active", True) and not t.get("broken")
              and float(t.get("duration") or 0) > 0 and (DIR / n).exists()}
    if not pistes:
        return None
    us = _usages(now, lib)
    sid = str(serie_id)
    moi = [u for u in us if u["serie"] == sid]
    dernier = max(moi, key=lambda u: u["at"])["son"] if moi else None

    def compte(liste, depuis):
        c = {}
        for u in liste:
            if u["t"] >= depuis:
                c[u["son"]] = c.get(u["son"], 0) + 1
        return c

    a24, a7 = compte(moi, now - 86400), compte(moi, now - 7 * 86400)
    tous24 = compte([u for u in us if u["serie"] != sid], now - 86400)
    choix = [n for n in pistes if n != dernier] or list(pistes)
    n = min(choix, key=lambda k: (a24.get(k, 0), tous24.get(k, 0), a7.get(k, 0), random.random()))
    t = pistes[n]
    return str(DIR / n), _borner(t.get("start"), t.get("duration"))


def ordonner(serie_id, creneaux, videos, voisins):
    """Range les videos dans les creneaux pour que deux posts qui se suivent
    n'aient pas le meme son, quand c'est possible.

    Le moteur choisit bien un son different de la video precedente, mais le
    garde-fou peut ensuite jeter une video au milieu d'une fournee: les deux
    survivantes qui l'encadraient se retrouvaient cote a cote avec le meme
    son. `voisins` = [(horodatage, nom de video)] des posts deja planifies de
    ce compte autour de ces creneaux. Renvoie `videos` reordonnee."""
    reg = _registre(SERIES_DIR / str(serie_id))
    son = lambda chemin: (reg.get(os.path.basename(str(chemin))) or {}).get("son")
    reste = list(videos)
    places = list(voisins)
    out = []
    for t in list(creneaux)[:len(videos)]:
        avant = [v for v in places if v[0] < t]
        apres = [v for v in places if v[0] > t]
        prec = son(max(avant)[1]) if avant else None
        suiv = son(min(apres)[1]) if apres else None
        pris = next((v for v in reste if son(v[0]) is None or son(v[0]) not in (prec, suiv)), None) \
            or next((v for v in reste if son(v[0]) != prec), None) or reste[0]
        reste.remove(pris)
        out.append(pris)
        places.append((t, os.path.basename(str(pris[0]))))
    return out + reste


# ------------------------------------------------------------------
# Pour la page Sounds
# ------------------------------------------------------------------

def api_liste():
    now = time.time()
    lib = scanner()
    us = _usages(now, lib)
    noms = {}
    try:
        import plateau
        noms = {str(r["serie_id"]): r["nom"] for r in
                plateau.db().execute("SELECT serie_id, nom FROM accounts")}
    except Exception:                                   # noqa: BLE001
        pass
    out = []
    for nom, t in lib["tracks"].items():
        mine = [u for u in us if u["son"] == nom]
        vues = [u["vues"] for u in mine if u["statut"] == "publie" and u["vues"] is not None]
        comptes = {}
        for u in mine:
            if u["t"] >= now - 7 * 86400:
                k = noms.get(u["serie"], "")
                if k:
                    comptes[k] = comptes.get(k, 0) + 1
        out.append({
            "file": nom, "title": t.get("title") or _titre_de(nom),
            "start": t.get("start", 0.0), "auto_start": t.get("auto_start", 0.0),
            "duration": t.get("duration", 0.0), "active": bool(t.get("active", True)),
            "broken": bool(t.get("broken")), "added": t.get("added", 0),
            "uses_24h": sum(1 for u in mine if now - 86400 <= u["t"] <= now + 86400),
            "uses_7d": sum(1 for u in mine if now - 7 * 86400 <= u["t"] <= now + 86400),
            "posted": sum(1 for u in mine if u["statut"] == "publie"),
            "avg_views": round(sum(vues) / len(vues)) if vues else None,
            "accounts": comptes,
        })
    out.sort(key=lambda x: (not x["active"] or x["broken"], -(x["added"] or 0)))
    return {"tracks": out, "dir": str(DIR),
            "active": sum(1 for x in out if x["active"] and not x["broken"])}
