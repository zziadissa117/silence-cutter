"""Stand-in for Le plateau's app module, which the engine does not run.

sons.py asks it for its database of posts to count song uses; the engine has
none here, and sons.py already treats a missing database as "nothing posted
yet". Uses are counted from the series registers instead.
"""


def db():
    raise RuntimeError("no Le plateau database in the engine")
