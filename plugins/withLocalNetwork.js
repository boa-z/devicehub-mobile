const { withAndroidManifest } = require("@expo/config-plugins");

/** Allow the local HTTP listener used by devicehub-headless on a trusted LAN. */
module.exports = function withLocalNetwork(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const application = configWithManifest.modResults.manifest.application?.[0];
    if (application) {
      application.$ = application.$ || {};
      application.$["android:usesCleartextTraffic"] = "true";
    }
    return configWithManifest;
  });
};
