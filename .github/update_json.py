import json
import os
from datetime import datetime, timezone
from pathlib import Path


REPO_URL = "boa-z/devicehub-mobile"
NIGHTLY_TAG = "nightly"
NIGHTLY_IPA_NAME = "devicehub-mobile-unsigned.ipa"
SOURCE_JSON = Path(os.environ.get("SOURCE_JSON", ".github/apps_nightly.json"))


def release_download_url() -> str:
    return f"https://github.com/{REPO_URL}/releases/download/{NIGHTLY_TAG}/{NIGHTLY_IPA_NAME}"


def build_version_description() -> str:
    lines = []
    commit = os.environ.get("COMMIT_SHA", "").strip()[:7]
    headline = os.environ.get("COMMIT_MSG", "").strip()
    workflow = os.environ.get("NIGHTLY_LINK", "").strip()
    if commit:
        lines.append(f"Commit: {commit}")
    if headline:
        lines.append(f"Message: {headline}")
    if workflow:
        lines.append(f"Workflow: {workflow}")
    return "\n".join(lines) or "Automatic nightly build"


def load_source() -> dict:
    with SOURCE_JSON.open("r", encoding="utf-8") as source_file:
        data = json.load(source_file)
    if not data.get("apps"):
        raise RuntimeError("AltStore source template must contain at least one app")
    return data


def update_source(data: dict, ipa_size: int) -> dict:
    app = data["apps"][0]
    version = os.environ.get("VERSION_LABEL", "1.0.0+1").strip()
    version_date = os.environ.get("VERSION_DATE", "").strip()
    if not version_date:
        version_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    description = build_version_description()
    version_entry = {
        "version": version,
        "date": version_date,
        "localizedDescription": description,
        "downloadURL": release_download_url(),
        "size": ipa_size,
    }

    app["versions"] = [version_entry]
    app.update(
        {
            "version": version,
            "versionDate": version_date,
            "versionDescription": description,
            "downloadURL": release_download_url(),
            "size": ipa_size,
        }
    )

    channels = app.setdefault("releaseChannels", [])
    nightly = next((channel for channel in channels if channel.get("track") == "nightly"), None)
    if nightly is None:
        nightly = {"track": "nightly", "releases": []}
        channels.append(nightly)
    nightly["releases"] = [version_entry]
    return data


def main() -> None:
    ipa_path = Path(os.environ.get("LOCAL_IPA_PATH", NIGHTLY_IPA_NAME))
    if not ipa_path.is_file() or ipa_path.stat().st_size <= 0:
        raise RuntimeError(f"Nightly IPA not found or empty: {ipa_path}")

    source = update_source(load_source(), ipa_path.stat().st_size)
    with SOURCE_JSON.open("w", encoding="utf-8") as source_file:
        json.dump(source, source_file, indent=2, ensure_ascii=False)
        source_file.write("\n")
    print(f"Generated {SOURCE_JSON} for {ipa_path.name} ({ipa_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
