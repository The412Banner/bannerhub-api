#!/usr/bin/env python3
"""
Drop WCP/TZST/ZIP files into ~/API/ then run this script.
It will:
  1. Extract profile.json or meta.json from each file
  2. ZIP files (Turnip/adrenotools) are repacked as TZST automatically
  3. Compute MD5 + file size
  4. Rename to {md5}.tzst
  5. Upload to the Components GitHub release
  6. Add an entry to data/custom_components.json
  7. Run npm run build
  8. Commit + push to master + main
"""

import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import zipfile

REPO = "The412Banner/bannerhub-api"
RELEASE_TAG = "Components"
API_DIR = os.path.expanduser("~/API")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CUSTOM_JSON = os.path.join(SCRIPT_DIR, "data", "custom_components.json")
RELEASE_BASE = f"https://github.com/{REPO}/releases/download/{RELEASE_TAG}"

# Map type string → API int
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


def is_zip(path):
    with open(path, "rb") as f:
        return f.read(2) == b"PK"


def repack_zip_as_tzst(zip_path, tmp_dir):
    """Extract ZIP contents and repack as .tar.zst. Returns path to tzst file."""
    extract_dir = os.path.join(tmp_dir, "extracted")
    os.makedirs(extract_dir)

    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(extract_dir)

    tar_path = os.path.join(tmp_dir, "repacked.tar")
    with tarfile.open(tar_path, "w") as tf:
        for entry in sorted(os.listdir(extract_dir)):
            tf.add(os.path.join(extract_dir, entry), arcname=entry)

    tzst_path = os.path.join(tmp_dir, "repacked.tzst")
    result = subprocess.run(
        ["zstd", "-19", tar_path, "-o", tzst_path, "-f"],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"zstd repack failed: {result.stderr.decode()}")

    return tzst_path


def read_meta_from_zip(zip_path):
    """Read meta.json from a Turnip/adrenotools ZIP."""
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        for candidate in ("meta.json", "./meta.json"):
            if candidate in names:
                with zf.open(candidate) as f:
                    return json.load(f)
        raise RuntimeError("No meta.json found in ZIP")


def meta_to_profile(meta, filename):
    """Convert meta.json fields to a profile-like dict the rest of the script understands."""
    # meta.json keys vary — try common ones
    name = (meta.get("name") or meta.get("driverVersion") or
            os.path.splitext(filename)[0])
    version = meta.get("driverVersion") or meta.get("version") or "1.0.0"
    return {
        "name": name,
        "versionName": version,
        "type": "GPU",   # Turnip ZIPs are always GPU drivers
    }


def extract_profile(path):
    """Extract profile.json from a WCP/TZST archive (zstd or xz/gz/bz2 tar)."""
    with tempfile.TemporaryDirectory() as tmp:
        decompressed = os.path.join(tmp, "decompressed.tar")
        result = subprocess.run(
            ["zstd", "-d", path, "-o", decompressed, "-f"],
            capture_output=True,
        )
        tar_path = decompressed if result.returncode == 0 else path

        try:
            with tarfile.open(tar_path) as tf:
                for name in ("profile.json", "./profile.json"):
                    try:
                        f = tf.extractfile(tf.getmember(name))
                        return json.load(f)
                    except KeyError:
                        continue
                raise RuntimeError("No profile.json found inside archive")
        except Exception as e:
            raise RuntimeError(f"Could not open archive: {e}")


def resolve_type(profile):
    raw = profile.get("type", "").lower()
    for key, val in TYPE_MAP.items():
        if key in raw:
            return val
    print(f"  Unknown type '{profile.get('type')}'. Enter number "
          f"(1=Box64/FEX 2=GPU 3=DXVK 4=VKD3D 5=Wine 6=Library 7=Steam): ", end="")
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
        if f.lower().endswith((".wcp", ".tzst", ".tar.zst", ".zip"))
        and not f.startswith(".")
    ]

    if not files:
        print(f"No WCP/TZST/ZIP files found in {API_DIR}")
        sys.exit(0)

    print(f"Found {len(files)} file(s) in ~/API/\n")

    with open(CUSTOM_JSON) as f:
        data = json.load(f)
    components = data["components"]

    added = []

    for filename in sorted(files):
        path = os.path.join(API_DIR, filename)
        print(f"Processing: {filename}")

        upload_path = path  # may be replaced by repacked tzst
        cleanup_upload = False

        try:
            if filename.lower().endswith(".zip") or is_zip(path):
                # Turnip/adrenotools ZIP — read meta.json, repack as tzst
                print("  Detected ZIP format (Turnip/adrenotools) — repacking as TZST...")
                meta = read_meta_from_zip(path)
                profile = meta_to_profile(meta, filename)

                tmp_dir = tempfile.mkdtemp()
                tzst_path = repack_zip_as_tzst(path, tmp_dir)
                upload_path = tzst_path
                cleanup_upload = True
            else:
                profile = extract_profile(path)
        except Exception as e:
            print(f"  ERROR: {e} — skipping")
            continue

        print(f"  profile: name={profile.get('name') or profile.get('versionName')} "
              f"type={profile.get('type')} version={profile.get('versionName', '1.0.0')}")

        file_md5 = md5_of_file(upload_path)
        file_size = os.path.getsize(upload_path)
        asset_name = f"{file_md5}.tzst"
        download_url = f"{RELEASE_BASE}/{asset_name}"

        existing = next((c for c in components if c["file_md5"] == file_md5), None)
        if existing:
            print(f"  Already added as id={existing['id']} ({existing['name']}) — skipping")
            os.remove(path)
            if cleanup_upload:
                import shutil; shutil.rmtree(os.path.dirname(upload_path), ignore_errors=True)
            continue

        # Rename/copy for upload
        final_upload = os.path.join(API_DIR, asset_name)
        if upload_path != path:
            import shutil
            shutil.copy2(upload_path, final_upload)
        else:
            os.rename(path, final_upload)

        try:
            gh_upload(final_upload, asset_name)
        except Exception as e:
            print(f"  ERROR uploading: {e}")
            if upload_path == path:
                os.rename(final_upload, path)
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

        # Clean up
        if os.path.exists(final_upload):
            os.remove(final_upload)
        if os.path.exists(path):
            os.remove(path)
        if cleanup_upload:
            import shutil
            shutil.rmtree(os.path.dirname(upload_path), ignore_errors=True)

    if not added:
        print("\nNothing new to add.")
        sys.exit(0)

    with open(CUSTOM_JSON, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(f"\nUpdated custom_components.json with {len(added)} new component(s)")

    print("\nRunning npm run build...")
    result = subprocess.run(["npm", "run", "build"], cwd=SCRIPT_DIR, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"BUILD FAILED:\n{result.stderr}")
        sys.exit(1)
    print("Build OK")

    names = ", ".join(e["name"] for e in added)
    msg = f"feat: add {len(added)} component(s) — {names}"
    subprocess.run(["git", "add", "-A"], cwd=SCRIPT_DIR)
    subprocess.run(["git", "commit", "-m", msg], cwd=SCRIPT_DIR)
    subprocess.run(["git", "push", "origin", "master"], cwd=SCRIPT_DIR)
    subprocess.run(["git", "push", "origin", "master:main"], cwd=SCRIPT_DIR)
    print(f"\nDone. Pushed: {msg}")


if __name__ == "__main__":
    main()
