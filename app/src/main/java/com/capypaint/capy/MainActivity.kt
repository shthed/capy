package com.capypaint.capy

import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import com.capypaint.capy.ui.screens.GameScreen
import com.capypaint.capy.ui.theme.CapyTheme
import com.capypaint.capy.util.CapyLogger
import com.capypaint.capy.viewmodel.GameViewModel

@Suppress("RestrictedApi")
class MainActivity : ComponentActivity() {

    private var gameViewModel: GameViewModel? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CapyLogger.init(applicationContext)
        CapyLogger.i("CapyApp", "MainActivity.onCreate() invoked")

        window.decorView.isFocusable = true
        window.decorView.isFocusableInTouchMode = true
        window.decorView.requestFocus()

        // Attach View-level OnGenericMotionListener for physical USB/Bluetooth mouse & virtual device mousewheel scrolls
        window.decorView.setOnGenericMotionListener { _, ev ->
            if ((ev.actionMasked == MotionEvent.ACTION_SCROLL) || (ev.action == MotionEvent.ACTION_SCROLL)) {
                val scrollAxisVal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ev.getAxisValue(MotionEvent.AXIS_SCROLL)
                } else 0f
                val vScroll = ev.getAxisValue(MotionEvent.AXIS_VSCROLL).takeIf { it != 0f } ?: scrollAxisVal
                val scrollVal = if (vScroll != 0f) vScroll else ev.getAxisValue(MotionEvent.AXIS_HSCROLL)

                CapyLogger.d(
                    "CapyInput",
                    "setOnGenericMotionListener -> mousewheel scrollVal=$scrollVal at (${ev.x.toInt()}, ${ev.y.toInt()})",
                )

                if (scrollVal != 0f) {
                    if (scrollVal > 0f) {
                        gameViewModel?.zoomIn()
                    } else {
                        gameViewModel?.zoomOut()
                    }
                    true
                } else false
            } else false
        }

        enableEdgeToEdge()
        setContent {
            val viewModel: GameViewModel = viewModel()
            gameViewModel = viewModel
            val settings by viewModel.settings.collectAsState()
            CapyTheme(themeMode = settings.themeMode) {
                GameScreen(viewModel = viewModel)
            }
        }
    }

    override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
        val actionStr = MotionEvent.actionToString(ev.action)
        val scrollAxisVal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ev.getAxisValue(MotionEvent.AXIS_SCROLL)
        } else 0f
        val vScroll = ev.getAxisValue(MotionEvent.AXIS_VSCROLL).takeIf { it != 0f } ?: scrollAxisVal
        val hScroll = ev.getAxisValue(MotionEvent.AXIS_HSCROLL)
        val scrollVal = if (vScroll != 0f) vScroll else hScroll

        CapyLogger.v(
            "CapyRawInput",
            "RAW GenericMotionEvent -> action=$actionStr (${ev.action}), pos=(${ev.x.toInt()}, ${ev.y.toInt()}), vScroll=$vScroll, hScroll=$hScroll, deviceId=${ev.deviceId}, source=${ev.source}",
        )

        if ((ev.actionMasked == MotionEvent.ACTION_SCROLL) || (ev.action == MotionEvent.ACTION_SCROLL)) {
            if (scrollVal != 0f) {
                CapyLogger.d("CapyInput", "dispatchGenericMotionEvent mousewheel zoom -> scrollVal=$scrollVal")
                if (scrollVal > 0f) {
                    gameViewModel?.zoomIn()
                } else {
                    gameViewModel?.zoomOut()
                }
                return true
            }
        }

        return super.dispatchGenericMotionEvent(ev)
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        val actionStr = MotionEvent.actionToString(ev.action)
        CapyLogger.v(
            "CapyRawInput",
            "RAW TouchEvent -> action=$actionStr (${ev.action}), pointers=${ev.pointerCount}, pos=(${ev.x.toInt()}, ${ev.y.toInt()})",
        )
        return super.dispatchTouchEvent(ev)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val actionStr = when (event.action) {
            KeyEvent.ACTION_DOWN -> "ACTION_DOWN"
            KeyEvent.ACTION_UP -> "ACTION_UP"
            else -> event.action.toString()
        }
        CapyLogger.v(
            "CapyRawInput",
            "RAW KeyEvent -> action=$actionStr, keyCode=${event.keyCode} (${KeyEvent.keyCodeToString(event.keyCode)})",
        )

        // Physical Keyboard / Mouse shortcut zoom handling
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_PLUS,
                KeyEvent.KEYCODE_EQUALS,
                KeyEvent.KEYCODE_NUMPAD_ADD,
                KeyEvent.KEYCODE_ZOOM_IN,
                -> {
                    CapyLogger.d("CapyInput", "Physical Keyboard Zoom In key pressed (${event.keyCode})")
                    gameViewModel?.zoomIn()
                    return true
                }

                KeyEvent.KEYCODE_MINUS,
                KeyEvent.KEYCODE_NUMPAD_SUBTRACT,
                KeyEvent.KEYCODE_ZOOM_OUT,
                -> {
                    CapyLogger.d("CapyInput", "Physical Keyboard Zoom Out key pressed (${event.keyCode})")
                    gameViewModel?.zoomOut()
                    return true
                    }
            }
        }

        return super.dispatchKeyEvent(event)
    }

    override fun onResume() {
        super.onResume()
        CapyLogger.d("CapyApp", "MainActivity.onResume()")
    }

    override fun onPause() {
        super.onPause()
        CapyLogger.d("CapyApp", "MainActivity.onPause()")
        gameViewModel?.flushActiveGameState()
    }
}
