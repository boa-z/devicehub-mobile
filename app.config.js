const appJson = require("./app.json");
const packageJson = require("./package.json");

function positiveBuildNumber(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) return 1;
  return parsed;
}

function resolveBuildNumber() {
  return positiveBuildNumber(
    process.env.DEVICEHUB_MOBILE_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || "1",
  );
}

module.exports = ({ config }) => {
  const base = config || appJson.expo;
  const version =
    process.env.DEVICEHUB_MOBILE_VERSION?.trim() || packageJson.version || base.version || "1.0.0";
  const buildNumber = resolveBuildNumber();

  return {
    ...base,
    version,
    ios: {
      ...(base.ios || {}),
      buildNumber: String(buildNumber),
    },
    android: {
      ...(base.android || {}),
      versionCode: buildNumber,
    },
    extra: {
      ...(base.extra || {}),
      devicehub: {
        ...((base.extra && base.extra.devicehub) || {}),
        version,
        build: buildNumber,
      },
    },
  };
};
