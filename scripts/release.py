#!/usr/bin/env python3
"""Automated release helper script for Open-Meteo Custom.

Usage:
    export GITHUB_TOKEN="your_token"
    python3 scripts/release.py 1.3.0 "Notes de la mise à jour..."
"""
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.request

REPO_OWNER = "SocrateMobile"
REPO_NAME = "open_meteo_custom"
GITHUB_REPO = f"{REPO_OWNER}/{REPO_NAME}"

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MANIFEST_PATH = os.path.join(ROOT_DIR, "custom_components", "open_meteo_custom", "manifest.json")
CONST_PATH = os.path.join(ROOT_DIR, "custom_components", "open_meteo_custom", "const.py")


def get_token() -> str:
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        return token
    try:
        gh_token = (
            subprocess.check_output(
                ["gh", "auth", "token"],
                cwd=ROOT_DIR,
                text=True,
                stderr=subprocess.DEVNULL,
            )
            .strip()
        )
        if gh_token:
            return gh_token
    except Exception:
        pass

    try:
        remote_url = subprocess.check_output(
            ["git", "config", "--get", "remote.origin.url"],
            cwd=ROOT_DIR,
            text=True,
        ).strip()
        m = re.search(r"https://[^:]+:([^@]+)@", remote_url)
        if m:
            return m.group(1)
    except Exception:
        pass

    print("Error: GITHUB_TOKEN could not be found.")
    sys.exit(1)


def update_version_files(new_ver: str) -> None:
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    data["version"] = new_ver
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print(f"Updated {MANIFEST_PATH} -> {new_ver}")

    with open(CONST_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    new_content = re.sub(r"VERSION\s*=\s*\"[^\"]+\"", f"VERSION = \"{new_ver}\"", content)
    with open(CONST_PATH, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"Updated {CONST_PATH} -> {new_ver}")


def run_cmd(cmd: list[str]) -> None:
    print(f"Running: {" ".join(cmd)}")
    subprocess.check_call(cmd, cwd=ROOT_DIR)


def create_github_release(new_ver: str, release_notes: str, token: str) -> dict:
    tag = f"v{new_ver}" if not new_ver.startswith("v") else new_ver
    url = f"https://api.github.com/repos/{GITHUB_REPO}/releases"

    payload = {
        "tag_name": tag,
        "target_commitish": "main",
        "name": f"Open-Meteo Custom {tag} (Latest)",
        "body": release_notes,
        "draft": False,
        "prerelease": False,
        "make_latest": "true",
    }

    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(certifi.where())
    except Exception:
        pass

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": "Open-Meteo-Releaser",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, context=ctx) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        print(f"GitHub Release created successfully: {res.get("html_url")}")
        return res


def upload_release_asset(upload_url_tmpl: str, zip_path: str, filename: str, token: str) -> None:
    upload_url = upload_url_tmpl.split("{")[0] + f"?name={filename}"
    print(f"Uploading asset {filename} to {upload_url}...")

    with open(zip_path, "rb") as f:
        data = f.read()

    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(certifi.where())
    except Exception:
        pass

    req = urllib.request.Request(
        upload_url,
        data=data,
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/zip",
            "User-Agent": "Open-Meteo-Releaser",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, context=ctx) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        print(f"Asset uploaded successfully: {res.get("browser_download_url")}")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/release.py <version> [release_notes]")
        sys.exit(1)

    new_ver = sys.argv[1].lstrip("v")
    notes = (
        sys.argv[2]
        if len(sys.argv) > 2
        else f"Release {new_ver}\n\n- Nouvelles fonctionnalités et corrections pour Open-Meteo Custom."
    )
    token = get_token()

    print(f"Preparing release v{new_ver}...")
    update_version_files(new_ver)

    tag = f"v{new_ver}"

    zip_name = f"open_meteo_custom-v{new_ver}.zip"
    zip_path = f"/tmp/{zip_name}"
    generic_zip_name = "open_meteo_custom.zip"
    generic_zip_path = f"/tmp/{generic_zip_name}"

    run_cmd(["rm", "-f", zip_path, generic_zip_path])
    run_cmd([
        "zip", "-r", zip_path, "custom_components", "hacs.json", "README.md",
        "-x", "*/__pycache__/*", "*.pyc",
    ])
    import shutil
    shutil.copyfile(zip_path, generic_zip_path)
    print(f"Built archives: {zip_path} and {generic_zip_path}")

    # Copy to Desktop as well
    desktop_zip = os.path.expanduser(f"~/Desktop/{zip_name}")
    desktop_generic_zip = os.path.expanduser(f"~/Desktop/{generic_zip_name}")
    shutil.copyfile(zip_path, desktop_zip)
    shutil.copyfile(zip_path, desktop_generic_zip)
    print(f"Copied archives to Desktop: {desktop_zip} and {desktop_generic_zip}")

    run_cmd(["git", "add", "."])
    diff_exit = subprocess.call(["git", "diff", "--cached", "--quiet"], cwd=ROOT_DIR)
    if diff_exit != 0:
        run_cmd(["git", "commit", "-m", f"chore(release): bump version to {tag}"])
    run_cmd(["git", "tag", "-fa", tag, "-m", f"Release {tag}"])
    run_cmd(["git", "tag", "-fa", "latest", "-m", f"Latest release ({tag})"])
    run_cmd(["git", "push", "origin", "main"])
    run_cmd(["git", "push", "origin", tag, "latest", "--force"])

    try:
        rel_data = create_github_release(new_ver, notes, token)
        upload_url = rel_data.get("upload_url")
        if upload_url:
            upload_release_asset(upload_url, zip_path, zip_name, token)
            upload_release_asset(upload_url, generic_zip_path, generic_zip_name, token)
    except Exception as e:
        print(f"Warning: could not complete GitHub API release: {e}")

    print(f"🎉 Successfully published release {tag} with floating tag \"latest\"!")


if __name__ == "__main__":
    main()
