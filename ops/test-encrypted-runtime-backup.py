"""Synthetic offline restore drill; takes an absolute path to the reviewed age binary."""
import hashlib
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

age = Path(sys.argv[1]).resolve(strict=True)
keygen = age.with_name("age-keygen.exe" if age.suffix == ".exe" else "age-keygen")
script = Path(__file__).with_name("encrypted-runtime-backup.py").resolve()
base = Path(__file__).resolve().parent.parent / "output" / "release-3.3.5"
base.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="synthetic-backup-", dir=base) as directory:
    root = Path(directory).resolve()
    assert root.parent == base.resolve()
    snapshot = root / "snapshot"; snapshot.mkdir()
    (snapshot / "config.php").write_text("<?php return ['fixture'=>'synthetic-only'];", encoding="utf-8")
    (snapshot / "metadata.json").write_text('{"format":1,"synthetic":true}', encoding="utf-8")
    with closing(sqlite3.connect(snapshot / "genesis.sqlite")) as database, database:
        database.execute("CREATE TABLE test(value TEXT)")
        database.execute("INSERT INTO test VALUES('synthetic private content')")
    identity = root / "identity.txt"
    subprocess.run([keygen, "-o", identity], check=True, capture_output=True)
    public = subprocess.run([keygen, "-y", identity], check=True, capture_output=True).stdout
    recipient = root / "recipient.txt"; recipient.write_bytes(public)
    archive = root / "snapshot.age"
    command = [sys.executable, script, "--age", age]
    receipt = json.loads(subprocess.run(command + ["encrypt", "--source", snapshot, "--recipient", recipient, "--output", archive],
                                        check=True, capture_output=True).stdout)
    restored = root / "restored"
    def restore(source, identity_path, output, sha):
        return subprocess.run(command + ["restore", "--source", source, "--identity", identity_path, "--output", output, "--sha256", sha], capture_output=True)
    assert restore(archive,identity,restored,receipt["sha256"]).returncode == 0
    for name in ("config.php","genesis.sqlite","metadata.json"):
        assert (snapshot/name).read_bytes() == (restored/name).read_bytes()
    with closing(sqlite3.connect(restored/"genesis.sqlite")) as database, database:
        assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert database.execute("SELECT value FROM test").fetchone()[0] == "synthetic private content"
    assert b"synthetic private content" not in archive.read_bytes()
    wrong = root / "wrong.txt"; subprocess.run([keygen,"-o",wrong],check=True,capture_output=True)
    assert restore(archive,wrong,root/"wrong-restore",receipt["sha256"]).returncode != 0
    for label, content in [("truncated",archive.read_bytes()[:-24]),("tampered",archive.read_bytes()[:-1]+bytes([archive.read_bytes()[-1]^1]))]:
        broken=root/(label+".age");broken.write_bytes(content)
        # Even an altered digest cannot bypass age authentication.
        assert restore(broken,identity,root/label,hashlib.sha256(content).hexdigest()).returncode != 0
        assert not (root/label).exists()
    assert restore(archive,identity,root/"digest", "0"*64).returncode != 0
    assert restore(archive,identity,restored,receipt["sha256"]).returncode != 0
print("PASS: full snapshot byte/SQLite restore; wrong key, truncation, tamper, trusted digest and overwrite rejection; no production data used.")
