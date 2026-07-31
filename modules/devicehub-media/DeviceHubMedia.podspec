Pod::Spec.new do |s|
  s.name           = 'DeviceHubMedia'
  s.version        = '0.1.0'
  s.summary        = 'Native HEVC and PCM media primitives for DeviceHub Mobile.'
  s.description    = 'VideoToolbox-backed iOS media view and AVAudioEngine playback.'
  s.author         = 'DeviceHub'
  s.homepage       = 'https://github.com/boa-z/devicehub-mask'
  s.platforms      = { ios: '16.4' }
  s.source         = { git: 'https://github.com/boa-z/devicehub-mobile.git', tag: s.version.to_s }
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.dependency     'ExpoModulesCore'
  s.swift_version  = '5.9'
end
