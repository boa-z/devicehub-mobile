const { withAndroidManifest, withInfoPlist } = require("@expo/config-plugins");

/** Allow the local HTTP and Bonjour listener used by devicehub-headless. */
module.exports = function withLocalNetwork(config) {
  const withAndroid = withAndroidManifest(config, (configWithManifest) => {
    const application = configWithManifest.modResults.manifest.application?.[0];
    if (application) {
      application.$ = application.$ || {};
      application.$["android:usesCleartextTraffic"] = "true";
    }
    return configWithManifest;
  });

  return withInfoPlist(withAndroid, (configWithPlist) => {
    const plist = configWithPlist.modResults;
    plist.NSLocalNetworkUsageDescription =
      "DeviceHub Mobile discovers DeviceHub services on your trusted local network.";
    const services = Array.isArray(plist.NSBonjourServices) ? plist.NSBonjourServices : [];
    plist.NSBonjourServices = Array.from(new Set([...services, "_devicehub._tcp"]));
    plist.NSAppTransportSecurity = {
      ...(plist.NSAppTransportSecurity || {}),
      NSAllowsLocalNetworking: true,
    };
    return configWithPlist;
  });
};
