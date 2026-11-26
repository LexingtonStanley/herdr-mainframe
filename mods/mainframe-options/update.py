#!/usr/bin/env python3
"""Mainframe's updater: looks on GitHub for a newer Mainframe and installs it into a Herdr home.

  update.py --home <herdr home> --check    fetch, then say how many changes this install is behind
  update.py --home <herdr home> --apply    install the newest main branch
  update.py --home <herdr home> --detach   --apply in the background (the options dialog uses it,
                                           since Herdr reloads the dialog while its files change)

It only touches files that are part of Mainframe, under layouts/, mods/, themes/ and keys.json.
A file changed here stops the update and is named, except layouts/mainframe.json (your edits and
the new version are merged) and keys.json (your own keys stay). Every file it replaces is copied
to <home>/data/mainframe-update/backups first. Each run ends by printing its status as one line
of JSON, which is also kept in <home>/data/mainframe-update/status.json.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from datetime import datetime

REMOTE = "https://github.com/LexingtonStanley/herdr-mainframe.git"
BRANCH = "main"
SCOPE = ("layouts", "mods", "themes", "keys.json")
LAYOUT, KEYS = Path("layouts/mainframe.json"), Path("keys.json")
ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}

APP = STATE = None


def git(*args):
    return subprocess.check_output(["git", "--git-dir", str(STATE / "upstream.git"), *args], env=ENV, stderr=subprocess.PIPE)


def now_ms():
    return int(time.time() * 1000)


def read_status():
    try:
        return json.loads((STATE / "status.json").read_text())
    except (OSError, ValueError):
        return {}


def write_status(**fields):
    status = {**read_status(), **fields}
    tmp = STATE / "status.json.next"
    tmp.write_text(json.dumps(status, ensure_ascii=False) + "\n")
    tmp.replace(STATE / "status.json")
    return status


class Lock:
    """One run at a time per home (the hourly job and a click can't overlap)."""
    def __enter__(self):
        self.file = (STATE / "lock").open("a+")
        try:
            import fcntl
            fcntl.flock(self.file, fcntl.LOCK_EX)
        except ImportError:  # Windows
            import msvcrt
            self.file.seek(0)
            while True:
                try:
                    msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    time.sleep(0.5)
        return self

    def __exit__(self, *_):
        self.file.close()


# A blob as git stores it; a text file checked out with CRLF line ends (git on Windows) counts as
# the same file.
def norm(data):
    return data if b"\0" in data else data.replace(b"\r\n", b"\n")


def blob_id(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def manifest(rev):
    result = {}
    for row in git("ls-tree", "-rz", rev, "--", *SCOPE).split(b"\0"):
        if not row:
            continue
        attrs, name = row.decode().split("\t", 1)
        mode, kind, oid = attrs.split()
        if kind != "blob" or mode not in {"100644", "100755"} or ".." in Path(name).parts:
            raise ValueError(f"Unsupported file in the published layout: {name}")
        result[Path(name)] = (int(mode, 8) & 0o777, oid)
    return result


def blob(entry):
    return (entry[0], git("cat-file", "blob", entry[1])) if entry else None


def live_file(path):
    target = APP / path
    for p in [target, *target.parents]:
        if p == APP:
            break
        if p.is_symlink():
            raise ValueError(f"{path} is or goes through a symlink, so it was left alone. Nothing was updated.")
    if not target.is_file():
        return None
    return (target.stat().st_mode & 0o777, norm(target.read_bytes()))


def fetch():
    repo = STATE / "upstream.git"
    if not repo.is_dir():
        subprocess.check_output(["git", "init", "--bare", "-q", str(repo)], env=ENV, stderr=subprocess.PIPE)
    git("-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=25", "fetch", "--quiet", "--no-tags",
        REMOTE, f"+refs/heads/{BRANCH}:refs/heads/{BRANCH}")
    return git("rev-parse", f"refs/heads/{BRANCH}").decode().strip()


def installed(latest):
    """The version installed here: as the last update wrote it down, or else (installed by
    copying files) the published version most of the files here match. On a tie the oldest:
    the versions tied differ only in files changed here, and from the oldest the update meets
    those files and stops at them, where from a newer one it would leave them out unnoticed."""
    try:
        return (STATE / "installed").read_text().strip(), False
    except OSError:
        pass
    revs = git("rev-list", latest).decode().split()
    best, score, hashes = None, 0, {}
    for rev in revs:
        files = manifest(rev)
        for path in files.keys() - hashes.keys():
            cur = live_file(path)
            hashes[path] = blob_id(cur[1]) if cur else None
        s = sum(1 for path, (_, oid) in files.items() if hashes[path] == oid)
        if s and s >= score:  # newest first: the last one tied is the oldest
            best, score = rev, s
    if best is None:
        raise ValueError("None of Mainframe's files here match a published version, so it can't tell which one is installed.")
    return best, True


def encode(obj):
    return (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode()


# keys.json: a key the new version changes is changed here only if it is still as Mainframe had it.
def merge_keys(old, current, new):
    before, live, after = map(json.loads, (old, current, new))
    for section in before.keys() | after.keys():
        earlier, later = before.get(section, {}), after.get(section, {})
        bindings = live.setdefault(section, {})
        for key in earlier.keys() | later.keys():
            target = later.get(key)
            if earlier.get(key) == target or bindings.get(key) != earlier.get(key):
                continue
            if target is None:
                bindings.pop(key, None)
            elif key not in earlier and section != "global" and key in live.get("global", {}):
                print(f"Kept your global {key}; {target} has no key in this layout.", file=sys.stderr)
            else:
                bindings[key] = target
    return encode(live)


def node(tree, wanted):
    if tree.get("id") == wanted:
        return tree
    for child in tree.get("children", []):
        hit = node(child, wanted)
        if hit is not None:
            return hit


# layouts/mainframe.json: a three-way merge of the version installed, yours and the new one.
def merge_layout(old, current, new, tmp):
    base, live, upstream = map(json.loads, (old, current, new))
    # The Grid writes the open terminal into this block. Keep that, even when the new version
    # moves the block.
    a, b, c = (node(layout, "grid-term") for layout in (base, live, upstream))
    saved = None
    if a and b and c and a.get("content") == c.get("content"):
        saved = b.get("content")
        b["content"] = a["content"]
    files = [tmp / name for name in ("live.json", "base.json", "upstream.json")]
    for path, data in zip(files, (live, base, upstream)):
        path.write_bytes(encode(data))
    merged = subprocess.run(["git", "merge-file", "-p", *map(str, files)], stdout=subprocess.PIPE)
    if merged.returncode:
        raise ValueError("The new layouts/mainframe.json changes the same places as your edits to it. Nothing was updated.")
    layout = json.loads(merged.stdout)
    if saved is not None:
        node(layout, "grid-term")["content"] = saved
    return encode(layout)


def put(path, item):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(item[1])
    try:
        path.chmod(item[0])
    except OSError:
        pass


def deploy(old, new):
    base, head = manifest(old), manifest(new)
    plan = {}
    with tempfile.TemporaryDirectory(prefix=".mainframe-stage-", dir=APP.parent) as temp:
        tmp = Path(temp)
        stage = tmp / "package"
        for path in sorted(base.keys() | head.keys()):
            if base.get(path) == head.get(path):
                continue
            before, after, current = blob(base.get(path)), blob(head.get(path)), live_file(path)
            if after and current:  # the file keeps the mode it has here, with the new version's x bits
                after = ((current[0] & ~0o111) | (after[0] & 0o111), after[1])
            if current == after or (current is None and after is None):
                continue
            if current and before and after and path == KEYS:
                after = (current[0], merge_keys(before[1], current[1], after[1]))
            elif (current and before and current[1] == before[1]) or (current is None and before is None):
                pass  # as installed, or new: the new version goes in
            elif current and before and after and path == LAYOUT:
                after = (current[0], merge_layout(before[1], current[1], after[1], tmp))
            elif current and not before:
                raise ValueError(f"{path} is here already but isn't Mainframe's. Nothing was updated.")
            elif current is None:
                raise ValueError(f"{path} was deleted here. Nothing was updated.")
            else:
                raise ValueError(f"{path} was changed here. Nothing was updated.")
            if current != after:
                plan[path] = (current, after)
                if after:
                    if path.suffix == ".json":
                        json.loads(after[1])
                    put(stage / path, after)

        # A new mod goes in whole: Herdr docks a mod folder it sees half made.
        fresh = {Path(*p.parts[:2]) for p in plan if p.parts[0] == "mods" and not (APP / Path(*p.parts[:2])).exists()}
        for folder in fresh:
            if not (stage / folder / "mod.json").is_file():
                raise ValueError(f"The new version has an incomplete mod: {folder}")
        backup = STATE / "backups" / f"{old[:7]}-{datetime.now():%Y%m%d-%H%M%S}"
        backup.mkdir(parents=True)
        for path, (current, _) in plan.items():
            if current:
                put(backup / path, current)
        (backup / "added-files.txt").write_text("".join(f"{p.as_posix()}\n" for p, (cur, _) in plan.items() if cur is None))
        for path, (current, _) in plan.items():
            if live_file(path) != current:
                raise ValueError(f"{path} changed while the update was getting ready. Try again.")

        # New mods first, then other files with each mod's main.js last, the layout and keys
        # after their mods, and removed files at the end.
        changed = []
        try:
            for folder in sorted(fresh):
                (stage / folder).rename(APP / folder)
                changed.extend(p for p in plan if folder in p.parents)

            def order(p):
                return (plan[p][1] is None, p.parts[0] in ("layouts", "keys.json"), p.name == "main.js", p)
            for path in sorted(set(plan) - set(changed), key=order):
                current, after = plan[path]
                if live_file(path) != current:
                    raise ValueError(f"{path} changed during the update.")
                target = APP / path
                if after is None:
                    target.unlink()
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    (stage / path).replace(target)
                changed.append(path)
            mark = STATE / "installed.next"
            mark.write_text(new + "\n")
            mark.replace(STATE / "installed")
        except BaseException:
            for path in reversed(changed):
                current, after = plan[path]
                if live_file(path) != after:
                    continue  # changed again since: that wins, and the original is in the backup
                if current:
                    put(tmp / "restore", current)
                    (tmp / "restore").replace(APP / path)
                else:
                    (APP / path).unlink()
            for folder in fresh:
                if (APP / folder).is_dir() and not any((APP / folder).iterdir()):
                    (APP / folder).rmdir()
            raise
    return len(plan), backup


def check_or_apply(apply):
    latest = fetch()
    current, inferred = installed(latest)
    info = {"latest": latest, "installed": current, "inferred": inferred, "checked": now_ms()}
    if current != latest:
        try:
            git("merge-base", "--is-ancestor", current, latest)
        except subprocess.CalledProcessError:
            raise ValueError(f"The installed version ({current[:7]}) isn't in the published history any more; reinstall Mainframe to update it.")
    behind = int(git("rev-list", "--count", f"{current}..{latest}").decode()) if current != latest else 0
    log = git("log", "-20", "--format=%s", f"{current}..{latest}").decode().splitlines() if behind else []
    if not apply or not behind:
        return write_status(state="idle", message=None, behind=behind, log=log, **info)
    count, backup = deploy(current, latest)
    return write_status(state="idle", behind=0, log=[], installed=latest, inferred=False, updated=now_ms(),
                        message=f"Installed Mainframe {latest[:7]} ({count} file{'' if count == 1 else 's'} changed). Backup: {backup}",
                        **{k: v for k, v in info.items() if k not in ("installed", "inferred")})


def main():
    global APP, STATE, REMOTE
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--home", default=os.environ.get("HERDR_APP_HOME") or str(Path.home() / ".config/herdr-app"))
    parser.add_argument("--remote", default=REMOTE, help="where to fetch from (a fork, or a local clone to test with)")
    what = parser.add_mutually_exclusive_group(required=True)
    what.add_argument("--check", action="store_true")
    what.add_argument("--apply", action="store_true")
    what.add_argument("--detach", action="store_true")
    args = parser.parse_args()
    APP, REMOTE = Path(args.home).expanduser().absolute(), args.remote
    STATE = APP / "data" / "mainframe-update"
    STATE.mkdir(parents=True, exist_ok=True)

    if args.detach:
        status = write_status(state="updating", message=None, started=now_ms())
        kw = {"stdin": subprocess.DEVNULL, "stdout": (STATE / "update.log").open("ab"), "stderr": subprocess.STDOUT}
        if os.name == "nt":
            kw["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        else:
            kw["start_new_session"] = True
        subprocess.Popen([sys.executable, os.path.abspath(__file__), "--home", str(APP), "--remote", REMOTE, "--apply"], **kw)
        print(json.dumps(status, ensure_ascii=False))
        return

    try:
        with Lock():
            if args.apply:
                write_status(state="updating", message=None, started=now_ms())
            status = check_or_apply(args.apply)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        detail = error.stderr.decode(errors="replace").strip() if isinstance(error, subprocess.CalledProcessError) and error.stderr else ""
        text = detail.splitlines()[-1] if detail else str(error)
        if isinstance(error, FileNotFoundError) and error.filename == "git":
            text = "Mainframe's updates need git, and it isn't installed."
        status = write_status(state="error", message=text, checked=now_ms())
        print(json.dumps(status, ensure_ascii=False))
        sys.exit(1)
    print(json.dumps(status, ensure_ascii=False))


if __name__ == "__main__":
    main()
