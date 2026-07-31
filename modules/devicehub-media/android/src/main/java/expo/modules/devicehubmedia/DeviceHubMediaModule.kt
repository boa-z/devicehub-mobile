package expo.modules.devicehubmedia

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView

class DeviceHubVideoView(context: Context, appContext: AppContext) : ExpoView(context, appContext)

class DeviceHubMediaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DeviceHubMedia")

    Function("pushVideoFrame") { _: DeviceHubVideoView, _: ByteArray, _: Double, _: Boolean -> }
    Function("pushAudioPcm") { _: ByteArray, _: Int, _: Int -> }
    Function("reset") {}

    View(DeviceHubVideoView::class) {
      Prop("contentMode") { _: DeviceHubVideoView, _: String -> }
    }
  }
}
