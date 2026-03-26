#!/usr/bin/env python3
"""
Drop WCP/TZST files into ~/API/ then run this script.
It will:
  1. Extract profile.json from each file
  2. Compute MD5 + file size
  3. Rename to {md5}.tzst
  4. Upload to the Components GitHub release
  5. Add an entry to data/custom_components.json
  6. Run npm run build
  7. Commit + push to master
"""

import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile

REPO = "The412Banner/bannerhub-api"
RELEASE_TAG = "Components"
API_DIR = os.path.expanduser("~/API")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CUSTOM_JSON = os.path.join(SCRIPT_DIR, "data", "custom_components.json")
RELEASE_BASE = f"https://github.com/{REPO}/releases/download/{RELEASE_TAG}"

# Map profile.json type string → API int
TYPE_MAP = {
    "fexcore": 1,
    "box64": 1,
    "translator": 1,
    "gpu": 2,
    "driver": 2,
    "turnip": 2,
    "dxvk": 3,
    "vkd3d": 4,
    "wine": 5,
    "proton": 5,
    "libraries": 6,
    "library": 6,
    "steam": 7,
}


def md5_of_file(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_profile(path):
    """Extract profile.json from a WCP/TZST archive (zstd or xz/gz/bz2 tar)."""
    with tempfile.TemporaryDirectory() as tmp:
        # Try zstd first
        decompressed = os.path.join(tmp, "decompressed.tar")
        result = subprocess.run(
            ["zstd", "-d", path, "-o", decompressed, "-f"],
            capture_output=True,
        )
        if result.returncode == 0:
            tar_path = decompressed
        else:
            # Fall back: let tar auto-detect compression (xz, gz, bz2)
            tar_path = path

        try:
            with tarfile.open(tar_path) as tf:
                # Try with and without leading ./
                for name in ("profile.json", "./profile.json"):
                    try:
                        member = tf.getmember(name)
                        f = tf.extractfile(member)
                        return json.load(f)
                    except KeyError:
                        continue
                raise RuntimeError("No profile.json found inside archive")
        except Exception as e:
            raise RuntimeError(f"Could not open archive: {e}")


def resolve_type(profile):
    """Return the API type int from profile.json."""
    raw = profile.get("type", "").lower()
    for key, val in TYPE_MAP.items():
        if key in raw:
            return val
    # Ask user
    print(f"  Unknown type '{profile.get('type')}'. Enter number (1=Box64/FEX 2=GPU 3=DXVK 4=VKD3D 5=Wine 6=Library 7=Steam): ", end="")
    return int(input().strip())


def next_id(components):
    if not components:
        return 1100
    return max(c["id"] for c in components) + 1


def gh_upload(local_path, asset_name):
    print(f"  Uploading {asset_name} to {RELEASE_TAG} release...")
    result = subprocess.run(
        ["gh", "release", "upload", RELEASE_TAG, f"{local_path}#{asset_name}",
         "--repo", REPO, "--clobber"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"gh upload failed: {result.stderr}")
    print(f"  Uploaded.")


def main():
    files = [
        f for f in os.listdir(API_DIR)
        if f.lower().endswith((".wcp", ".tzst", ".tar.zst"))
        and not f.startswith(".")
    ]

    if not files:
        print(f"No WCP/TZST files found in {API_DIR}")
        sys.exit(0)

    print(f"Found {len(files)} file(s) in ~/API/\n")

    with open(CUSTOM_JSON) as f:
        data = json.load(f)
    components = data["components"]

    added = []

    for filename in sorted(files):
        path = os.path.join(API_DIR, filename)
        print(f"Processing: {filename}")

        try:
            profile = extract_profile(path)
        except Exception as e:
            print(f"  ERROR reading profile.json: {e} — skipping")
            continue

        print(f"  profile.json: name={profile.get('name') or profile.get('versionName')} "
              f"type={profile.get('type')} version={profile.get('versionName', '1.0.0')}")

        file_md5 = md5_of_file(path)
        file_size = os.path.getsize(path)
        asset_name = f"{file_md5}.tzst"
        download_url = f"{RELEASE_BASE}/{asset_name}"

        # Check if already added
        existing = next((c for c in components if c["file_md5"] == file_md5), None)
        if existing:
            print(f"  Already in custom_components.json as id={existing['id']} ({existing['name']}) — skipping upload")
            os.remove(path)
            continue

        # Rename locally for upload
        renamed_path = os.path.join(API_DIR, asset_name)
        os.rename(path, renamed_path)

        try:
            gh_upload(renamed_path, asset_name)
        except Exception as e:
            print(f"  ERROR uploading: {e}")
            os.rename(renamed_path, path)  # restore
            continue

        name = (profile.get("name") or profile.get("versionName") or
                os.path.splitext(filename)[0])
        version = profile.get("versionName", "1.0.0")
        type_int = resolve_type(profile)

        entry = {
            "id": next_id(components),
            "name": name,
            "type": type_int,
            "version": version,
            "version_code": 1,
            "file_name": asset_name,
            "file_md5": file_md5,
            "file_size": str(file_size),
            "download_url": download_url,
            "display_name": name,
        }

        components.append(entry)
        added.append(entry)
        print(f"  Added: id={entry['id']} name={name} type={type_int} md5={file_md5}")

        # Clean up renamed file
        os.remove(renamed_path)

    if not added:
        print("\nNothing new to add.")
        sys.exit(0)

    # Write updated JSON
    with open(CUSTOM_JSON, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(f"\nUpdated custom_components.json with {len(added)} new component(s)")

    # npm run build
    print("\nRunning npm run build...")
    result = subprocess.run(["npm", "run", "build"], cwd=SCRIPT_DIR, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"BUILD FAILED:\n{result.stderr}")
        sys.exit(1)
    print("Build OK")

    # git commit + push
    names = ", ".join(e["name"] for e in added)
    msg = f"feat: add {len(added)} component(s) — {names}"
    subprocess.run(["git", "add", "-A"], cwd=SCRIPT_DIR)
    subprocess.run(["git", "commit", "-m", msg], cwd=SCRIPT_DIR)
    subprocess.run(["git", "push", "origin", "master"], cwd=SCRIPT_DIR)
    subprocess.run(["git", "push", "origin", "master:main"], cwd=SCRIPT_DIR)  # Pages serves from main
    print(f"\nDone. Pushed: {msg}")


if __name__ == "__main__":
    main()
