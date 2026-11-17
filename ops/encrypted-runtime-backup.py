"""Offline age wrapper for a completed GENESIS runtime snapshot. Never reads live config.

Encrypt: --age /path/age encrypt --source /snapshot --recipient /external-public.txt --output /copy.age
Restore: --age /path/age restore --source /copy.age --identity /offline-private.txt --sha256 TRUSTED_DIGEST --output /new-directory
The private identity must stay outside hosting and the repository. age v1.3.2, BSD-3-Clause.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

FILES = ("config.php", "genesis.sqlite", "metadata.json")
MAX_TOTAL = 16 * 1024 * 1024 * 1024


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def encrypt(args):
    source, output = Path(args.source).resolve(strict=True), Path(args.output).absolute()
    if not source.is_dir() or output.exists() or not output.parent.is_dir():
        raise ValueError("A completed snapshot and a new output file are required")
    manifest = {"format": "genesis-runtime-age-v1", "files": {}}
    total = 0
    for name in FILES:
        path = source / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("Snapshot contains a missing or linked file")
        size = path.stat().st_size
        total += size
        manifest["files"][name] = {"bytes": size, "sha256": digest(path)}
    if total > MAX_TOTAL:
        raise ValueError("Snapshot exceeds the supported bound")
    temporary = output.with_name(output.name + ".partial")
    process = None
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as destination:
            process = subprocess.Popen([args.age, "--encrypt", "--recipients-file", args.recipient],
                                       stdin=subprocess.PIPE, stdout=destination, stderr=subprocess.DEVNULL)
            with tarfile.open(fileobj=process.stdin, mode="w|") as archive:
                encoded = json.dumps(manifest, separators=(",", ":")).encode()
                member = tarfile.TarInfo("manifest.json"); member.size = len(encoded); member.mode = 0o600
                archive.addfile(member, io.BytesIO(encoded))
                for name in FILES:
                    archive.add(source / name, arcname=name, recursive=False)
            process.stdin.close()
            if process.wait() != 0:
                raise RuntimeError("age encryption failed; original snapshot retained")
            destination.flush(); os.fsync(destination.fileno())
        # A live/mutating directory is not a valid backup input.
        for name in FILES:
            if digest(source / name) != manifest["files"][name]["sha256"]:
                raise ValueError("Snapshot changed while sealing")
        if output.exists():
            raise FileExistsError("Output appeared while sealing")
        temporary.rename(output)
        return {"format": manifest["format"], "bytes": output.stat().st_size, "sha256": digest(output)}
    finally:
        if process is not None and process.poll() is None:
            process.kill(); process.wait()
        if temporary.is_file():
            temporary.unlink()


def restore(args):
    source, output = Path(args.source).resolve(strict=True), Path(args.output).absolute()
    if output.exists() or not output.parent.is_dir() or source.stat().st_size > MAX_TOTAL + 1024 * 1024:
        raise ValueError("Restore requires a new isolated destination")
    if digest(source) != args.sha256.lower():
        raise ValueError("Archive differs from the independently retained digest")
    # Plaintext exists only in a private temporary directory, never in the server/public tree.
    with tempfile.TemporaryDirectory(prefix="genesis-restore-", dir=output.parent) as temporary:
        root = Path(temporary); os.chmod(root, 0o700)
        plain = root / "snapshot.tar"
        with os.fdopen(os.open(plain, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
            result = subprocess.run([args.age, "--decrypt", "--identity", args.identity, str(source)],
                                    stdout=stream, stderr=subprocess.DEVNULL)
        if result.returncode != 0:
            raise ValueError("Wrong identity or damaged archive; no restored files published")
        restored = root / "checked"; restored.mkdir(mode=0o700)
        with tarfile.open(plain, "r:") as archive:
            members = archive.getmembers()
            if len(members) != 4 or {m.name for m in members} != {"manifest.json", *FILES} or any(not m.isfile() for m in members):
                raise ValueError("Unexpected archive entry")
            if sum(m.size for m in members) > MAX_TOTAL + 8192 or archive.getmember("manifest.json").size > 8192:
                raise ValueError("Archive exceeds bounds")
            manifest = json.load(archive.extractfile("manifest.json"))
            if manifest["format"] != "genesis-runtime-age-v1" or set(manifest["files"]) != set(FILES):
                raise ValueError("Wrong manifest")
            for name in FILES:
                target = restored / name
                with archive.extractfile(name) as entry, os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                    shutil.copyfileobj(entry, stream, 1024 * 1024)
                if target.stat().st_size != manifest["files"][name]["bytes"] or digest(target) != manifest["files"][name]["sha256"]:
                    raise ValueError("Snapshot integrity mismatch")
        if output.exists():
            raise FileExistsError("Restore destination appeared")
        restored.rename(output)
    return {"restored": list(FILES), "activation": "none"}


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--age", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    sealing = commands.add_parser("encrypt")
    sealing.add_argument("--recipient", required=True)
    opening = commands.add_parser("restore")
    opening.add_argument("--identity", required=True)
    opening.add_argument("--sha256", required=True)
    for command in (sealing, opening):
        command.add_argument("--source", required=True)
        command.add_argument("--output", required=True)
    arguments = parser.parse_args()
    print(json.dumps(encrypt(arguments) if arguments.command == "encrypt" else restore(arguments)))
