Pod::Spec.new do |s|
  s.name           = 'DeviceHubDiscovery'
  s.version        = '0.1.0'
  s.summary        = 'Bonjour discovery for DeviceHub Mobile.'
  s.description    = 'Native local-network service discovery for DeviceHub headless servers.'
  s.author         = 'DeviceHub'
  s.homepage       = 'https://github.com/boa-z/devicehub-mask'
  s.platforms      = { ios: '16.4' }
  s.source         = { git: 'https://github.com/boa-z/devicehub-mobile.git', tag: s.version.to_s }
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.dependency     'ExpoModulesCore'
  s.swift_version  = '5.9'
end
